"""Write changes from the GUI back to the .py file.

This is the core of the GUI → Python direction. We make surgical edits
to the user's file rather than regenerating the whole thing.
"""

import ast
import re
from pathlib import Path

from app.services import edit_lock, pnl_source_guard
from app.services.code_view import code_only_lines, code_only_text
from app.services.watcher import file_watcher

# Port-name validation regex — allows the PNL default name shape (e.g.
# "InputPort-0") plus typical user-chosen identifiers.
_PORT_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_\-]*$")

# Matches a constructor call's class reference with an OPTIONAL dotted module
# prefix — `pnl.Linear(`, bare `Linear(` (from `from psyneulink import *`), or
# `psyneulink.Linear(`. Hardcoding `pnl.` here made the declaration finders and
# nested-function matchers below silently fail on un-prefixed sources, e.g.
# `function=Linear(offset=1)`, surfacing as "Could not find parameter …" on a
# parameter edit (#300).
_CTOR = r"(?:\w+\.)*\w+\("


def _validate_param_value(value: str) -> str | None:
    """Validate that a parameter value is a valid Python expression.

    Returns None if valid, or an error message if invalid.
    """
    value = value.strip()
    if not value:
        return "Parameter value cannot be empty"
    try:
        compile(value, "<param>", "eval")
        return None  # Valid
    except SyntaxError as e:
        return f"Invalid Python expression: {e.msg}"


def _ctor_prefix(block: str) -> str:
    """The module prefix this declaration already uses, e.g. ``pnl.`` or ``""``.

    Taken from the declaration itself rather than assumed: a file written with
    ``from psyneulink import *`` says ``DDM(...)``, and writing ``pnl.`` into
    it would produce source that does not run — the same lesson as #300.
    """
    m = re.search(r"=\s*((?:\w+\.)*)\w+\(", block)
    return m.group(1) if m else ""


def apply_parameter_change(
    file_path: str, var_name: str, param_name: str, new_value: str,
    context: str = "mechanism", is_default: bool = False,
    function_class: str | None = None,
) -> str:
    """Apply a single parameter change to the .py file.

    For mechanism params: finds var_name = pnl.XXX(..., param_name=OLD, ...)
    For function params: finds function=pnl.XXX(..., param_name=OLD, ...)
    within the var_name's constructor.

    If is_default is True and the param exists in code, removes it instead
    (since default values don't need to be written explicitly).

    Returns the updated source.
    """
    # Validate parameter value is a valid Python expression
    if not is_default:
        error = _validate_param_value(new_value)
        if error:
            raise ValueError(f"Invalid value for {param_name}: {error}")

    path = Path(file_path)
    source = path.read_text()
    lines = source.splitlines()

    # Find the start of this variable's declaration
    decl_start = None
    for i, line in enumerate(lines):
        if re.match(rf"^\s*{re.escape(var_name)}\s*=\s*{_CTOR}", line):
            decl_start = i
            break

    if decl_start is None:
        raise ValueError(f"Could not find declaration for '{var_name}' in {file_path}")

    # Find the end of the constructor call (matching parentheses)
    decl_end = _find_closing_paren(lines, decl_start)

    # Extract the declaration block
    block = "\n".join(lines[decl_start : decl_end + 1])

    if is_default:
        # Remove the param from code if it exists (default values are suppressed)
        if context == "function":
            updated_block = _remove_nested_param(block, "function", param_name)
        else:
            updated_block = _remove_direct_param(block, param_name)
        # If the param wasn't in the code, nothing to do — that's fine
        if updated_block == block:
            return source
    else:
        if context == "function":
            updated_block = _replace_nested_param(block, "function", param_name, new_value)
        else:
            updated_block = _replace_direct_param(block, param_name, new_value)

        # An unchanged block means one of three things, and they are not the
        # same:
        #
        #  - no `function=` to edit at all -> materialise the class default
        #  - the parameter already holds the requested value -> a no-op, which
        #    is success, not failure
        #  - neither of those -> genuinely could not find it
        #
        # Conflating the first two appended a SECOND `function=` on a no-op set
        # and produced `keyword argument repeated: function`, a file that no
        # longer parses. Walkthroughs and specs re-run against the same working
        # copy, so the second run hit it every time.
        #
        # The third case cannot arise for a missing parameter: _replace_*_param
        # inserts one when it is absent, so the block would have changed.
        if updated_block == block:
            has_function_arg = (
                re.search(rf"\bfunction\s*=\s*{_CTOR}", block) is not None
            )

            if context == "function" and not has_function_arg:
                if not function_class:
                    raise ValueError(
                        f"Could not find parameter '{param_name}' in {context} context "
                        f"for '{var_name}' in {file_path}"
                    )
                # Materialise the default being departed from, carrying the one
                # parameter asked for:
                #     function=pnl.DriftDiffusionAnalytical(threshold=2)
                #
                # This adds a line to the user's file, which is a real change —
                # but they just asked for a non-default value, and writing it
                # down is the honest way to record it (#1200).
                updated_block = _insert_param(
                    block,
                    "function",
                    f"{_ctor_prefix(block)}{function_class}({param_name}={new_value})",
                )
            else:
                # Already the requested value. Nothing to write.
                return source

    # Rebuild the source
    new_lines = lines[:decl_start] + updated_block.splitlines() + lines[decl_end + 1 :]
    updated_source = "\n".join(new_lines)
    write_generated_source(path, updated_source, operation="change a parameter")
    return updated_source


def apply_function_change(
    file_path: str, var_name: str, new_function_class: str,
) -> str:
    """Swap var_name's function= argument to a new function class with defaults.

    Example: function=pnl.Linear(slope=2.0, intercept=0.5)
          -> function=pnl.Logistic()

    Old function-specific params are dropped (since they may not apply to
    the new class). If the source had no explicit function= kwarg, one is
    inserted with the new class.
    """
    if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", new_function_class):
        raise ValueError(f"Invalid function class name: {new_function_class!r}")

    path = Path(file_path)
    source = path.read_text()
    lines = source.splitlines()

    decl_start = None
    for i, line in enumerate(lines):
        if re.match(rf"^\s*{re.escape(var_name)}\s*=\s*{_CTOR}", line):
            decl_start = i
            break
    if decl_start is None:
        raise ValueError(f"Could not find declaration for '{var_name}' in {file_path}")

    decl_end = _find_closing_paren(lines, decl_start)
    block = "\n".join(lines[decl_start : decl_end + 1])

    func_match = re.search(rf"\bfunction\s*=\s*{_CTOR}", block)
    if func_match is None:
        updated_block = _insert_param(block, "function", f"pnl.{new_function_class}()")
    else:
        func_start = func_match.start()
        inner_start = func_match.end()
        depth = 1
        inner_end = inner_start
        while inner_end < len(block) and depth > 0:
            if block[inner_end] == "(":
                depth += 1
            elif block[inner_end] == ")":
                depth -= 1
            inner_end += 1
        replacement = f"function=pnl.{new_function_class}()"
        updated_block = block[:func_start] + replacement + block[inner_end:]

    new_lines = lines[:decl_start] + updated_block.splitlines() + lines[decl_end + 1 :]
    updated_source = "\n".join(new_lines)
    write_generated_source(path, updated_source, operation="change a function")
    return updated_source


def write_model_source(path: Path | str, source: str) -> None:
    """Write model source to disk, telling the file watcher it was us.

    Every write to a model `.py` goes through here. The watcher records the
    content so the watchdog event for our own write is recognised as an echo
    rather than reported as an external edit (#926).
    """
    path = Path(path)
    # A file of the active PsyNeuLink is written only when its source allows
    # it: never for GitHub or PyPI, and for the user's own local checkout
    # unless they protected it (#1225, #1305).
    pnl_source_guard.guard_write(path)
    # Tell the watcher *before* writing, not after. The filesystem event can be
    # delivered to the watcher thread before a subsequent call here would land
    # — inotify is fast enough that it reliably is — and an event that arrives
    # before we have recorded the content looks like an external edit. Doing it
    # first closes the race in the only direction that matters.
    file_watcher.note_internal_write(str(path), source)
    path.write_text(source)


def write_generated_source(path: Path | str, source: str, operation: str = "edit") -> None:
    """Write source PsyNeuView composed, refusing to write what it cannot read.

    Every write on this path was assembled by the app — a structural change, a
    parameter edit, a rename — so if the result does not parse, the app has
    produced a broken model from a working one. Writing it anyway is the worst
    outcome an editor has: the damage is silent, lands in the user's own file,
    and surfaces later as a syntax error on a line they never touched.

    #1106 fixed one way that could happen (a parenthesis inside a comment
    throwing off the writers' paren counting). This catches the next one,
    whatever it turns out to be, by checking the result rather than trusting
    the method.

    Deliberately not applied to `save_source`: a person must be able to save
    half-written code. The distinction is who composed the text, not how valid
    it is.

    This is also where the view-only lock is enforced (#1116). The route checks
    it too, and that is the check a user meets — but every generated write
    already funnels through here, so putting it here as well means a new writer
    cannot forget it, and a caller that reaches the writer without going
    through the API still cannot change a locked model.
    """
    # Checked before parsing: a locked model should be refused because it is
    # locked, not because of whatever the writer happened to compose.
    guard_edit(path)

    try:
        ast.parse(source)
    except SyntaxError as e:
        raise ValueError(
            f"PsyNeuView would have written invalid Python while trying to "
            f"{operation} (line {e.lineno}: {e.msg}). The file has been left "
            f"unchanged. This is a bug in PsyNeuView, not in your model — "
            f"please report it."
        ) from e
    write_model_source(path, source)


def save_source(file_path: str, source: str) -> None:
    """Write source code directly to the file (from code editor saves).

    Not validated on purpose — see write_generated_source. This is the user's
    own text, and half-written code must be saveable.

    The view-only lock applies here too (#1320): a locked model is meant to be
    explored, not changed, and typing into its code was the one way left to
    change it. Checked before the write, so a refused save leaves the file
    exactly as it was; the route answers 409 ``model_view_only``.
    """
    guard_edit(file_path)
    write_model_source(file_path, source)


def guard_edit(path: Path | str) -> None:
    """Refuse an edit to the model at ``path``, naming the strictest rule (#1346).

    The rules that can stop an edit, checked in this order:

    1. **Where the file lives** (``pnl_source_guard``): a file of a PsyNeuLink
       that PsyNeuView manages, or of your own checkout you protected, is read
       only, whatever else is true of it.
    2. **The model's own rules** (``edit_lock.guard``), strictest first:
       a ``# PsyNeuView: protected permanently`` line in the file (no unlock
       in PsyNeuView); a ``# PsyNeuView: protected`` line, unless unlocked on
       this computer; the per-model lock in its layout file.

    Location first, so a model that is both in a protected checkout and
    locked is refused for the checkout: allowing edits to the checkout is the
    first thing to undo, and its message says how. ``write_model_source``
    checks the location again for writes that don't come through here.
    """
    pnl_source_guard.guard_write(path)
    edit_lock.guard(str(path))


def _find_closing_paren(lines: list[str], start: int) -> int:
    """Find the line containing the closing paren for a declaration starting at `start`.

    Counts only parentheses that are actually code. A comment like
    ``gain=1.0,  # the default is 1.0, see docs)`` used to close the call right
    there, so the writer inserted its closing paren mid-constructor and left
    the remaining arguments orphaned below — an ordinary parameter edit turning
    a working model into one that does not parse (#1102).
    """
    code = code_only_lines("\n".join(lines))
    depth = 0
    for i in range(start, len(lines)):
        line = code[i] if i < len(code) else lines[i]
        for ch in line:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    return i
    return start


def _replace_direct_param(block: str, param_name: str, new_value: str) -> str:
    """Replace param_name=OLD with param_name=NEW in a constructor block.
    If the parameter doesn't exist, insert it before the closing paren.
    Handles values that may contain parentheses (like function calls)."""
    # Match param_name= followed by the value, which ends at a comma+newline,
    # a closing paren, or end of line before a line with less indentation
    pattern = rf"(\b{re.escape(param_name)}\s*=\s*)"
    match = re.search(pattern, block)
    if not match:
        # Parameter not in source — insert it before the closing paren
        return _insert_param(block, param_name, new_value)

    # Find where the value starts
    val_start = match.end()
    # Find where the value ends — track parens/brackets
    val_end = _find_value_end(block, val_start)

    return block[:val_start] + new_value + block[val_end:]


def _insert_param(block: str, param_name: str, new_value: str) -> str:
    """Insert a new parameter into a constructor call, before the closing paren.
    For single-line calls, inserts inline. For multi-line, adds a new indented line."""
    # Find the last closing paren at depth 0, ignoring any that live inside a
    # comment or string — one of those used to be treated as the end of the
    # call, so the new parameter was inserted mid-constructor and everything
    # after it was orphaned (#1102).
    scan = code_only_text(block)
    depth = 0
    last_close = -1
    for i, ch in enumerate(scan):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                last_close = i
                break

    if last_close < 0:
        return block  # Can't find closing paren, give up

    before_close = block[:last_close]
    is_multiline = "\n" in before_close

    if not is_multiline:
        # Single-line: insert inline, e.g. Logistic(gain=0.8) → Logistic(gain=0.8, bias=0.1)
        trimmed = before_close.rstrip()
        if trimmed and trimmed[-1] not in (",", "("):
            return trimmed + f", {param_name}={new_value}" + block[last_close:]
        else:
            return trimmed + f"{param_name}={new_value}" + block[last_close:]
    else:
        # Multi-line: detect indentation and add a new line
        lines = before_close.splitlines()
        indent = "    "  # default
        for line in reversed(lines):
            stripped = line.lstrip()
            if stripped and "=" in stripped and not stripped.startswith("#"):
                indent = line[: len(line) - len(stripped)]
                break

        trimmed = before_close.rstrip()
        if trimmed and trimmed[-1] not in (",", "("):
            return trimmed + f",\n{indent}{param_name}={new_value}\n" + block[last_close:]
        else:
            return trimmed + f"\n{indent}{param_name}={new_value}\n" + block[last_close:]


def _remove_direct_param(block: str, param_name: str) -> str:
    """Remove a parameter from a constructor call entirely.
    E.g., pnl.Logistic(gain=1.0, bias=0.0) → pnl.Logistic(gain=1.0)"""
    # Match: param_name=VALUE possibly followed by comma+whitespace, or preceded by comma+whitespace
    pattern = rf"(\b{re.escape(param_name)}\s*=\s*)"
    match = re.search(pattern, block)
    if not match:
        return block

    val_start = match.end()
    val_end = _find_value_end(block, val_start)

    # Determine what to remove: the param, its value, and surrounding comma/whitespace
    remove_start = match.start()
    remove_end = val_end

    # Handle trailing comma
    rest = block[remove_end:]
    if rest and rest[0] == ",":
        remove_end += 1
        # Also eat whitespace/newline after comma
        while remove_end < len(block) and block[remove_end] in " \t\n":
            remove_end += 1
    else:
        # Handle leading comma (this param is not the first)
        before = block[:remove_start].rstrip()
        if before and before[-1] == ",":
            remove_start = len(before) - 1
            # Also eat the whitespace/newline before this param
            while remove_start > 0 and block[remove_start - 1] in " \t\n":
                remove_start -= 1
                if block[remove_start] == "\n":
                    break

    return block[:remove_start] + block[remove_end:]


def _remove_nested_param(block: str, outer_param: str, inner_param: str) -> str:
    """Remove a parameter from inside a nested function call."""
    pattern = rf"(\b{re.escape(outer_param)}\s*=\s*{_CTOR})"
    match = re.search(pattern, block)
    if not match:
        return block

    inner_start = match.end()
    depth = 1
    inner_end = inner_start
    while inner_end < len(block) and depth > 0:
        if block[inner_end] == "(":
            depth += 1
        elif block[inner_end] == ")":
            depth -= 1
        inner_end += 1

    inner_content = block[inner_start : inner_end - 1]
    inner_removed = _remove_direct_param(f"_({inner_content})", inner_param)
    inner_removed = inner_removed[2:-1]

    return block[:inner_start] + inner_removed + block[inner_end - 1 :]


def _replace_nested_param(
    block: str, outer_param: str, inner_param: str, new_value: str
) -> str:
    """Replace a parameter inside a nested function call.
    E.g., function=pnl.Logistic(gain=1.0) → function=pnl.Logistic(gain=2.0)
    """
    # Find the outer param (e.g., function=pnl.Logistic(...))
    pattern = rf"(\b{re.escape(outer_param)}\s*=\s*{_CTOR})"
    match = re.search(pattern, block)
    if not match:
        return block

    # Find the closing paren of the nested call
    inner_start = match.end()
    depth = 1
    inner_end = inner_start
    while inner_end < len(block) and depth > 0:
        if block[inner_end] == "(":
            depth += 1
        elif block[inner_end] == ")":
            depth -= 1
        inner_end += 1

    # Extract the inner content and replace the param
    inner_content = block[inner_start : inner_end - 1]  # exclude closing paren
    inner_replaced = _replace_direct_param(
        f"_({inner_content})", inner_param, new_value
    )
    # Strip our wrapper
    inner_replaced = inner_replaced[2:-1]  # remove _( and )

    return block[:inner_start] + inner_replaced + block[inner_end - 1 :]


def _find_value_end(text: str, start: int) -> int:
    """Find the end of a parameter value starting at `start`.
    Handles nested parens, brackets, strings."""
    depth = 0
    i = start
    in_string = None

    while i < len(text):
        ch = text[i]

        # String handling
        if in_string:
            if ch == in_string and (i == 0 or text[i - 1] != "\\"):
                in_string = None
            i += 1
            continue

        if ch in ("'", '"'):
            in_string = ch
            i += 1
            continue

        if ch in ("(", "[", "{"):
            depth += 1
        elif ch in (")", "]", "}"):
            if depth == 0:
                return i
            depth -= 1
        elif ch == "," and depth == 0:
            return i
        elif ch == "\n" and depth == 0:
            # Check if next non-whitespace line is a new param or closing paren
            rest = text[i + 1 :].lstrip(" \t")
            if rest and (rest[0] == ")" or re.match(r"\w+=", rest)):
                return i

        i += 1

    return len(text)


def apply_structural_change(file_path: str, changes: dict) -> str:
    """Apply structural changes (add/remove nodes, projections) to the .py file.

    changes dict can contain:
        add_node: {var_name, type, params}
        remove_node: {var_name}
        add_projection: {var_name, sender, receiver, type}
        remove_projection: {var_name}

    Returns the updated source.
    """
    path = Path(file_path)
    source = path.read_text()

    action = changes.get("action")

    if action == "add_node":
        source = _add_node(source, changes)
    elif action == "remove_node":
        source = _remove_node(source, changes)
    elif action == "add_projection":
        source = _add_projection(source, changes)
    elif action == "remove_projection":
        source = _remove_projection(source, changes)
    elif action == "add_gsc":
        source = _add_gsc_condition(source, changes)
    elif action == "remove_gsc":
        source = _remove_gsc_condition(source, changes)
    elif action == "add_basic_condition":
        source = _add_basic_condition(source, changes)
    elif action == "remove_basic_condition":
        source = _remove_basic_condition(source, changes)
    elif action == "set_termination":
        source = _set_termination_conditions(source, changes)
    elif action == "set_scheduler_mode":
        source = _set_scheduler_mode(source, changes)
    else:
        raise ValueError(f"Unknown structural action: {action}")

    write_generated_source(path, source, operation="change the graph")
    return source


def _find_section(source: str, section_name: str) -> tuple[int, int]:
    """Find the line range of a section delimited by comment banners.

    Returns (start_line_idx, end_line_idx) where end is the line before
    the next section banner (or end of file). Indices are 0-based into
    the lines list.
    """
    lines = source.splitlines()
    section_start = None
    section_end = None

    for i, line in enumerate(lines):
        # A banner is a top-level comment whose text *is* the section name —
        # not any comment mentioning it. `# Perceptual Mechanisms`, sitting
        # inside a function in PsyNeuLink's Predator-Prey script, used to match
        # "Mechanisms" and make everything down to the next banner look like the
        # Mechanisms section, so a new node was inserted into the middle of a
        # multi-line call. (#1129)
        if not line.startswith("#"):
            continue  # indented comments are inside something; banners are not
        label = line.lstrip("#").strip(" *=-").strip()
        # Starts with the section name, rather than merely containing it. Real
        # banners carry a description — `# Projections (with hand-set weight
        # matrices)` — so an exact match is too strict, while "contains"
        # matches `# Perceptual Mechanisms` halfway down a function.
        if label.lower().split("(")[0].strip().startswith(section_name.lower()):
            # Found the section header — skip the banner lines
            section_start = i
            # Skip banner lines (===... lines)
            while section_start < len(lines) - 1:
                section_start += 1
                if not lines[section_start].strip().startswith("#") and lines[section_start].strip() != "":
                    break
                if lines[section_start].strip() == "":
                    break

    if section_start is None:
        return (-1, -1)

    # Find end: next section banner or end of file
    section_end = len(lines)
    for i in range(section_start + 1, len(lines)):
        if "====" in lines[i] and lines[i].strip().startswith("#"):
            # Back up to before any blank lines before this banner
            section_end = i
            while section_end > section_start and lines[section_end - 1].strip() == "":
                section_end -= 1
            break

    return (section_start, section_end)


def _first_composition_line(source: str) -> int:
    """Line index of the first statement that builds a Composition, or -1.

    Used to place a new node before the Composition that will reference it
    (#1129). Reads the AST rather than matching text, because the assignment
    may be spelled `pnl.Composition(...)`, `Composition(...)` under a star
    import, or any of the Composition subclasses.

    Returns -1 when the source does not parse — files are often mid-edit, and
    the caller has a fallback.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return -1

    def builds_composition(node: ast.AST) -> bool:
        for inner in ast.walk(node):
            if not isinstance(inner, ast.Call):
                continue
            func = inner.func
            name = (
                func.attr if isinstance(func, ast.Attribute)
                else func.id if isinstance(func, ast.Name)
                else None
            )
            if name and name.endswith("Composition"):
                return True
        return False

    for stmt in tree.body:
        if builds_composition(stmt):
            # lineno is 1-based; the list index to insert *before* is one less.
            first = min(
                [stmt.lineno] + [d.lineno for d in getattr(stmt, "decorator_list", [])]
            )
            return max(0, first - 1)
    return -1


def _add_node(source: str, changes: dict) -> str:
    """Add a new mechanism declaration to the Mechanisms section."""
    var_name = changes["var_name"]
    mech_type = changes.get("type", "TransferMechanism")
    params = changes.get("params", {})
    comp_var = changes.get("composition", None)

    # Build parameter string
    param_parts = []
    for k, v in params.items():
        param_parts.append(f"    {k}={v}")
    param_parts.append(f"    name='{var_name}'")
    param_str = ",\n".join(param_parts)

    declaration = f"\n{var_name} = pnl.{mech_type}(\n{param_str}\n)\n"

    # Find Mechanisms section and append
    lines = source.splitlines()
    mech_start, mech_end = _find_section(source, "Mechanisms")

    if mech_start >= 0:
        # Insert at end of Mechanisms section
        lines.insert(mech_end, declaration)
    else:
        # No banner. Put the node before the Composition that will use it —
        # correct by construction, since a node has to exist before the
        # Composition referencing it, and readable, since it lands with the
        # other declarations rather than after everything.
        #
        # This used to append at the end of the file, which is usually harmless
        # and occasionally wrong: PsyNeuLink's own Predator-Prey Sebastian
        # REDUCED.py ends inside `if __name__ == "__main__":`, so a top-level
        # declaration appended there is an unexpected indent. (#1129)
        comp_line = _first_composition_line(source)
        if comp_line < 0:
            # Fall back to the old banner search, then to the end of the file.
            banner_start, _ = _find_section(source, "Compositions")
            comp_line = banner_start - 1 if banner_start >= 0 else -1
        if comp_line >= 0:
            lines.insert(comp_line, declaration)
        else:
            lines.append(declaration)

    source = "\n".join(lines)

    # Add to composition if specified
    if comp_var:
        source = _append_to_composition(source, comp_var, f"{comp_var}.add_node({var_name})")

    return source


def _remove_node(source: str, changes: dict) -> str:
    """Remove a mechanism declaration and its add_node/add_projection references."""
    var_name = changes["var_name"]
    lines = source.splitlines()
    # Depth is counted against a view with comments and strings blanked, so a
    # stray paren in a comment cannot end the declaration early (#1102).
    code = code_only_lines(source)
    result = []
    skip_until_close = False
    paren_depth = 0
    found_declaration = False

    for idx, line in enumerate(lines):
        # Skip the declaration: var_name = pnl.XXX(...)
        if re.match(rf"^\s*{re.escape(var_name)}\s*=\s*{_CTOR}", line):
            skip_until_close = True
            found_declaration = True
            paren_depth = 0

        if skip_until_close:
            counted = code[idx] if idx < len(code) else line
            paren_depth += counted.count("(") - counted.count(")")
            if paren_depth <= 0:
                skip_until_close = False
            continue

        # Skip add_node lines referencing this var
        if re.match(rf"^\w+\.add_node\(\s*{re.escape(var_name)}\s*\)", line.strip()):
            continue

        # Skip projections that reference this var as sender or receiver
        if re.match(rf"^\w+\.add_projection\(", line.strip()):
            # We keep projection removal to remove_projection
            pass

        result.append(line)

    # Removal is line-based: it recognises `var = pnl.Thing(...)` at the start of
    # a line, plus `comp.add_node(var)`. A mechanism declared inline inside a
    # pathway — `pathways=[[input_layer, get_attn, LSTM]]`, which is how free-form
    # models are often written — matches nothing, and this function used to hand
    # back the untouched source, which the API then reported as a successful edit.
    # The canvas had already dropped the node, so the picture and the file
    # disagreed with no error anywhere. Refuse instead. (#1092)
    if not found_declaration:
        raise ValueError(
            f"Couldn't remove '{var_name}' from the file. PsyNeuView can only delete "
            f"nodes that are assigned to a variable, like `{var_name} = pnl.TransferMechanism(...)`. "
            f"This one is written inline — edit the code directly to remove it."
        )

    return "\n".join(result)


def _add_projection(source: str, changes: dict) -> str:
    """Add a new projection declaration to the Projections section."""
    var_name = changes["var_name"]
    sender = changes["sender"]
    receiver = changes["receiver"]
    sender_port = changes.get("sender_port")
    receiver_port = changes.get("receiver_port")
    proj_type = changes.get("type", "MappingProjection")
    comp_var = changes.get("composition", None)

    # Build sender/receiver specs with optional port qualifiers. Mechanisms
    # are not subscriptable by port name in PsyNeuLink (`mech['p']` raises
    # TypeError), so reference the port through its collection. For this
    # drag-to-connect path the sender handle is always an output port and the
    # receiver handle an input port (#314).
    sender_spec = f"{sender}.output_ports['{sender_port}']" if sender_port else sender
    receiver_spec = f"{receiver}.input_ports['{receiver_port}']" if receiver_port else receiver

    declaration = (
        f"\n{var_name} = pnl.{proj_type}(\n"
        f"    sender={sender_spec},\n"
        f"    receiver={receiver_spec},\n"
        f"    name='{var_name}'\n"
        f")\n"
    )

    # Find Projections section and append
    lines = source.splitlines()
    proj_start, proj_end = _find_section(source, "Projections")

    if proj_start >= 0:
        lines.insert(proj_end, declaration)
    else:
        # Append before compositions section
        comp_start, _ = _find_section(source, "Compositions")
        if comp_start >= 0:
            lines.insert(comp_start - 1, declaration)
        else:
            lines.append(declaration)

    source = "\n".join(lines)

    # Add to composition
    if comp_var:
        source = _append_to_composition(source, comp_var, f"{comp_var}.add_projection({var_name})")

    return source


def _remove_projection(source: str, changes: dict) -> str:
    """Remove a projection declaration and its add_projection reference."""
    var_name = changes["var_name"]
    lines = source.splitlines()
    # As in _remove_node: count only real parens, never ones in a comment or
    # string, or the declaration ends in the wrong place (#1102).
    code = code_only_lines(source)
    result = []
    skip_until_close = False
    paren_depth = 0

    for idx, line in enumerate(lines):
        # Skip the declaration
        if re.match(rf"^\s*{re.escape(var_name)}\s*=\s*{_CTOR}", line):
            skip_until_close = True
            paren_depth = 0

        if skip_until_close:
            counted = code[idx] if idx < len(code) else line
            paren_depth += counted.count("(") - counted.count(")")
            if paren_depth <= 0:
                skip_until_close = False
            continue

        # Skip add_projection lines referencing this var
        if re.match(rf"^\w+\.add_projection\(\s*{re.escape(var_name)}\s*\)", line.strip()):
            continue

        result.append(line)

    return "\n".join(result)


def _add_gsc_condition(source: str, changes: dict) -> str:
    """Add a GraphStructureCondition line to the source.

    changes dict:
        composition: comp variable name (e.g., "comp")
        owner_var: owner node variable name
        gsc_type: condition class name (e.g., "BeforeNode")
        target_vars: list of target variable names
        params: optional dict of additional params
    """
    comp_var = changes["composition"]
    owner_var = changes["owner_var"]
    gsc_type = changes["gsc_type"]
    target_vars = changes.get("target_vars", [])
    params = changes.get("params", {})

    target_str = ", ".join(target_vars)
    param_parts = [f"{k}={v}" for k, v in params.items()] if params else []
    all_args = [target_str] + param_parts if param_parts else [target_str]
    args_str = ", ".join(all_args)

    line = f"{comp_var}.scheduler.add_condition({owner_var}, pnl.{gsc_type}({args_str}))"

    # Try to find the Scheduling section
    sched_start, sched_end = _find_section(source, "Scheduling")
    lines = source.splitlines()

    if sched_start >= 0:
        lines.insert(sched_end, line)
    else:
        # No Scheduling section — look for existing scheduler lines
        last_sched = -1
        for i, l in enumerate(lines):
            if re.match(r"^\w+\.scheduler\.add_condition\(", l.strip()):
                last_sched = i
        if last_sched >= 0:
            lines.insert(last_sched + 1, line)
        else:
            # No scheduler lines — add after the last composition add_node/add_projection
            last_comp_line = -1
            for i, l in enumerate(lines):
                if re.match(rf"^{re.escape(comp_var)}\.(add_node|add_projection)\(", l.strip()):
                    last_comp_line = i
            if last_comp_line >= 0:
                # Add a blank line and the scheduling section
                lines.insert(last_comp_line + 1, "")
                lines.insert(last_comp_line + 2, "# Scheduling")
                lines.insert(last_comp_line + 3, line)
            else:
                lines.append("")
                lines.append("# Scheduling")
                lines.append(line)

    return "\n".join(lines)


def _remove_gsc_condition(source: str, changes: dict) -> str:
    """Remove a GraphStructureCondition line from the source.

    changes dict:
        owner_var: owner node variable name
        gsc_type: condition class name
        target_var: target node variable name
    """
    owner_var = changes["owner_var"]
    gsc_type = changes["gsc_type"]
    target_var = changes["target_var"]

    lines = source.splitlines()
    pattern = re.compile(
        rf"^\w+\.scheduler\.add_condition\(\s*{re.escape(owner_var)}\s*,"
        rf"\s*pnl\.{re.escape(gsc_type)}\(\s*{re.escape(target_var)}"
    )
    result = [l for l in lines if not pattern.match(l.strip())]
    return "\n".join(result)


# GSC type names — used to distinguish GSC from basic conditions
_GSC_TYPES = {"BeforeNode", "BeforeNodes", "AfterNode", "AfterNodes",
              "AddEdgeTo", "RemoveEdgeFrom", "WithNode",
              "CustomGraphStructureCondition"}


# Composite condition types whose arguments are themselves conditions.
_COMPOSITE_TYPES = {"All", "Any", "And", "Or", "Not", "NWhen"}


def _build_condition_expr(condition_type: str, args: dict) -> str:
    """Build a PNL condition expression string from type and args.

    Flat conditions take a dependency node and/or an integer count:
        {"dependency": "sensor", "n": 2}  -> pnl.EveryNCalls(sensor, 2)
        {"n": 5}                          -> pnl.AtPass(5)
        {}                                -> pnl.Always()

    Composite conditions (All/Any/Not/...) nest other conditions via a
    "children" list of {type, args} specs, recursively:
        {"children": [{"type": "WhenFinished", "args": {"dependency": "a"}},
                      {"type": "AtPass", "args": {"n": 3}}]}
        -> pnl.All(pnl.WhenFinished(a), pnl.AtPass(3))
        Not -> single child:  pnl.Not(pnl.WhenFinished(a))
        NWhen -> single child + count: pnl.NWhen(pnl.WhenFinished(a), 2)
    """
    if condition_type in _COMPOSITE_TYPES:
        children = args.get("children", [])
        child_exprs = [
            _build_condition_expr(c["type"], c.get("args", {})) for c in children
        ]
        if condition_type == "NWhen":
            n = args.get("n")
            inner = child_exprs[0] if child_exprs else ""
            return f"pnl.NWhen({inner}, {n})" if n is not None else f"pnl.NWhen({inner})"
        return f"pnl.{condition_type}({', '.join(child_exprs)})"

    dep = args.get("dependency")
    n = args.get("n")

    if dep and n is not None:
        return f"pnl.{condition_type}({dep}, {n})"
    elif dep:
        return f"pnl.{condition_type}({dep})"
    elif n is not None:
        return f"pnl.{condition_type}({n})"
    else:
        return f"pnl.{condition_type}()"


def _add_basic_condition(source: str, changes: dict) -> str:
    """Add or replace a basic (non-GSC) condition for a node.

    If a basic condition already exists for this node, it is replaced.
    """
    comp_var = changes["composition"]
    owner_var = changes["owner_var"]
    condition_type = changes["condition_type"]
    args = changes.get("args", {})

    # First remove any existing basic condition for this node
    source = _remove_basic_condition(source, {"owner_var": owner_var})

    expr = _build_condition_expr(condition_type, args)
    line = f"{comp_var}.scheduler.add_condition({owner_var}, {expr})"

    # Place in the Scheduling section
    sched_start, sched_end = _find_section(source, "Scheduling")
    lines = source.splitlines()

    if sched_start >= 0:
        lines.insert(sched_end, line)
    else:
        # Look for existing scheduler lines
        last_sched = -1
        for i, l in enumerate(lines):
            if re.match(r"^\w+\.scheduler\.add_condition\(", l.strip()):
                last_sched = i
        if last_sched >= 0:
            lines.insert(last_sched + 1, line)
        else:
            last_comp_line = -1
            for i, l in enumerate(lines):
                if re.match(rf"^{re.escape(comp_var)}\.(add_node|add_projection)\(", l.strip()):
                    last_comp_line = i
            if last_comp_line >= 0:
                lines.insert(last_comp_line + 1, "")
                lines.insert(last_comp_line + 2, "# Scheduling")
                lines.insert(last_comp_line + 3, line)
            else:
                lines.append("")
                lines.append("# Scheduling")
                lines.append(line)

    return "\n".join(lines)


def _remove_basic_condition(source: str, changes: dict) -> str:
    """Remove a basic (non-GSC) condition for a node.

    Matches scheduler.add_condition(owner_var, pnl.XXX(...)) where XXX
    is NOT a GSC type.
    """
    owner_var = changes["owner_var"]
    lines = source.splitlines()

    # Build a pattern that matches any add_condition for this owner that is NOT a GSC
    gsc_alt = "|".join(re.escape(t) for t in _GSC_TYPES)
    result = []
    for l in lines:
        stripped = l.strip()
        # Check if it's an add_condition for this owner
        if re.match(rf"^\w+\.scheduler\.add_condition\(\s*{re.escape(owner_var)}\s*,", stripped):
            # Check if it's a GSC type — if so, keep it
            if re.search(rf"pnl\.({gsc_alt})\(", stripped):
                result.append(l)
            else:
                # It's a basic condition — skip it (remove)
                continue
        else:
            result.append(l)
    return "\n".join(result)


def _set_termination_conditions(source: str, changes: dict) -> str:
    """Write or replace termination conditions in the .py file.

    changes dict:
        composition: comp variable name
        conditions: {time_scale_name: {type, args}}
    """
    comp_var = changes["composition"]
    conditions = changes.get("conditions", {})

    # Build the assignment expression
    entries = []
    for ts_name, cond in conditions.items():
        cond_type = cond["type"]
        cond_args = cond.get("args", {})
        expr = _build_condition_expr(cond_type, cond_args)
        entries.append(f"    pnl.TimeScale.{ts_name}: {expr}")

    assignment = (
        f"{comp_var}.scheduler.termination_conds = {{\n"
        + ",\n".join(entries) + "\n}"
    )

    lines = source.splitlines()

    # Look for existing termination_conds assignment
    term_start = None
    for i, l in enumerate(lines):
        if re.match(rf"^{re.escape(comp_var)}\.scheduler\.termination_conds\s*=", l.strip()):
            term_start = i
            break

    if term_start is not None:
        # Find the end of the assignment (closing brace)
        term_end = term_start
        depth = 0
        for i in range(term_start, len(lines)):
            depth += lines[i].count("{") - lines[i].count("}")
            if depth <= 0:
                term_end = i
                break
        # No conditions left — drop the assignment entirely rather than
        # writing an empty `termination_conds = {}` line.
        if not entries:
            new_lines = lines[:term_start] + lines[term_end + 1:]
            return "\n".join(new_lines)
        # Replace the existing assignment
        new_lines = lines[:term_start] + [assignment] + lines[term_end + 1:]
        return "\n".join(new_lines)
    elif not entries:
        # Nothing to write and nothing existing — leave source untouched.
        return source
    else:
        # Insert after the last scheduler line
        sched_start, sched_end = _find_section(source, "Scheduling")
        if sched_start >= 0:
            lines.insert(sched_end, assignment)
        else:
            last_sched = -1
            for i, l in enumerate(lines):
                if re.match(r"^\w+\.scheduler\.", l.strip()):
                    last_sched = i
            if last_sched >= 0:
                lines.insert(last_sched + 1, assignment)
            else:
                lines.append("")
                lines.append(assignment)
        return "\n".join(lines)


def _set_scheduler_mode(source: str, changes: dict) -> str:
    """Set (or clear) the scheduler mode for a composition.

    changes dict:
        composition: comp variable name
        mode: "STANDARD" | "EXACT_TIME"

    STANDARD is PsyNeuLink's default, so selecting it removes any explicit
    assignment rather than writing a redundant line; EXACT_TIME writes
    ``<comp>.scheduler.mode = pnl.SchedulingMode.EXACT_TIME``.
    """
    comp_var = changes["composition"]
    mode = changes["mode"]
    if mode not in ("STANDARD", "EXACT_TIME"):
        raise ValueError(f"Unknown scheduler mode: {mode}")

    # Drop any existing mode assignment for this composition.
    pattern = re.compile(rf"^{re.escape(comp_var)}\.scheduler\.mode\s*=")
    lines = [l for l in source.splitlines() if not pattern.match(l.strip())]

    if mode == "STANDARD":
        return "\n".join(lines)

    assignment = f"{comp_var}.scheduler.mode = pnl.SchedulingMode.{mode}"
    source = "\n".join(lines)
    sched_start, sched_end = _find_section(source, "Scheduling")
    lines = source.splitlines()
    if sched_start >= 0:
        lines.insert(sched_end, assignment)
    else:
        last_sched = -1
        for i, l in enumerate(lines):
            if re.match(r"^\w+\.scheduler\.", l.strip()):
                last_sched = i
        if last_sched >= 0:
            lines.insert(last_sched + 1, assignment)
        else:
            lines.append("")
            lines.append("# Scheduling")
            lines.append(assignment)
    return "\n".join(lines)


def _append_to_composition(source: str, comp_var: str, statement: str) -> str:
    """Append a statement (add_node or add_projection) after the last
    existing add_node/add_projection call for the given composition."""
    lines = source.splitlines()
    last_add_idx = -1

    for i, line in enumerate(lines):
        if re.match(rf"^{re.escape(comp_var)}\.(add_node|add_projection)\(", line.strip()):
            last_add_idx = i

    if last_add_idx >= 0:
        lines.insert(last_add_idx + 1, statement)
    else:
        # No existing add calls — find the composition declaration and add after it
        for i, line in enumerate(lines):
            if re.match(rf"^{re.escape(comp_var)}\s*=\s*{_CTOR}", line):
                # Find end of declaration
                end = _find_closing_paren(lines, i)
                lines.insert(end + 1, statement)
                break

    return "\n".join(lines)


# ============================================================
# Port management (input_ports= / output_ports= mutation)
# ============================================================
#
# These helpers operate on the input_ports= / output_ports= kwarg of a
# mechanism constructor call. Three states are handled:
#
#   - Absent: the kwarg is not in the source (mechanism is using PNL
#     defaults). We insert it.
#   - String list: input_ports=["a", "b"]. We replace the value.
#   - Anything else (dict specs, tuple specs, variable references): we
#     refuse with a clear error — the user must edit the source by hand.
#
# Note that the caller passes the *current* ordered list of port names
# (as the introspector reports them) so we can compute the new list.
# This avoids the server having to re-introspect just to find the names.


def _parse_string_port_list(value_str: str) -> list[str]:
    """Parse an input_ports= / output_ports= value as a list of strings.

    Raises ValueError if the value is not a list literal of strings.
    """
    try:
        parsed = ast.literal_eval(value_str.strip())
    except (SyntaxError, ValueError) as e:
        raise ValueError(f"cannot parse {value_str!r} as a Python literal: {e}")
    if not isinstance(parsed, list):
        raise ValueError(f"expected a list, got {type(parsed).__name__}")
    if not all(isinstance(x, str) for x in parsed):
        raise ValueError("list contains non-string elements (advanced port specs not supported here)")
    return parsed


def _format_string_port_list(names: list[str]) -> str:
    """Format a list of port names as a Python list literal using single quotes."""
    return "[" + ", ".join(f"'{n}'" for n in names) + "]"


def _validate_port_name(name: str) -> None:
    if not name or not name.strip():
        raise ValueError("port name cannot be empty")
    if not _PORT_NAME_RE.match(name):
        raise ValueError(
            f"invalid port name {name!r}; must start with a letter or underscore "
            "and contain only letters, digits, underscores, or hyphens"
        )


def _set_port_list(
    file_path: str, var_name: str, port_kind: str, new_names: list[str]
) -> str:
    """Set the input_ports= / output_ports= kwarg of var_name to new_names.

    port_kind is 'input' or 'output'. Inserts the kwarg if absent. Replaces
    it if present as a string-only list. Raises ValueError if present in an
    unsupported form (dicts, tuples, variable references).

    Writes the file and returns the updated source.
    """
    if port_kind not in ("input", "output"):
        raise ValueError(f"port_kind must be 'input' or 'output', got {port_kind!r}")
    for n in new_names:
        _validate_port_name(n)
    if len(set(new_names)) != len(new_names):
        raise ValueError(f"duplicate port names in {new_names}")

    kwarg = f"{port_kind}_ports"
    new_value = _format_string_port_list(new_names)

    path = Path(file_path)
    source = path.read_text()
    lines = source.splitlines()

    decl_start = None
    for i, line in enumerate(lines):
        if re.match(rf"^\s*{re.escape(var_name)}\s*=\s*{_CTOR}", line):
            decl_start = i
            break
    if decl_start is None:
        raise ValueError(f"could not find declaration for {var_name!r} in {file_path}")

    decl_end = _find_closing_paren(lines, decl_start)
    block = "\n".join(lines[decl_start : decl_end + 1])

    pattern = rf"\b{kwarg}\s*=\s*"
    match = re.search(pattern, block)
    if match:
        val_start = match.end()
        val_end = _find_value_end(block, val_start)
        current_value = block[val_start:val_end]
        try:
            _parse_string_port_list(current_value)
        except ValueError as e:
            raise ValueError(
                f"{var_name}.{kwarg} is in an unsupported form for GUI editing "
                f"({e}); edit the source directly"
            )
        updated_block = block[:val_start] + new_value + block[val_end:]
    else:
        updated_block = _insert_param(block, kwarg, new_value)

    new_lines = lines[:decl_start] + updated_block.splitlines() + lines[decl_end + 1 :]
    updated_source = "\n".join(new_lines)
    write_generated_source(path, updated_source, operation="change a port list")
    return updated_source


def apply_port_rename(
    file_path: str,
    var_name: str,
    port_kind: str,
    current_names: list[str],
    old_name: str,
    new_name: str,
) -> str:
    """Rename a port on var_name from old_name to new_name.

    current_names is the full ordered list of existing port names (as the
    introspector reports them). port_kind is 'input' or 'output'.
    """
    if old_name not in current_names:
        raise ValueError(f"port {old_name!r} not in current {port_kind} ports {current_names}")
    if new_name in current_names and new_name != old_name:
        raise ValueError(f"port {new_name!r} already exists in {port_kind} ports")
    new_names = [new_name if n == old_name else n for n in current_names]
    return _set_port_list(file_path, var_name, port_kind, new_names)


def apply_node_rename(
    file_path: str,
    var_name: str,
    new_name: str,
    existing_names: list[str],
    current_name: str | None = None,
) -> str:
    """Rename a node's PsyNeuLink display name — the ``name=`` argument (#612).

    This renames what the graph, inspector, and run panel show: the PNL
    ``name=`` string on ``var_name``'s constructor (adding it if absent). The
    Python *variable* (``var_name``) is deliberately left untouched — node names
    routinely contain spaces and brackets ("Color Input", "STATE [VALUE]") that
    aren't valid Python identifiers, so renaming the variable in lockstep would
    break on exactly those. (Variable rename is a separate refactor, deferred to
    the in-graph rename follow-up.)

    Collision is *blocked*, not auto-suffixed: a deliberate rename to a name
    that's already taken is rejected so two nodes never share a name. (PNL's
    registry auto-suffixes its own auto-generated names with ``-N``; that does
    not apply to an explicit user rename.)
    """
    new_name = new_name.strip()
    if not new_name:
        raise ValueError("Node name cannot be empty")
    if current_name is not None and new_name == current_name:
        return Path(file_path).read_text()  # no-op
    if new_name in existing_names:
        raise ValueError(f"A node named {new_name!r} already exists")

    path = Path(file_path)
    source = path.read_text()
    lines = source.splitlines()

    decl_start = None
    for i, line in enumerate(lines):
        if re.match(rf"^\s*{re.escape(var_name)}\s*=\s*{_CTOR}", line):
            decl_start = i
            break
    if decl_start is None:
        raise ValueError(f"Could not find declaration for '{var_name}' in {file_path}")

    decl_end = _find_closing_paren(lines, decl_start)
    block = "\n".join(lines[decl_start : decl_end + 1])

    value = repr(new_name)  # safe, correctly-escaped Python string literal
    updated_block = _replace_direct_param(block, "name", value)
    if updated_block == block:  # no existing name= → add one
        updated_block = _insert_param(block, "name", value)
    if updated_block == block:
        raise ValueError(f"Could not set name for '{var_name}' in {file_path}")

    new_lines = lines[:decl_start] + updated_block.splitlines() + lines[decl_end + 1 :]
    updated_source = "\n".join(new_lines)
    write_generated_source(path, updated_source, operation="rename a node")
    return updated_source


def apply_port_add(
    file_path: str,
    var_name: str,
    port_kind: str,
    current_names: list[str],
    new_name: str,
) -> str:
    """Append a new port to var_name's input_ports or output_ports list."""
    if new_name in current_names:
        raise ValueError(f"port {new_name!r} already exists in {port_kind} ports")
    return _set_port_list(file_path, var_name, port_kind, current_names + [new_name])


def apply_port_remove(
    file_path: str,
    var_name: str,
    port_kind: str,
    current_names: list[str],
    port_name: str,
) -> str:
    """Remove a port from var_name's input_ports or output_ports list.

    Refuses to remove the last port — mechanisms must have at least one
    of each kind. Callers should warn the user separately about
    projections attached to the removed port (the source-write itself
    does not check projection state).
    """
    if port_name not in current_names:
        raise ValueError(f"port {port_name!r} not in current {port_kind} ports {current_names}")
    if len(current_names) == 1:
        raise ValueError(
            f"cannot remove the last {port_kind} port from {var_name}; "
            "mechanisms must have at least one"
        )
    new_names = [n for n in current_names if n != port_name]
    return _set_port_list(file_path, var_name, port_kind, new_names)

"""Convert free-form PsyNeuLink .py files to the standardized format.

When a user opens an existing hand-written script, we:
1. Execute it and introspect the live objects
2. Generate a new file in the standardized format
3. Back up the original as <filename>.original.py

Also provides star-import conversion: rewrites `from psyneulink import *`
to `import psyneulink as pnl` with all bare PNL class references prefixed.
"""

import io
import re
import shutil
import tokenize
from pathlib import Path

from app.services.clone_manager import artifact_path
from app.services.file_writer import write_model_source


FORMAT_HEADER_MARKER = "# PsyNeuLink Model File"


def is_standardized_format(source: str) -> bool:
    """Check if a source file is in the standardized PsyNeuLink format."""
    return source.strip().startswith(FORMAT_HEADER_MARKER)


def detect_format_issues(source: str) -> list[str]:
    """Detect potential issues with a free-form file.

    Returns a list of issue descriptions, or empty list if the file
    looks like it's already in standardized format.
    """
    issues = []

    if not source.strip().startswith(FORMAT_HEADER_MARKER):
        issues.append("Missing standardized format header")

    # Check for 'from psyneulink import *' (non-standard import)
    if re.search(r"from\s+psyneulink\s+import\s+\*", source):
        issues.append("Uses 'from psyneulink import *' instead of 'import psyneulink as pnl'")

    # Check for missing section banners
    if "# Mechanisms" not in source and "# ====" not in source:
        issues.append("Missing section banners (Mechanisms, Projections, Compositions)")

    return issues


def _get_pnl_public_names() -> set[str]:
    """Get the set of public names exported by psyneulink.

    This is used to know which bare names in a star-import file
    need to be prefixed with `pnl.`.
    """
    try:
        import psyneulink as pnl
        return {
            name for name in dir(pnl)
            if not name.startswith("_")
            and (isinstance(getattr(pnl, name), type) or name.isupper())
        }
    except ImportError:
        # Fallback: common PNL names if psyneulink isn't importable here
        return {
            "Composition", "AutodiffComposition",
            "TransferMechanism", "ProcessingMechanism", "IntegratorMechanism",
            "RecurrentTransferMechanism", "DDM", "LCAMechanism",
            "ObjectiveMechanism", "ComparatorMechanism",
            "ControlMechanism", "LearningMechanism",
            "MappingProjection", "ControlProjection", "LearningProjection",
            "AutoAssociativeProjection",
            "Linear", "Logistic", "ReLU", "SoftMax", "Exponential",
            "DriftDiffusionIntegrator", "SimpleIntegrator",
            "NodeRole", "TimeScale", "Context",
            "EveryNCalls", "AfterNCalls", "AtPass", "Always",
            "BeforeNode", "AfterNode", "AddEdgeTo", "RemoveEdgeFrom",
            "WithNode", "All", "Any", "Not",
            "IDENTITY_MATRIX", "FULL_CONNECTIVITY_MATRIX",
            "RANDOM_CONNECTIVITY_MATRIX", "RESULT", "OWNER_VALUE",
            "INPUT", "OUTPUT", "ENERGY", "ENTROPY",
        }


def convert_star_imports(source: str) -> tuple[str, bool]:
    """Convert `from psyneulink import *` to `import psyneulink as pnl`.

    Uses Python's tokenize module to safely walk the token stream,
    prefixing bare PNL class/constant names with `pnl.` while correctly
    skipping strings and comments.

    Returns (converted_source, was_converted). If the source doesn't
    use star imports, returns (source, False) unchanged.
    """
    # Check if conversion is needed
    star_import_pattern = re.compile(r"from\s+psyneulink\s+import\s+\*")
    if not star_import_pattern.search(source):
        return source, False

    pnl_names = _get_pnl_public_names()
    if not pnl_names:
        return source, False

    # Also collect names used in the source to avoid prefixing unused ones
    # (optimization, not strictly necessary)

    # Step 1: Replace the import line
    converted = star_import_pattern.sub("import psyneulink as pnl", source)

    # Step 2: Use tokenize to find bare PNL names and prefix them.
    # We rebuild the source from tokens, inserting "pnl." before matches.
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(converted).readline))
    except tokenize.TokenError:
        # If tokenization fails, fall back to regex (less safe but better than nothing)
        for name in sorted(pnl_names, key=len, reverse=True):
            # Only replace word-boundary matches not preceded by a dot
            converted = re.sub(
                rf"(?<!\.)(?<!\w)\b{re.escape(name)}\b(?!\s*=\s*(?!pnl\.))",
                f"pnl.{name}",
                converted,
            )
        return converted, True

    # Walk tokens and build replacement map: (row, col) → "pnl." prefix to insert
    insertions: list[tuple[int, int, str]] = []  # (line, col, name)

    for i, tok in enumerate(tokens):
        if tok.type != tokenize.NAME:
            continue
        if tok.string not in pnl_names:
            continue

        # Skip if already preceded by "pnl." (check previous token)
        if i > 0:
            prev = tokens[i - 1]
            if prev.type == tokenize.OP and prev.string == ".":
                continue

        # Skip if this is the left-hand side of an assignment at module scope
        # (e.g., `result = ...` where result happens to be a PNL name)
        # We allow this because it's the variable being assigned, not a PNL reference.
        # However, the name on the RHS should still be prefixed.
        # The check: if the NEXT non-whitespace token is `=` (but not `==`), skip.
        if i + 1 < len(tokens):
            nxt = tokens[i + 1]
            if nxt.type == tokenize.OP and nxt.string == "=" and (
                i + 2 >= len(tokens) or tokens[i + 2].string != "="
            ):
                continue

        # Skip if inside the import line itself (already handled)
        line_text = converted.split("\n")[tok.start[0] - 1] if tok.start[0] > 0 else ""
        if "import psyneulink" in line_text:
            continue

        insertions.append((tok.start[0], tok.start[1], tok.string))

    if not insertions:
        return converted, True  # Import was converted but no bare names found

    # Apply insertions in reverse order (so offsets don't shift)
    lines = converted.split("\n")
    for line_no, col, name in reversed(insertions):
        line_idx = line_no - 1
        line = lines[line_idx]
        lines[line_idx] = line[:col] + "pnl." + line[col:]

    return "\n".join(lines), True


def _protection_header(path) -> list[str]:
    """Keep a "# PsyNeuView: protected" line through a conversion (#1346).

    Converting writes a fresh header, so the line would be lost. A model that
    reaches this point with the line was unlocked on this computer (a
    protected one that isn't, and a permanently protected one, are refused
    before conversion), and unlocking leaves the line in the file.
    """
    from app.services import protection_line

    if protection_line.level(path) == protection_line.PROTECTED:
        return ["# PsyNeuView: protected"]
    return []


def convert_to_standard_format(
    file_path: str,
    backup: bool = True,
) -> str:
    """Convert a free-form .py file to standardized format.

    Executes the file, introspects the PsyNeuLink objects, and generates
    a new file in the standard format. Backs up the original.

    Returns the new source code.
    """
    import psyneulink as pnl
    import importlib.util
    import sys

    path = Path(file_path)
    original_source = path.read_text()

    # Back up original (redirected out of tree for managed clones — #349)
    if backup:
        backup_path = artifact_path(path.with_suffix(".original.py"))
        shutil.copy2(path, backup_path)

    # Execute to get live objects
    spec = importlib.util.spec_from_file_location("user_model_convert", file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["user_model_convert"] = module
    spec.loader.exec_module(module)

    # Collect all PsyNeuLink objects from the module namespace
    mechanisms = {}
    projections = {}
    compositions = {}

    for name, obj in vars(module).items():
        if name.startswith("_"):
            continue
        if isinstance(obj, pnl.Composition):
            compositions[name] = obj
        elif isinstance(obj, pnl.Mechanism):
            mechanisms[name] = obj
        elif isinstance(obj, pnl.Projection):
            projections[name] = obj

    # Find top-level compositions
    nested_ids = set()
    for comp in compositions.values():
        for node in comp.nodes:
            if isinstance(node, pnl.Composition):
                nested_ids.add(id(node))

    # #94 task 3: drop ``_<N>`` session-counter suffixes that PsyNeuLink
    # appended on re-instantiation, so MDF round-tripped scripts don't
    # come back looking like ``stroop_model_2`` / ``color_input_2``.
    # Rename across all dicts before we partition top-level vs nested,
    # so ``_find_var_name`` later sees the canonical names too.
    _drop_autoname_suffixes(mechanisms, projections, compositions)

    top_level = {k: v for k, v in compositions.items() if id(v) not in nested_ids}

    # Guard against lossy conversion (#421). The collection above only sees
    # *module-scope* objects. Models that build their components inside a
    # function (e.g. the EGO model's ``construct_model()``) expose only the
    # outer composition as a global, so every mechanism and nested
    # composition would be silently dropped — Convert would overwrite the
    # file with an empty stub. Refuse before writing anything so the original
    # is preserved and the user gets a clear explanation.
    uncovered = _uncovered_graph_nodes(top_level, mechanisms, compositions)
    if uncovered or not top_level:
        del sys.modules["user_model_convert"]
        if not top_level:
            raise ValueError(
                "no top-level Composition is exposed as a module-level "
                "variable, so there is nothing to convert."
            )
        sample = ", ".join(getattr(n, "name", repr(n)) for n in uncovered[:4])
        more = "" if len(uncovered) <= 4 else f", and {len(uncovered) - 4} more"
        raise ValueError(
            f"this model builds its components inside a function, so "
            f"{len(uncovered)} object(s) ({sample}{more}) are not reachable "
            f"as module-level variables and would be lost. The file was left "
            f"unchanged. Convert to Standard Format only supports models whose "
            f"mechanisms and compositions are assigned to top-level variables."
        )

    # MDF-imported scripts construct projections inline inside
    # ``add_projection(...)`` calls, so ``vars(module)`` never sees them and
    # the Projections section came out empty (#101). Walk the live
    # compositions and synthesize module-scope names for those projections.
    _synthesize_inline_projection_vars(compositions, mechanisms, projections)

    # Sort every top-level declaration list alphabetically by var name so
    # two textually equivalent scripts that declare components in different
    # orders normalize to the same standardized output (#220). Composition
    # member order is sorted at emission time below.
    mechanisms = dict(sorted(mechanisms.items()))
    projections = dict(sorted(projections.items()))
    compositions = dict(sorted(compositions.items()))
    top_level = dict(sorted(top_level.items()))

    # Clean up
    del sys.modules["user_model_convert"]

    # Generate standardized source
    current_version = getattr(pnl, "__version__", "unknown")
    model_name = list(top_level.keys())[0] if top_level else "model"

    lines = [
        "# PsyNeuLink Model File",
        "# Format Version: 1.0",
        f"# PsyNeuLink: {current_version}",
        f"# Model: {model_name}",
        *_protection_header(path),
        "",
        "import psyneulink as pnl",
        "",
        "# ============================================================",
        "# Mechanisms",
        "# ============================================================",
        "",
    ]

    # Generate mechanism declarations
    for var_name, mech in mechanisms.items():
        lines.extend(_generate_mechanism(var_name, mech))
        lines.append("")

    lines.extend([
        "# ============================================================",
        "# Projections",
        "# ============================================================",
        "",
    ])

    # Generate projection declarations
    for var_name, proj in projections.items():
        lines.extend(_generate_projection(var_name, proj, mechanisms))
        lines.append("")

    lines.extend([
        "# ============================================================",
        "# Compositions",
        "# ============================================================",
        "",
    ])

    # Generate composition declarations and structure, walking innermost
    # first so each `add_node(<nested>)` reference resolves forward (#234).
    for var_name, comp in _composition_emit_order(compositions):
        comp_type = type(comp).__name__
        lines.append(f"{var_name} = pnl.{comp_type}(name='{var_name}')")
        lines.append("")
        lines.append("# --- Structure ---")

        # Add nodes — sorted alphabetically so the emission order is
        # independent of the user's `add_node` call sequence (#220).
        node_vars = []
        for node in comp.nodes:
            node_var = _find_var_name(node, mechanisms, compositions)
            if node_var:
                node_vars.append(node_var)
        for node_var in sorted(node_vars):
            lines.append(f"{var_name}.add_node({node_var})")

        # Add projections — sorted alphabetically, same reasoning.
        proj_vars = []
        for proj in comp.projections:
            # Skip CIM projections
            if proj.sender.owner and "CIM" in proj.sender.owner.name:
                continue
            if proj.receiver.owner and "CIM" in proj.receiver.owner.name:
                continue
            proj_var = _find_var_name(proj, projections)
            if proj_var:
                proj_vars.append(proj_var)
        for proj_var in sorted(proj_vars):
            lines.append(f"{var_name}.add_projection({proj_var})")

        lines.append("")

    new_source = "\n".join(lines)
    write_model_source(path, new_source)
    return new_source


def _uncovered_graph_nodes(top_level: dict, mechanisms: dict, compositions: dict) -> list:
    """Return graph nodes not represented by a collected module-scope variable.

    Walks every top-level composition (recursing into nested compositions) and
    collects each mechanism / nested composition whose identity is absent from
    the module-scope ``mechanisms`` and ``compositions`` dicts. A non-empty
    result means conversion would silently drop those objects (#421).
    """
    import psyneulink as pnl

    known = {id(m) for m in mechanisms.values()} | {id(c) for c in compositions.values()}
    uncovered: list = []
    visited: set[int] = set()

    def visit(comp) -> None:
        for node in comp.nodes:
            if id(node) not in known:
                uncovered.append(node)
            if isinstance(node, pnl.Composition) and id(node) not in visited:
                visited.add(id(node))
                visit(node)

    for comp in top_level.values():
        visited.add(id(comp))
        visit(comp)
    return uncovered


def _composition_emit_order(compositions: dict) -> list[tuple[str, object]]:
    """Order compositions innermost-first so emission resolves forward references.

    Each composition is yielded only after all of its nested-composition
    descendants — so when the outer composition's ``add_node(<inner>)``
    line is written, ``<inner>`` has already been declared above.

    Within an independent level the alphabetical order from
    ``compositions`` (already sorted by caller) is preserved, keeping
    canonicalization order-stable.
    """
    import psyneulink as pnl

    id_to_var = {id(c): name for name, c in compositions.items()}
    visited: set[int] = set()
    ordered: list[tuple[str, object]] = []

    def visit(var_name: str, comp) -> None:
        if id(comp) in visited:
            return
        visited.add(id(comp))
        for node in comp.nodes:
            if isinstance(node, pnl.Composition):
                child_var = id_to_var.get(id(node))
                if child_var is not None:
                    visit(child_var, node)
        ordered.append((var_name, comp))

    for var_name, comp in compositions.items():
        visit(var_name, comp)
    return ordered


def _synthesize_inline_projection_vars(
    compositions: dict, mechanisms: dict, projections: dict
) -> None:
    """Name projections that exist in a composition but not at module scope.

    Synthesizes a stable ``proj_<sender>_<receiver>`` entry (suffixed ``_2``,
    ``_3``… on collision, e.g. parallel projections between the same pair) so
    they get emitted in the Projections section and the corresponding
    ``add_projection`` call instead of being silently dropped (#101). CIM
    projections are skipped, mirroring the emission loop.
    """
    known = {id(p) for p in projections.values()}
    for comp in compositions.values():
        for proj in comp.projections:
            if id(proj) in known:
                continue
            sender = proj.sender.owner
            receiver = proj.receiver.owner
            if (sender and "CIM" in sender.name) or (
                receiver and "CIM" in receiver.name
            ):
                continue
            sender_var = _find_var_name(sender, mechanisms, compositions) or sender.name
            receiver_var = (
                _find_var_name(receiver, mechanisms, compositions) or receiver.name
            )
            base = "proj_{}_{}".format(
                re.sub(r"\W+", "_", sender_var), re.sub(r"\W+", "_", receiver_var)
            )
            var_name = base
            n = 2
            while var_name in projections:
                var_name = f"{base}_{n}"
                n += 1
            projections[var_name] = proj
            known.add(id(proj))


def _find_var_name(obj, *dicts) -> str | None:
    """Find the variable name for a PsyNeuLink object in the module namespace."""
    for d in dicts:
        for name, val in d.items():
            if val is obj:
                return name
    return None


def _generate_mechanism(var_name: str, mech) -> list[str]:
    """Generate a mechanism declaration in standard format."""
    mech_type = type(mech).__name__
    params = []

    # input_shapes from input ports
    if mech.input_ports:
        shape = list(mech.input_ports[0].defaults.value.shape)
        params.append(f"    input_shapes={shape}")

    # Function
    if hasattr(mech, "function") and mech.function is not None:
        func = mech.function
        func_type = type(func).__name__
        func_params = _get_non_default_params(func)
        if func_params:
            func_str = f"pnl.{func_type}({', '.join(f'{k}={v!r}' for k, v in func_params.items())})"
        else:
            func_str = f"pnl.{func_type}()"
        params.append(f"    function={func_str}")

    params.append(f"    name='{var_name}'")

    return [
        f"{var_name} = pnl.{mech_type}(",
        ",\n".join(params),
        ")",
    ]


def _generate_projection(var_name: str, proj, mechanisms: dict) -> list[str]:
    """Generate a projection declaration in standard format."""
    proj_type = type(proj).__name__
    sender_var = _find_var_name(proj.sender.owner, mechanisms) or proj.sender.owner.name
    receiver_var = _find_var_name(proj.receiver.owner, mechanisms) or proj.receiver.owner.name

    return [
        f"{var_name} = pnl.{proj_type}(",
        f"    sender={sender_var},",
        f"    receiver={receiver_var},",
        f"    name='{var_name}'",
        ")",
    ]


def _get_non_default_params(func) -> dict:
    """Get function parameters that differ from class defaults.

    Strips kwargs whose value matches the class-level default so the
    generated Standard format source only spells out what the user
    actually customized (#94 task 2).

    Note: PsyNeuLink stores the constructor argument as the *instance's*
    ``Parameter.default_value`` — so comparing against
    ``param.default_value`` would always look default. We compare against
    the *class*-level default instead (``type(func).parameters.<name>``).
    """
    # Common params that are always default / not user-facing kwargs.
    skip = {
        "variable", "value", "execution_count", "num_executions",
        "is_finished_flag", "has_initializers", "changes_shape",
        "enable_output_type_conversion", "max_executions_before_finished",
        "output_type", "multiplicative_param", "additive_param",
        "num_executions_before_finished",
    }

    result = {}
    if not hasattr(func, "parameters"):
        return result

    cls_params = getattr(type(func), "parameters", None)

    for param_name in func.parameters.names():
        if param_name in skip:
            continue
        try:
            param = getattr(func.parameters, param_name)
            current = param.get()

            cls_default = None
            if cls_params is not None:
                cls_param = getattr(cls_params, param_name, None)
                if cls_param is not None:
                    cls_default = getattr(cls_param, "default_value", None)

            if _values_equal(current, cls_default):
                continue

            if isinstance(current, (int, float, str, bool)):
                result[param_name] = current
        except Exception:
            pass

    return result


def _values_equal(a, b) -> bool:
    """Compare two parameter values, tolerating numpy scalars/arrays.

    PsyNeuLink frequently stores scalar values as 0-d numpy arrays, which
    breaks naive ``==`` comparison when one side is a Python scalar.
    """
    try:
        import numpy as np
        if isinstance(a, np.ndarray) or isinstance(b, np.ndarray):
            return bool(np.array_equal(np.asarray(a), np.asarray(b)))
    except ImportError:
        pass
    try:
        return bool(a == b)
    except Exception:
        return False


_AUTONAME_SUFFIX_RE = re.compile(r"_\d+$")


def _canonical_name(name: str) -> str:
    """Strip a trailing ``_<digits>`` session-counter suffix from a name."""
    return _AUTONAME_SUFFIX_RE.sub("", name)


def _drop_autoname_suffixes(*dicts: dict) -> None:
    """Rename var keys with auto-counter suffixes back to canonical form (#94 task 3).

    PsyNeuLink appends ``_1``, ``_2``, ... to component names when a name
    already exists in the global registry — so MDF round-tripped scripts
    can land in the converter with vars like ``color_input_1``,
    ``stroop_model_2``. When the canonical (suffix-stripped) name is not
    already taken across *all* tracked dicts, rename in-place.

    Mutates each dict directly. Object identity is preserved.
    """
    taken = set()
    for d in dicts:
        taken.update(d.keys())

    for d in dicts:
        for old_name in list(d.keys()):
            new_name = _canonical_name(old_name)
            if new_name == old_name:
                continue
            # Only rename if canonical form is free across all dicts.
            if new_name in taken:
                continue
            d[new_name] = d.pop(old_name)
            taken.discard(old_name)
            taken.add(new_name)

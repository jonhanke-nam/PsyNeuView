"""AST-based extractor that converts a pytest test method into a standalone .py.

Phase 2 of #249 (tracked as #254). Given a path to a PsyNeuLink test file and a
qualified ``Class.method`` name, produces a runnable .py file with:

1. Module-level imports lifted verbatim from the source.
2. A parameter block at the top — one constant per ``@pytest.mark.parametrize``
   axis, defaulted to the first value in each parametrize's value list. This is
   the "play one variant of the test" entry point.
3. The method body hoisted to module level (``self`` references stripped).
4. ``pytest.skip("reason")`` calls rewritten to
   ``print("SKIPPED: reason"); sys.exit(0)`` so the file remains runnable
   while transparently reporting the skip.

The output is intended to be loaded into PsyNeuView as a regular model later
(Phase 3). For now this module exposes both a Python API (``extract_test``)
and a CLI (``python -m app.services.test_extractor ...``).

Known limitations in this phase:

- Pytest fixtures other than ``self`` are not supported. If a target method
  takes any parameter not covered by a ``@pytest.mark.parametrize`` axis,
  extraction fails with a clear error.
- ``pytest.param(value, marks=..., id=...)`` wrappers in the value list are
  not unwrapped. The concrete target (``test_simple_execution_without_learning``)
  uses raw values/tuples; we'll generalize when a real consumer needs it.
- ``ids=[x[0] for x in ...]`` and other computed ``ids`` are ignored
  (they're labels for pytest IDs, not relevant to the extracted variant).
"""

from __future__ import annotations

import argparse
import ast
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


class ExtractionError(Exception):
    """Raised when the test cannot be extracted (with a human-readable reason)."""


@dataclass
class TestRef:
    """One discovered pytest test — enough metadata to feed ``extract_test`` later.

    ``file`` is the absolute path to the source ``test_*.py``. ``class_name`` is
    ``None`` for module-level test functions; otherwise it's the enclosing class.
    """
    file: Path
    class_name: Optional[str]
    method_name: str

    @property
    def qualified_name(self) -> str:
        if self.class_name is None:
            return self.method_name
        return f"{self.class_name}.{self.method_name}"


@dataclass
class ParametrizeAxis:
    """One ``@pytest.mark.parametrize`` decorator's contribution to the param block.

    ``arg_names`` is the (possibly multi-element) list of argument names declared
    in the first positional arg of the decorator. ``first_values`` lines up 1:1
    with ``arg_names`` — for a single-arg parametrize there is exactly one value;
    for a multi-arg parametrize the value list's first entry is unpacked into
    one value per name.
    """
    arg_names: list[str]
    first_values: list[ast.expr]


def extract_test(source_path: Path, qualified_name: str) -> str:
    """Read ``source_path``, locate the method named ``Class.method``, and
    return the generated standalone module source as a string.

    Does not write to disk — caller chooses the output path.
    """
    source = source_path.read_text()
    module = ast.parse(source, filename=str(source_path))

    method, containing_class = _find_method(module, qualified_name)
    if method is None:
        raise ExtractionError(
            f"could not find {qualified_name!r} in {source_path}; expected "
            f"'ClassName.method_name' or 'method_name' for a module-level function"
        )

    axes = _collect_parametrize_axes(method, module, containing_class)
    _verify_method_signature(method, axes, qualified_name)

    imports = _lift_module_imports(module)
    param_block = _build_param_block(axes)
    body = _transform_body(method.body)

    return _assemble_module_source(
        source_path=source_path,
        qualified_name=qualified_name,
        imports=imports,
        param_block=param_block,
        body=body,
    )


def discover_tests(source_tree: Path, subdir: str = "tests/composition") -> list[TestRef]:
    """Walk every ``test_*.py`` under ``source_tree/subdir`` and return every
    ``test_*`` method (in any class) plus module-level ``test_*`` functions.

    Does **not** pre-flight extractability — calling ``extract_test`` later may
    still raise ``ExtractionError`` for tests that depend on unsupported fixtures
    or parametrize shapes. Pre-flighting would require fully resolving every
    parametrize axis for every test, which is more expensive than the click-time
    failure path that surfaces an inline error in the dropdown.
    """
    root = source_tree / subdir
    if not root.exists():
        raise FileNotFoundError(f"discovery root does not exist: {root}")

    refs: list[TestRef] = []
    for path in sorted(root.glob("test_*.py")):
        refs.extend(_discover_in_file(path))
    return refs


def _discover_in_file(path: Path) -> list[TestRef]:
    """Parse a single ``test_*.py`` and return every test method/function it declares.

    Unparseable files are skipped silently — discovery shouldn't fail the whole
    walk because one file is mid-edit or has a syntax error.
    """
    try:
        source = path.read_text()
        module = ast.parse(source, filename=str(path))
    except (OSError, SyntaxError):
        return []

    refs: list[TestRef] = []
    for node in module.body:
        if isinstance(node, ast.ClassDef):
            for child in node.body:
                if (
                    isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
                    and child.name.startswith("test_")
                ):
                    refs.append(TestRef(file=path, class_name=node.name, method_name=child.name))
        elif (
            isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name.startswith("test_")
        ):
            refs.append(TestRef(file=path, class_name=None, method_name=node.name))
    return refs


def _find_method(
    module: ast.Module, qualified_name: str
) -> tuple[Optional[ast.FunctionDef], Optional[ast.ClassDef]]:
    """Locate a ``Class.method`` or bare ``function`` definition.

    Returns ``(function_node, class_node)`` — ``class_node`` is ``None`` for
    module-level functions. Constant lookups later need the containing class
    to disambiguate shadowed names (e.g., two ``args_names`` constants, one
    per test class).
    """
    if "." in qualified_name:
        class_name, method_name = qualified_name.split(".", 1)
        for node in module.body:
            if isinstance(node, ast.ClassDef) and node.name == class_name:
                for child in node.body:
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) and child.name == method_name:
                        return child, node
        return None, None

    for node in module.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == qualified_name:
            return node, None
    return None, None


def _collect_parametrize_axes(
    method: ast.FunctionDef,
    module: ast.Module,
    containing_class: Optional[ast.ClassDef],
) -> list[ParametrizeAxis]:
    """Walk the method's decorators, pull out every ``@pytest.mark.parametrize``,
    and resolve each one to a ``ParametrizeAxis`` with concrete first-values."""
    axes: list[ParametrizeAxis] = []
    for dec in method.decorator_list:
        if not _is_parametrize_call(dec):
            continue
        if len(dec.args) < 2:
            raise ExtractionError(
                "parametrize decorator with fewer than 2 positional args is unsupported"
            )
        arg_names = _resolve_arg_names(dec.args[0], module, containing_class)
        values_node = _resolve_values(dec.args[1], module, containing_class)
        first_entry = _first_entry(values_node)
        first_values = _unpack_to_args(first_entry, arg_names)
        axes.append(ParametrizeAxis(arg_names=arg_names, first_values=first_values))
    return axes


def _is_parametrize_call(node: ast.expr) -> bool:
    """Match ``pytest.mark.parametrize(...)`` decorator calls."""
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    if not isinstance(func, ast.Attribute) or func.attr != "parametrize":
        return False
    mark = func.value
    if not isinstance(mark, ast.Attribute) or mark.attr != "mark":
        return False
    pytest_name = mark.value
    return isinstance(pytest_name, ast.Name) and pytest_name.id == "pytest"


def _resolve_arg_names(
    node: ast.expr, module: ast.Module, containing_class: Optional[ast.ClassDef]
) -> list[str]:
    """``@parametrize`` accepts arg names as either a comma-separated string
    or a list/tuple of strings. Resolve to a flat list of names."""
    if isinstance(node, ast.Name):
        node = _lookup_module_constant(node.id, module, containing_class)
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return [name.strip() for name in node.value.split(",") if name.strip()]
    if isinstance(node, (ast.List, ast.Tuple)):
        names = []
        for elt in node.elts:
            if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                names.append(elt.value)
            else:
                raise ExtractionError(
                    f"parametrize arg-name element must be a string literal, got {ast.dump(elt)}"
                )
        return names
    raise ExtractionError(
        f"unsupported parametrize arg-names form: {ast.dump(node)}"
    )


def _resolve_values(
    node: ast.expr, module: ast.Module, containing_class: Optional[ast.ClassDef]
) -> ast.expr:
    """Resolve a Name referring to a module-level or class-level constant to its value node."""
    if isinstance(node, ast.Name):
        return _lookup_module_constant(node.id, module, containing_class)
    return node


def _lookup_module_constant(
    name: str, module: ast.Module, containing_class: Optional[ast.ClassDef]
) -> ast.expr:
    """Find a ``name = <expr>`` assignment, preferring the containing class.

    Search order: the target's own class body first (shadowing wins), then
    the module body. We deliberately do NOT scan other classes — two test
    classes can legitimately reuse the same constant name with different values.
    """
    if containing_class is not None:
        for child in containing_class.body:
            if isinstance(child, ast.Assign):
                for target in child.targets:
                    if isinstance(target, ast.Name) and target.id == name:
                        return child.value
    for node in module.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == name:
                    return node.value
    raise ExtractionError(
        f"could not resolve identifier {name!r} to a constant in the containing "
        f"class or module body"
    )


def _first_entry(values_node: ast.expr) -> ast.expr:
    """Pick the first element of a parametrize value list/tuple."""
    if isinstance(values_node, (ast.List, ast.Tuple)):
        if not values_node.elts:
            raise ExtractionError("parametrize value list is empty")
        return values_node.elts[0]
    raise ExtractionError(
        f"parametrize values must be a list or tuple, got {ast.dump(values_node)}"
    )


def _unpack_to_args(first_entry: ast.expr, arg_names: list[str]) -> list[ast.expr]:
    """For a single-arg parametrize the first entry IS the value. For a multi-arg
    parametrize the first entry is a tuple whose elements line up with arg_names."""
    if len(arg_names) == 1:
        return [first_entry]
    if isinstance(first_entry, (ast.Tuple, ast.List)):
        if len(first_entry.elts) != len(arg_names):
            raise ExtractionError(
                f"parametrize first entry has {len(first_entry.elts)} elements but "
                f"declares {len(arg_names)} arg names: {arg_names}"
            )
        return list(first_entry.elts)
    raise ExtractionError(
        f"multi-arg parametrize requires a tuple of values for the first entry, "
        f"got {ast.dump(first_entry)}"
    )


def _verify_method_signature(
    method: ast.FunctionDef,
    axes: list[ParametrizeAxis],
    qualified_name: str,
) -> None:
    """The method's positional args (minus ``self``) must be exactly the union
    of all parametrize axes. Anything else means an unsupported fixture."""
    provided_names = {name for axis in axes for name in axis.arg_names}
    method_args = [a.arg for a in method.args.args if a.arg != "self"]
    missing = [a for a in method_args if a not in provided_names]
    if missing:
        raise ExtractionError(
            f"{qualified_name} has parameters not covered by any parametrize axis: "
            f"{missing}. Pytest fixtures other than 'self' are not supported in Phase 2."
        )


def _lift_module_imports(module: ast.Module) -> list[ast.stmt]:
    """Copy every top-level Import / ImportFrom node, preserving order."""
    return [node for node in module.body if isinstance(node, (ast.Import, ast.ImportFrom))]


def _build_param_block(axes: list[ParametrizeAxis]) -> list[ast.stmt]:
    """Emit one ``name = <first_value>`` per parametrize arg, in source order."""
    stmts: list[ast.stmt] = []
    for axis in axes:
        for name, value in zip(axis.arg_names, axis.first_values):
            stmts.append(
                ast.Assign(
                    targets=[ast.Name(id=name, ctx=ast.Store())],
                    value=value,
                )
            )
    return stmts


def _transform_body(body: list[ast.stmt]) -> list[ast.stmt]:
    """Apply per-statement rewrites: pytest.skip -> print+sys.exit; strip self."""
    transformer = _BodyTransformer()
    new_body: list[ast.stmt] = []
    for stmt in body:
        result = transformer.visit(stmt)
        if isinstance(result, list):
            new_body.extend(result)
        else:
            new_body.append(result)
    return new_body


class _BodyTransformer(ast.NodeTransformer):
    """Two rewrites we need on the lifted method body:

    1. ``pytest.skip("reason")`` becomes a print + ``sys.exit(0)`` pair.
    2. ``self.something`` becomes ``something`` (a method-call rewrite — the
       concrete Phase 2 target doesn't exercise this but the transformer
       handles it for robustness).
    """

    def visit_Expr(self, node: ast.Expr) -> ast.AST | list[ast.stmt]:
        skip_arg = self._match_pytest_skip(node.value)
        if skip_arg is not None:
            return self._build_skip_replacement(skip_arg)
        return self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> ast.AST:
        if isinstance(node.value, ast.Name) and node.value.id == "self":
            return ast.copy_location(ast.Name(id=node.attr, ctx=node.ctx), node)
        return self.generic_visit(node)

    @staticmethod
    def _match_pytest_skip(value: ast.expr) -> Optional[ast.expr]:
        if not isinstance(value, ast.Call):
            return None
        func = value.func
        if (
            isinstance(func, ast.Attribute)
            and func.attr == "skip"
            and isinstance(func.value, ast.Name)
            and func.value.id == "pytest"
        ):
            return value.args[0] if value.args else ast.Constant(value="")
        return None

    @staticmethod
    def _build_skip_replacement(reason: ast.expr) -> list[ast.stmt]:
        # print("SKIPPED: " + reason)
        print_call = ast.Expr(
            value=ast.Call(
                func=ast.Name(id="print", ctx=ast.Load()),
                args=[
                    ast.BinOp(
                        left=ast.Constant(value="SKIPPED: "),
                        op=ast.Add(),
                        right=reason,
                    )
                ],
                keywords=[],
            )
        )
        # sys.exit(0)
        exit_call = ast.Expr(
            value=ast.Call(
                func=ast.Attribute(
                    value=ast.Name(id="sys", ctx=ast.Load()),
                    attr="exit",
                    ctx=ast.Load(),
                ),
                args=[ast.Constant(value=0)],
                keywords=[],
            )
        )
        return [print_call, exit_call]


def _assemble_module_source(
    source_path: Path,
    qualified_name: str,
    imports: list[ast.stmt],
    param_block: list[ast.stmt],
    body: list[ast.stmt],
) -> str:
    """Produce the final source string with headers separating each section."""
    header = (
        f"# Auto-generated by app.services.test_extractor from\n"
        f"#   {source_path}::{qualified_name}\n"
        f"# Edit the test parameters block to vary the test inputs.\n"
    )
    sys_import = ast.Import(names=[ast.alias(name="sys", asname=None)])

    output_module = ast.Module(
        body=[sys_import, *imports] + param_block + body,
        type_ignores=[],
    )
    ast.fix_missing_locations(output_module)
    return header + "\n" + ast.unparse(output_module) + "\n"


def _cli(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.services.test_extractor",
        description="Extract a pytest test method into a standalone .py file.",
    )
    parser.add_argument("source", type=Path, help="path to the pytest test file")
    parser.add_argument(
        "qualified_name",
        help="'Class.method' (or bare 'function' for a module-level test)",
    )
    parser.add_argument(
        "--out", "-o", type=Path, required=True, help="output .py path"
    )
    args = parser.parse_args(argv)

    try:
        source = extract_test(args.source, args.qualified_name)
    except ExtractionError as exc:
        print(f"extraction failed: {exc}", file=sys.stderr)
        return 2

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(source)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(_cli())

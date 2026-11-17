"""A new projection is defined before the code that uses it (#253).

In a model without section headers, the declaration was appended at the end,
after the `comp.add_projection(...)` that uses it, and the model failed with
"name ... is not defined". Found by dragging a connection in such a model.
"""

from app.services.file_writer import _add_projection

FREE_FORM = """import psyneulink as pnl

a = pnl.ProcessingMechanism(name='a')
b = pnl.ProcessingMechanism(name='b')

comp = pnl.Composition(name='comp')
comp.add_node(a)
comp.add_node(b)
"""


def _add(source: str) -> str:
    return _add_projection(source, {
        "action": "add_projection", "var_name": "a_to_b", "sender": "a", "receiver": "b",
        "composition": "comp", "type": "MappingProjection",
    })


def test_without_section_headers_it_runs():
    new = _add(FREE_FORM)
    namespace: dict = {}
    exec(compile(new, "<model>", "exec"), namespace)  # NameError before #253
    comp = namespace["comp"]
    assert any(p.name == "a_to_b" for p in comp.projections)


def test_it_is_defined_after_its_ends_and_before_its_use():
    new = _add(FREE_FORM).splitlines()
    decl = next(i for i, l in enumerate(new) if l.startswith("a_to_b = pnl.MappingProjection("))
    use = next(i for i, l in enumerate(new) if "comp.add_projection(a_to_b)" in l)
    b_def = next(i for i, l in enumerate(new) if l.startswith("b = "))
    assert b_def < decl < use

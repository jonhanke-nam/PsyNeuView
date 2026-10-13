"""Run/learn resolve a composition by its display name, not just its module
variable (#886 follow-up to #859).

EGO stores its composition (name="EGO") in a variable called ``EGO_comp``, so a
bare ``getattr(module, "EGO")`` missed it and the Run panel reported "Composition
'EGO' not found". ``_resolve_composition`` falls back to matching any module-scope
Composition by ``.name``.
"""

import types

from app.services.sandbox_worker import _resolve_composition


def test_resolves_when_variable_name_differs_from_display_name():
    import psyneulink as pnl

    comp = pnl.Composition(name="EGO")
    module = types.SimpleNamespace(EGO_comp=comp, unrelated=123)
    # getattr(module, "EGO") is absent; resolver falls back to the .name match.
    assert _resolve_composition(module, "EGO") is comp


def test_resolves_the_normal_case_by_attribute():
    import psyneulink as pnl

    comp = pnl.Composition(name="Foo")
    module = types.SimpleNamespace(Foo=comp)
    assert _resolve_composition(module, "Foo") is comp


def test_returns_none_when_no_composition_matches():
    import psyneulink as pnl

    module = types.SimpleNamespace(Foo=pnl.Composition(name="Foo"), n=1)
    assert _resolve_composition(module, "Nope") is None


def test_ignores_non_composition_attributes_of_the_same_name():
    # A non-Composition bound to the sought name must not be returned.
    module = types.SimpleNamespace(EGO="not a composition")
    assert _resolve_composition(module, "EGO") is None

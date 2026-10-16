"""show_graph suppression across the Composition hierarchy (#1090).

#608 patched `pnl.Composition.show_graph` and stopped there. A subclass that
defines its own `show_graph` shadows the patched base, so EM models — whose
AutodiffComposition ancestor does exactly that — still rendered a PDF that
macOS opened over the app.

The hierarchy cases are tested on plain classes so they run without importing
PsyNeuLink; one test at the end checks the real classes, since the plain-class
version would happily keep passing if PsyNeuLink restructured.
"""

import pytest

from app.services.show_graph_guard import (
    classes_defining_show_graph,
    suppress_show_graph,
)


class Root:
    def show_graph(self, *a, **kw):
        return "root"


class DefinesItsOwn(Root):
    def show_graph(self, *a, **kw):
        return "own"


class InheritsFromOverride(DefinesItsOwn):
    """The EMComposition shape: inherits an override, defines nothing."""


class InheritsFromRoot(Root):
    pass


class TestClassesDefiningShowGraph:
    def test_finds_the_root_and_every_overriding_subclass(self):
        found = classes_defining_show_graph(Root)
        assert Root in found
        assert DefinesItsOwn in found

    def test_skips_classes_that_only_inherit(self):
        # Patching these would create an attribute that has to be deleted
        # rather than restored.
        found = classes_defining_show_graph(Root)
        assert InheritsFromOverride not in found
        assert InheritsFromRoot not in found

    def test_reaches_more_than_one_level_down(self):
        # __subclasses__ is one level deep; the real hierarchy is three.
        class Deep(InheritsFromOverride):
            def show_graph(self, *a, **kw):
                return "deep"

        assert Deep in classes_defining_show_graph(Root)


class TestSuppressShowGraph:
    def test_silences_a_subclass_that_shadows_the_base(self):
        # The actual #1090 bug: patching only Root leaves this one live.
        restore = suppress_show_graph(Root)
        try:
            assert InheritsFromOverride().show_graph() is None
            assert DefinesItsOwn().show_graph() is None
            assert Root().show_graph() is None
        finally:
            for fn in restore:
                fn()

    def test_patching_only_the_root_is_not_enough(self):
        # Pin the reason this module exists, so nobody simplifies it back.
        original = Root.show_graph
        Root.show_graph = lambda self, *a, **kw: None
        try:
            assert InheritsFromOverride().show_graph() == "own"
        finally:
            Root.show_graph = original

    def test_restores_every_class_afterwards(self):
        for fn in suppress_show_graph(Root):
            fn()
        assert Root().show_graph() == "root"
        assert DefinesItsOwn().show_graph() == "own"
        assert InheritsFromOverride().show_graph() == "own"

    def test_restore_does_not_leave_an_inherited_class_owning_a_method(self):
        for fn in suppress_show_graph(Root):
            fn()
        assert "show_graph" not in InheritsFromOverride.__dict__
        assert "show_graph" not in InheritsFromRoot.__dict__


class TestAgainstRealPsyNeuLink:
    def test_autodiff_and_em_are_actually_silenced(self):
        """The plain-class tests would keep passing if PNL restructured."""
        pnl = pytest.importorskip("psyneulink")
        restore = suppress_show_graph(pnl.Composition)
        try:
            # AutodiffComposition is the class that defines the shadowing
            # override; EMComposition is what a tester's model builds.
            assert pnl.AutodiffComposition.show_graph.__name__ == "noop"
            assert pnl.EMComposition.show_graph.__name__ == "noop"
            assert pnl.Composition.show_graph.__name__ == "noop"
        finally:
            for fn in restore:
                fn()
        # And put the real classes back, or every later test in the session
        # runs against a neutered PsyNeuLink.
        assert pnl.AutodiffComposition.show_graph.__name__ != "noop"


class TestSandboxWorkerFallback:
    """The sandbox worker must never fail open. (#1090)

    It runs as a script in a subprocess, so `app` resolves through whatever
    install is on the path rather than the tree the file came from. An
    ImportError there once meant *no* suppression at all, silently — which is
    the precise failure suppression exists to prevent. It cost three PDFs
    opening over the app while this fix was being verified.
    """

    def test_the_fallback_matches_the_shared_helper(self):
        from app.services.sandbox_worker import _suppress_show_graph_fallback

        restore = _suppress_show_graph_fallback(Root)
        try:
            # Same cases as the shared helper: the shadowing subclass is what
            # matters, not just the root.
            assert InheritsFromOverride().show_graph() is None
            assert DefinesItsOwn().show_graph() is None
            assert Root().show_graph() is None
        finally:
            for fn in restore:
                fn()
        assert Root().show_graph() == "root"
        assert DefinesItsOwn().show_graph() == "own"

    def test_the_fallback_leaves_inheriting_classes_alone(self):
        from app.services.sandbox_worker import _suppress_show_graph_fallback

        for fn in _suppress_show_graph_fallback(Root):
            fn()
        assert "show_graph" not in InheritsFromOverride.__dict__

    def test_graphics_patches_suppress_even_without_the_shared_module(self, monkeypatch):
        """Simulate the subprocess where app.services.show_graph_guard is absent."""
        import builtins

        import app.services.sandbox_worker as worker

        real_import = builtins.__import__

        def blocked(name, *args, **kwargs):
            if name == "app.services.show_graph_guard":
                raise ImportError("simulating the subprocess path")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", blocked)

        pnl = pytest.importorskip("psyneulink")
        restore = worker._apply_graphics_patches()
        try:
            # Suppression must still have happened via the fallback.
            assert pnl.AutodiffComposition.show_graph.__name__ == "noop"
            assert pnl.EMComposition.show_graph.__name__ == "noop"
        finally:
            for fn in restore:
                fn()
        assert pnl.AutodiffComposition.show_graph.__name__ != "noop"

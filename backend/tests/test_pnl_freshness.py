"""Freshness of a branch-pinned PsyNeuLink install (#116).

Everything here is offline. The network call is the one part that cannot be
trusted to be available, so `check` is built to degrade to "unknown" and the
parsing and wording are tested on their own.
"""

import pytest

from app.services.pnl_freshness import check, commit_from_version, describe


class TestCommitFromVersion:
    def test_reads_the_sha_from_a_git_build(self):
        # The real string from a 0.5.5 install.
        assert commit_from_version("0.19.1.0+30.g875890855") == "875890855"

    def test_a_plain_release_has_no_sha(self):
        # A PyPI install has no branch to be behind, so None is the right answer.
        assert commit_from_version("0.20.2.0") is None

    def test_handles_a_full_length_sha(self):
        assert commit_from_version("0.19.1.0+1.g83cc4165b7dd1a2f3e4b5c6d7e8f9a0b1c2d3e4f") \
            == "83cc4165b7dd1a2f3e4b5c6d7e8f9a0b1c2d3e4f"

    def test_missing_version_is_not_an_error(self):
        assert commit_from_version(None) is None
        assert commit_from_version("") is None


class TestDescribe:
    def test_being_behind_names_the_count_and_branch(self):
        assert describe("behind", 30, "devel") == "30 commits behind devel."

    def test_one_commit_is_singular(self):
        assert describe("behind", 1, "devel") == "1 commit behind devel."

    def test_includes_the_head_date_when_known(self):
        assert describe("behind", 4, "devel", "2026-09-15T10:11:12Z") \
            == "4 commits behind devel, newest from 2026-09-15."

    def test_current_says_so(self):
        assert describe("current", 0, "devel") == "Up to date with devel."

    def test_unknown_does_not_imply_current(self):
        # The whole point of the issue is that a stale install looked current.
        # A failed check must not read as reassurance.
        detail = describe("unknown", None, "devel")
        assert "Couldn't check" in detail
        assert "Up to date" not in detail

    def test_a_release_pin_has_no_branch_to_track(self):
        assert "no branch" in describe("not_applicable", None, None)


class TestCheck:
    @pytest.mark.parametrize("repo,branch,version", [
        (None, "devel", "0.19.1.0+30.g875890855"),   # no repo
        ("PrincetonUniversity/PsyNeuLink", None, "0.19.1.0+30.g875890855"),  # no branch
        ("PrincetonUniversity/PsyNeuLink", "devel", "0.20.2.0"),  # PyPI release
    ])
    def test_not_applicable_without_all_three(self, repo, branch, version):
        assert check(repo, branch, version)["status"] == "not_applicable"

    def test_a_local_clone_commit_wins_over_the_version_string(self, monkeypatch):
        # Read from git, rather than inferred from how a version was rendered.
        result = check(None, None, "0.19.1.0+30.g875890855", commit="abc1234")
        assert result["installed_commit"] == "abc1234"

    def test_an_unreachable_github_is_not_fatal(self, monkeypatch):
        import httpx

        def explode(*args, **kwargs):
            raise OSError("no network")

        monkeypatch.setattr(httpx, "get", explode)

        result = check("PrincetonUniversity/PsyNeuLink", "devel", "0.19.1.0+30.g875890855")
        assert result["status"] == "unknown"
        assert result["installed_commit"] == "875890855"
        assert "Couldn't check" in result["detail"]

    def test_a_non_200_is_treated_as_unknown(self, monkeypatch):
        import httpx

        class Resp:
            status_code = 404
            def json(self):  # pragma: no cover - should not be reached
                raise AssertionError("must not parse a non-200 body")

        monkeypatch.setattr(httpx, "get", lambda *a, **k: Resp())
        assert check("x/y", "devel", "0.1.0+1.gabc1234")["status"] == "unknown"

    def test_reports_how_far_behind(self, monkeypatch):
        import httpx

        class Resp:
            status_code = 200
            def json(self):
                return {
                    "ahead_by": 30,
                    "commits": [{
                        "sha": "9ce038ffa1",
                        "commit": {"committer": {"date": "2026-09-15T09:00:00Z"}},
                    }],
                }

        monkeypatch.setattr(httpx, "get", lambda *a, **k: Resp())
        result = check("PrincetonUniversity/PsyNeuLink", "devel", "0.19.1.0+30.g875890855")
        assert result["status"] == "behind"
        assert result["behind_by"] == 30
        assert result["head_commit"] == "9ce038ffa1"
        assert "30 commits behind devel" in result["detail"]

    def test_level_with_the_branch_reads_as_current(self, monkeypatch):
        import httpx

        class Resp:
            status_code = 200
            def json(self):
                return {"ahead_by": 0, "commits": []}

        monkeypatch.setattr(httpx, "get", lambda *a, **k: Resp())
        result = check("PrincetonUniversity/PsyNeuLink", "devel", "0.19.1.0+30.g875890855")
        assert result["status"] == "current"
        assert result["detail"] == "Up to date with devel."

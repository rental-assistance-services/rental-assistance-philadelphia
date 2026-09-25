"""Tests for deploy_gate.py against a stubbed GitHub API. No network, no token.

Run: python3 -m unittest discover -s .github/scripts -p 'test_*.py'
Each case is a scenario a reviewer reproduced or a guard that must not regress.
"""

from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
import urllib.parse
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import deploy_gate as g  # noqa: E402

REPO = "org/site"
APPROVER, WRITER = "asilber15", "kyle192003"
CTX = "site-checks/verified"
LIVE_URL = "https://example.test/build.json"
_names: dict[str, str] = {}


def S(name: str) -> str:
    """A stable, distinct 40-hex commit id per name."""
    if name not in _names:
        _names[name] = f"{len(_names) + 1:040x}"
    return _names[name]


class FakeGitHub:
    def __init__(self) -> None:
        self.parents: dict[str, list[str]] = {}
        self.links: dict[str, list[int]] = {}
        self.prs: dict[int, dict] = {}
        self.statuses: dict[str, list[dict]] = {}
        self.committers: dict[str, dict] = {}   # sha -> {"email", "date"}; default: a person
        self.missing_runs: set[int] = set()     # run ids GitHub answers 404 for
        self.runs: dict[int, dict] = {}
        self.jobs: dict[tuple[int, str | None], dict] = {}
        self.live: dict | None = None
        self.down: set[str] = set()          # path prefixes that never answer
        self.empty_first: set[str] = set()   # commits GitHub links only on the second ask
        self.asked: dict[str, int] = {}

    # -- building the history -------------------------------------------------------------
    def chain(self, *newest_first: str) -> None:
        for a, b in zip(newest_first, newest_first[1:]):
            self.parents[S(a)] = [S(b)]
        self.parents.setdefault(S(newest_first[-1]), [])

    def by_github(self, *names: str, at: str = "2026-09-25T10:00:00Z") -> None:
        """Commits GitHub itself created at one moment, as a rebase merge does."""
        for name in names:
            self.committers[S(name)] = {"email": "noreply@github.com", "date": at}

    def pr(self, number: int, merged_at: str, by: str = APPROVER, commits: int = 1, linked=()) -> None:
        self.prs[number] = {"number": number, "merge_commit_sha": S(merged_at), "merged_by": {"login": by},
                            "commits": commits}
        for name in (*linked, merged_at):
            self.links.setdefault(S(name), []).append(number)

    def marker(self, name: str, run_id: int, creator: str = "github-actions[bot]", step_for: str | None = None,
               conclusion: str = "success", branch: str = "main", path: str = ".github/workflows/site-checks.yml",
               event: str = "push") -> None:
        self.statuses.setdefault(S(name), []).append({
            "context": CTX, "state": "success", "creator": {"login": creator},
            "target_url": f"https://github.com/{REPO}/actions/runs/{run_id}/attempts/1"})
        self.runs[run_id] = {"path": path, "head_branch": branch, "event": event,
                             "repository": {"full_name": REPO}}
        self.jobs[(run_id, "1")] = {"jobs": [{"steps": [
            {"name": f"Mark {S(step_for or name)} verified", "conclusion": conclusion}]}]}

    # -- the API --------------------------------------------------------------------------
    def get(self, url: str, token, attempts: int = 3):
        if url.startswith(LIVE_URL):
            if "live" in self.down or self.live is None:
                raise g.Unknown("the live site did not answer")
            return self.live
        path = url.split(f"/repos/{REPO}/", 1)[1].split("?")[0]
        if any(path.startswith(d) for d in self.down):
            raise g.Unknown(f"no answer from {path}")
        parts = path.split("/")
        if parts[0] == "commits" and len(parts) == 3 and parts[2] == "pulls":
            sha = parts[1]
            self.asked[sha] = self.asked.get(sha, 0) + 1
            if sha in self.empty_first and self.asked[sha] == 1:
                return []
            return [{"number": n, "merged_at": "2026-09-25T00:00:00Z", "base": {"ref": "main"},
                     "merge_commit_sha": self.prs[n]["merge_commit_sha"]} for n in self.links.get(sha, [])]
        if parts[0] == "commits" and len(parts) == 3 and parts[2] == "statuses":
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
            page = int(query.get("page", ["1"])[0])
            return self.statuses.get(parts[1], [])[(page - 1) * 100:page * 100]
        if parts[0] == "commits" and len(parts) == 2:
            who = self.committers.get(parts[1], {"email": "someone@example.com", "date": "2026-09-01T00:00:00Z"})
            return {"sha": parts[1], "parents": [{"sha": p} for p in self.parents.get(parts[1], [])],
                    "commit": {"committer": who}}
        if parts[0] == "pulls":
            return self.prs[int(parts[1])]
        if parts[:2] == ["actions", "runs"] and int(parts[2]) in self.missing_runs:
            raise g.Refused(f"GET {path} answered HTTP 404")
        if parts[:2] == ["actions", "runs"] and len(parts) == 3:
            return self.runs.get(int(parts[2]), {})
        if parts[:2] == ["actions", "runs"] and parts[-1] == "jobs":
            attempt = parts[4] if len(parts) == 6 else None
            return self.jobs.get((int(parts[2]), attempt), {"jobs": []})
        raise AssertionError(f"unexpected API call {path}")


class GateCase(unittest.TestCase):
    def setUp(self) -> None:
        self.gh = FakeGitHub()
        patches = [mock.patch.object(g, "get", self.gh.get), mock.patch.object(g.time, "sleep", lambda s: None),
                   mock.patch.object(g.urllib.request, "urlopen", side_effect=AssertionError("network used"))]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def decide(self, head: str, **env) -> tuple[str, str, list[str]]:
        base_env = {"EVENT": "push", "SHA": S(head), "ACTOR": APPROVER, "APPROVERS": f"ryankyleocampo-github {APPROVER}",
                    "GITHUB_REPOSITORY": REPO, "GITHUB_TOKEN": "t"}
        base_env.update(env)
        with mock.patch.dict(os.environ, base_env, clear=True):
            return g.decide()


class TheRangeWalk(GateCase):
    def test_one_approved_merge_on_top_of_the_live_commit(self):
        self.gh.chain("m1", "live")
        self.gh.pr(1, "m1")
        v, why, _ = self.decide("m1", BASE_COMMIT=S("live"))
        self.assertEqual(v, "true", why)

    def test_direct_push_cannot_ride_along_under_a_later_approved_merge(self):
        self.gh.chain("m2", "x", "live")
        self.gh.pr(2, "m2")
        v, why, bad = self.decide("m2", BASE_COMMIT=S("live"))
        self.assertEqual(v, "false", why)
        self.assertEqual(bad[0].split(" ")[0], S("x")[:7])

    def test_merge_by_a_writer_who_is_not_an_approver(self):
        self.gh.chain("m3", "live")
        self.gh.pr(3, "m3", by=WRITER)
        self.assertEqual(self.decide("m3", BASE_COMMIT=S("live"))[0], "false")

    def test_the_head_already_live_is_nothing_new(self):
        self.gh.chain("live")
        self.assertEqual(self.decide("live", BASE_COMMIT=S("live"))[0], "true")

    def test_known_good_commit_not_in_the_history_is_unknown_not_true(self):
        self.gh.chain("m4", "old-root")
        self.gh.pr(4, "m4")
        v, why, _ = self.decide("m4", BASE_COMMIT=S("elsewhere"))
        self.assertEqual(v, "unknown", why)

    def test_no_known_good_commit_configured_is_unknown_not_a_head_only_check(self):
        self.gh.chain("m5", "x")
        self.gh.pr(5, "m5")
        self.assertEqual(self.decide("m5")[0], "unknown")

    def test_github_not_answering_is_unknown(self):
        self.gh.chain("m6", "live")
        self.gh.pr(6, "m6")
        self.gh.down.add("commits/")
        self.assertEqual(self.decide("m6", BASE_COMMIT=S("live"))[0], "unknown")

    def test_a_merge_github_links_a_moment_late_still_counts(self):
        self.gh.chain("m7", "live")
        self.gh.pr(7, "m7")
        self.gh.empty_first.add(S("m7"))
        self.assertEqual(self.decide("m7", BASE_COMMIT=S("live"))[0], "true")

    def test_approvers_split_on_commas_as_well_as_spaces(self):
        self.gh.chain("m8", "live")
        self.gh.pr(8, "m8")
        v, why, _ = self.decide("m8", BASE_COMMIT=S("live"), APPROVERS=f"someone,{APPROVER}")
        self.assertEqual(v, "true", why)


class TheLiveBuildJson(GateCase):
    def test_unreadable_live_build_json_is_unknown_never_head_only(self):
        # pass 2: an unreadable base made the gate check the head alone, letting a direct
        # push under an approved merge through exactly when the site was flaky
        self.gh.chain("m9", "x", "live")
        self.gh.pr(9, "m9")
        self.gh.down.add("live")
        self.assertEqual(self.decide("m9", LIVE_BUILD_JSON=LIVE_URL)[0], "unknown")

    def test_live_build_json_without_a_commit_is_unknown(self):
        self.gh.chain("m10", "live")
        self.gh.pr(10, "m10")
        self.gh.live = {"built_at": "now"}
        self.assertEqual(self.decide("m10", LIVE_BUILD_JSON=LIVE_URL)[0], "unknown")

    def test_live_build_json_names_the_base(self):
        self.gh.chain("m11", "x", "live")
        self.gh.pr(11, "m11")
        self.gh.live = {"commit": S("live")}
        self.assertEqual(self.decide("m11", LIVE_BUILD_JSON=LIVE_URL)[0], "false")

    def test_live_build_file_on_disk(self):
        self.gh.chain("m12", "live")
        self.gh.pr(12, "m12")
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"commit": S("live")}, f)
        self.addCleanup(os.unlink, f.name)
        self.assertEqual(self.decide("m12", LIVE_BUILD_FILE=f.name)[0], "true")

    def test_missing_live_build_file_is_unknown(self):
        self.gh.chain("m13", "live")
        self.gh.pr(13, "m13")
        self.assertEqual(self.decide("m13", LIVE_BUILD_FILE="/nonexistent/build.json")[0], "unknown")


class RebaseMerges(GateCase):
    def test_an_approvers_rebase_merge_of_three_commits_is_approved(self):
        self.gh.chain("r3", "r2", "r1", "live")
        self.gh.pr(20, "r3", commits=3, linked=("r1", "r2"))
        self.gh.by_github("r1", "r2", "r3")
        v, why, _ = self.decide("r3", BASE_COMMIT=S("live"))
        self.assertEqual(v, "true", why)

    def test_a_direct_push_just_below_a_rebase_merge_is_still_caught(self):
        self.gh.chain("r3b", "r2b", "r1b", "x", "live")
        self.gh.pr(21, "r3b", commits=3, linked=("r1b", "r2b"))
        self.gh.by_github("r1b", "r2b", "r3b")
        v, _, bad = self.decide("r3b", BASE_COMMIT=S("live"))
        self.assertEqual(v, "false")
        self.assertEqual([b.split(" ")[0] for b in bad], [S("x")[:7]])

    def test_the_run_never_extends_past_the_pull_requests_commit_count(self):
        self.gh.chain("r3c", "r2c", "r1c", "live")
        self.gh.pr(22, "r3c", commits=2, linked=("r1c", "r2c"))
        self.gh.by_github("r1c", "r2c", "r3c")
        self.assertEqual(self.decide("r3c", BASE_COMMIT=S("live"))[0], "false")

    def test_a_commit_github_does_not_link_breaks_the_run_and_fails_closed(self):
        self.gh.chain("r3d", "r2d", "r1d", "live")
        self.gh.pr(23, "r3d", commits=3, linked=("r1d",))
        self.gh.by_github("r1d", "r2d", "r3d")
        self.assertEqual(self.decide("r3d", BASE_COMMIT=S("live"))[0], "false")

    def test_a_rebase_merge_by_a_non_approver_flags_every_commit(self):
        self.gh.chain("r2e", "r1e", "live")
        self.gh.pr(24, "r2e", by=WRITER, commits=2, linked=("r1e",))
        self.gh.by_github("r1e", "r2e")
        v, _, bad = self.decide("r2e", BASE_COMMIT=S("live"))
        self.assertEqual((v, len(bad)), ("false", 2))


    def test_a_commit_pushed_earlier_under_a_squash_merge_is_not_carried_along(self):
        # pass 3: part of a PR pushed straight to main, then the rest squash-merged. GitHub
        # may link that commit to the PR, but GitHub did not commit it at merge time.
        self.gh.chain("sq", "early", "live")
        self.gh.pr(25, "sq", commits=3, linked=("early",))
        self.gh.by_github("sq")
        v, _, bad = self.decide("sq", BASE_COMMIT=S("live"))
        self.assertEqual((v, [b.split(" ")[0] for b in bad]), ("false", [S("early")[:7]]))

    def test_rebased_commits_committed_long_before_the_merge_are_not_carried_along(self):
        self.gh.chain("r2f", "r1f", "live")
        self.gh.pr(26, "r2f", commits=2, linked=("r1f",))
        self.gh.by_github("r2f", at="2026-09-25T10:00:00Z")
        self.gh.by_github("r1f", at="2026-09-20T10:00:00Z")
        self.assertEqual(self.decide("r2f", BASE_COMMIT=S("live"))[0], "false")


class VerifiedMarkers(GateCase):
    def test_a_genuine_marker_ends_the_walk(self):
        self.gh.chain("m30", "w", "x-old")
        self.gh.pr(30, "m30")
        self.gh.marker("w", 77)
        v, why, _ = self.decide("m30", VERIFIED_CONTEXT=CTX)
        self.assertEqual(v, "true", why)

    def test_a_marker_posted_by_a_person_is_ignored(self):
        # pass 2 S4: any writer could post the status by hand and end every later walk early
        self.gh.chain("m31", "x", "w", "root")
        self.gh.pr(31, "m31")
        self.gh.marker("w", 78)
        self.gh.marker("x", 79, creator=WRITER)
        v, _, bad = self.decide("m31", VERIFIED_CONTEXT=CTX)
        self.assertEqual(v, "false")
        self.assertEqual([b.split(" ")[0] for b in bad], [S("x")[:7]])

    def test_a_marker_from_a_branch_run_is_ignored(self):
        self.gh.chain("m32", "x", "w", "root")
        self.gh.pr(32, "m32")
        self.gh.marker("w", 80)
        self.gh.marker("x", 81, branch="feature")
        self.assertEqual(self.decide("m32", VERIFIED_CONTEXT=CTX)[0], "false")

    def test_a_marker_pointing_at_another_commits_run_is_ignored(self):
        self.gh.chain("m33", "x", "w", "root")
        self.gh.pr(33, "m33")
        self.gh.marker("w", 82)
        self.gh.marker("x", 83, step_for="w")
        self.assertEqual(self.decide("m33", VERIFIED_CONTEXT=CTX)[0], "false")

    def test_a_marker_whose_mark_step_did_not_succeed_is_ignored(self):
        self.gh.chain("m34", "x", "w", "root")
        self.gh.pr(34, "m34")
        self.gh.marker("w", 84)
        self.gh.marker("x", 85, conclusion="skipped")
        self.assertEqual(self.decide("m34", VERIFIED_CONTEXT=CTX)[0], "false")

    def test_a_status_linking_to_a_run_that_does_not_exist_cannot_switch_off_the_gate(self):
        # pass 3 #1: one bogus status (a made-up or deleted run) made the whole verdict
        # "unknown", which only alerts: automatic rollback was switched off by one API call
        self.gh.chain("m36", "x", "w", "root")
        self.gh.pr(36, "m36")
        self.gh.marker("w", 88)
        self.gh.marker("w", 999999)
        self.gh.missing_runs.add(999999)
        self.gh.statuses[S("w")].reverse()  # the bogus one is read first
        v, _, bad = self.decide("m36", VERIFIED_CONTEXT=CTX)
        self.assertEqual((v, [b.split(" ")[0] for b in bad]), ("false", [S("x")[:7]]))

    def test_a_genuine_marker_under_a_pile_of_junk_statuses_is_still_found(self):
        self.gh.chain("m37", "w", "root")
        self.gh.pr(37, "m37")
        junk = [{"context": "spam", "state": "success", "creator": {"login": WRITER}, "target_url": ""}] * 250
        self.gh.statuses[S("w")] = list(junk)
        self.gh.marker("w", 89)
        self.assertEqual(self.decide("m37", VERIFIED_CONTEXT=CTX)[0], "true")

    def test_a_marker_from_another_workflow_is_ignored(self):
        self.gh.chain("m35", "x", "w", "root")
        self.gh.pr(35, "m35")
        self.gh.marker("w", 86)
        self.gh.marker("x", 87, path=".github/workflows/anything.yml")
        self.assertEqual(self.decide("m35", VERIFIED_CONTEXT=CTX)[0], "false")


class Helpers(GateCase):
    def run_main(self, *argv: str, **env) -> tuple[int, str, str]:
        base_env = {"GITHUB_REPOSITORY": REPO, "GITHUB_TOKEN": "t", "APPROVERS": APPROVER, "VERIFIED_CONTEXT": CTX}
        base_env.update(env)
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, base_env, clear=True), mock.patch.object(sys, "argv", ["deploy_gate.py", *argv]), \
                redirect_stdout(out), redirect_stderr(err):
            rc = g.main()
        return rc, out.getvalue().strip(), err.getvalue()

    def test_rollback_target_is_the_last_verified_commit_not_the_last_approved(self):
        # pass 2 S1: W verified, X a direct push, Y an approved merge on top; rolling back Z
        # must land on W, because Y carries X
        self.gh.chain("z", "y", "x", "w", "root")
        self.gh.pr(40, "z")
        self.gh.pr(41, "y")
        self.gh.marker("w", 90)
        rc, out, _ = self.run_main("--last-verified-before", S("z"))
        self.assertEqual((rc, out), (0, S("w")))

    def test_rollback_target_can_be_the_configured_starting_commit(self):
        self.gh.chain("z2", "y2", "since")
        rc, out, _ = self.run_main("--last-verified-before", S("z2"), BASE_COMMIT=S("since"), VERIFIED_CONTEXT="")
        self.assertEqual((rc, out), (0, S("since")))

    def test_no_rollback_target_prints_nothing_on_stdout(self):
        self.gh.chain("z3", "y3", "root3")
        rc, out, err = self.run_main("--last-verified-before", S("z3"))
        self.assertEqual((rc, out), (2, ""))
        self.assertIn("no known-good commit", err)

    def test_is_approver_accepts_commas(self):
        self.assertEqual(self.run_main("--is-approver", "Asilber15", APPROVERS=f"x,{APPROVER}")[0], 0)
        self.assertEqual(self.run_main("--is-approver", WRITER, APPROVERS=f"x,{APPROVER}")[0], 1)

    def test_is_verified_trusts_only_a_genuine_marker(self):
        self.gh.chain("v1", "v0")
        self.gh.marker("v1", 91)
        self.gh.marker("v0", 92, creator=WRITER)
        self.assertEqual(self.run_main("--is-verified", S("v1"))[0], 0)
        self.assertEqual(self.run_main("--is-verified", S("v0"))[0], 1)
        self.gh.down.add("commits/")
        self.assertEqual(self.run_main("--is-verified", S("v1"))[0], 2)

    def test_manual_runs_are_judged_by_who_started_them(self):
        self.assertEqual(self.decide("any", EVENT="workflow_dispatch", ACTOR=APPROVER)[0], "true")
        self.assertEqual(self.decide("any", EVENT="workflow_dispatch", ACTOR=WRITER)[0], "false")


class TheHttpLayer(unittest.TestCase):
    def test_a_dropped_connection_is_retried_then_unknown_never_a_crash(self):
        import http.client
        errors = [ConnectionResetError("reset"), http.client.RemoteDisconnected("gone"), TimeoutError("slow")]
        with mock.patch.object(g.urllib.request, "urlopen", side_effect=errors), \
                mock.patch.object(g.time, "sleep", lambda s: None):
            with self.assertRaises(g.Unknown):
                g.get("https://api.github.com/repos/org/site/commits/abc", "t")


if __name__ == "__main__":
    unittest.main()

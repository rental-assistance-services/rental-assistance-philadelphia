"""Tests for pages_switch.py against a simulated Cloudflare Pages API. No network, no token.

Run: python3 -m unittest discover -s deploy -p 'test_*.py'
Each case is a scenario a reviewer reproduced or a guard that must not regress.
"""

from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pages_switch as ps  # noqa: E402

PROJECT = "site"


def C(n: int) -> str:
    return f"{n:040x}"


def dep(i: str, commit: str, ok: bool = True) -> dict:
    return {"id": i, "environment": "production", "url": f"https://{i[:8]}.{PROJECT}.pages.dev",
            "latest_stage": {"status": "success" if ok else "failure"},
            "deployment_trigger": {"metadata": {"commit_hash": commit}}}


NEW, PREV, OLD = "aaaaaaaa-0000-0000-0000-000000000003", "bbbbbbbb-0000-0000-0000-000000000002", \
    "cccccccc-0000-0000-0000-000000000001"


class FakePages:
    """Production deployments newest first; POST .../rollback re-points `live`."""

    def __init__(self) -> None:
        self.deps = [dep(NEW, C(3)), dep(PREV, C(2)), dep(OLD, C(1))]
        self.unlisted: list[dict] = []   # deployments Cloudflare holds beyond the listing
        self.live = NEW
        self.posts: list[str] = []
        self.fail_project_reads: set[int] = set()   # which project reads (1-based) fail
        self.project_reads = 0
        self.listing_ok = True
        self.post_applies = True
        self.on_read = None   # hook(read_number) to change the world mid-run

    def by_id(self, i: str) -> dict:
        return next(d for d in self.deps + self.unlisted if d["id"] == i)

    def api(self, method: str, path: str) -> dict:
        if method == "POST":
            tid = path.split("/deployments/")[1].split("/")[0]
            self.posts.append(tid)
            if self.post_applies:
                self.live = tid
            return {"success": True}
        if path == PROJECT:
            self.project_reads += 1
            if self.on_read:
                self.on_read(self.project_reads)
            if self.project_reads in self.fail_project_reads:
                return {"success": False, "errors": [{"message": "no answer from the API (HTTP 502)"}]}
            return {"success": True, "result": {"canonical_deployment": self.by_id(self.live)}}
        if path.startswith(f"{PROJECT}/deployments/") and "?" not in path and "/rollback" not in path:
            return {"success": True, "result": self.by_id(path.rsplit("/", 1)[1])}
        if path.startswith(f"{PROJECT}/deployments?"):
            if not self.listing_ok:
                return {"success": False, "errors": [{"message": "HTTP 500"}]}
            return {"success": True, "result": self.deps}
        raise AssertionError(f"unexpected API call {method} {path}")


class Checks:
    """run_check replacement: the own-address answers and the public answers, in order."""

    def __init__(self, own=(0,), public=(0,)) -> None:
        self.own, self.public, self.calls = list(own), list(public), []

    def __call__(self, check: str, url: str, commit: str) -> int:
        self.calls.append((url, commit))
        seq = self.own if ".pages.dev" in url else self.public
        return seq.pop(0) if len(seq) > 1 else seq[0]


class SwitchCase(unittest.TestCase):
    def setUp(self) -> None:
        self.cf = FakePages()
        self.checks = Checks()
        for p in (mock.patch.object(ps, "api", lambda m, p: self.cf.api(m, p)),
                  mock.patch.object(ps, "run_check", lambda c, u, k: self.checks(c, u, k)),
                  mock.patch.object(ps.time, "sleep", lambda s: None),
                  mock.patch.dict(os.environ, {"CLOUDFLARE_API_TOKEN": "t", "CLOUDFLARE_ACCOUNT_ID": "a"})):
            p.start()
            self.addCleanup(p.stop)

    def run_tool(self, *args: str) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(sys, "argv", ["pages_switch.py", "--project", PROJECT, "--wait", "0", *args]), \
                redirect_stdout(out), redirect_stderr(err):
            rc = ps.main()
        return rc, out.getvalue(), err.getvalue()


class Selection(SwitchCase):
    def test_previous_switches_and_verifies(self):
        rc, _, _ = self.run_tool("--previous", "--public-url", "https://www.example.test/")
        self.assertEqual((rc, self.cf.live, self.cf.posts), (0, PREV, [PREV]))

    def test_a_target_that_is_already_live_is_its_own_exit_code_not_success(self):
        # pass 2 N1: after an upload failure the old deployment is still live; exit 0 read
        # as "rolled back and verified" in Slack
        rc, _, _ = self.run_tool("--to", NEW)
        self.assertEqual((rc, self.cf.posts), (8, []))

    def test_a_failed_listing_is_an_error_not_superseded(self):
        # pass 2 S7: a failed listing ended green as "a newer deployment took over"
        self.cf.listing_ok = False
        rc, _, _ = self.run_tool("--to-commit", C(2), "--only-if-live-commit", C(3))
        self.assertEqual((rc, self.cf.posts), (1, []))

    def test_an_error_text_is_never_taken_as_a_deployment_id(self):
        # pass 2 N3: "::error::cannot" became the rollback target id
        rc, _, _ = self.run_tool("--to", "::error::cannot")
        self.assertEqual((rc, self.cf.posts), (1, []))

    def test_live_missing_from_the_listing_is_refused_for_previous(self):
        # the live deployment is older than the 25 listed: "the one before it" is unknown
        self.cf.unlisted = [self.cf.deps.pop(0)]
        rc, _, _ = self.run_tool("--previous")
        self.assertEqual((rc, self.cf.posts), (1, []))

    def test_print_live_puts_only_the_answer_on_stdout(self):
        rc, out, _ = self.run_tool("--print-live")
        self.assertEqual((rc, out.strip()), (0, f"{NEW} {C(3)}"))

    def test_print_live_failing_prints_nothing_on_stdout(self):
        self.cf.fail_project_reads = {1}
        rc, out, err = self.run_tool("--print-live")
        self.assertEqual((rc, out), (1, ""))
        self.assertIn("::error::", err)


class TheOrderOfQuestions(SwitchCase):
    def test_a_publish_that_never_went_live_says_the_previous_one_is_still_live(self):
        # pass 3 N-a: upload reported success but production never moved; "superseded"
        # (something newer went live) was the wrong answer, "already live" (8) is right
        self.cf.live = PREV
        rc, _, _ = self.run_tool("--to", PREV, "--only-if-live-commit", C(3), "--no-put-back")
        self.assertEqual((rc, self.cf.posts), (8, []))

    def test_an_unreadable_live_commit_is_an_error_not_superseded(self):
        self.cf.deps[0]["deployment_trigger"]["metadata"]["commit_hash"] = ""
        rc, _, _ = self.run_tool("--to", PREV, "--only-if-live-commit", C(3), "--no-put-back")
        self.assertEqual((rc, self.cf.posts), (1, []))


class OwnAddressCheck(SwitchCase):
    def test_a_gated_or_stale_target_is_refused_before_anything_changes(self):
        self.checks.own = [1]
        rc, _, err = self.run_tool("--previous")
        self.assertEqual((rc, self.cf.posts), (3, []))
        self.assertIn("fails its own check", err)

    def test_an_unreachable_target_is_retried_then_reported_as_unchecked(self):
        # pass 2 N3: unreachable was reported as "gated, stale or leaking"
        self.checks.own = [2]
        rc, _, err = self.run_tool("--previous")
        self.assertEqual((rc, self.cf.posts), (3, []))
        self.assertIn("could not be checked", err)
        self.assertEqual(len(self.checks.calls), 3)

    def test_unreachable_once_then_fine_goes_ahead(self):
        self.checks.own = [2, 0]
        rc, _, _ = self.run_tool("--previous")
        self.assertEqual((rc, self.cf.posts), (0, [PREV]))


class Races(SwitchCase):
    def test_a_newer_deployment_during_the_check_stops_the_switch(self):
        # pass 2 S6: live was read, then the check ran, then the switch reverted a newer deploy
        newer = "dddddddd-0000-0000-0000-000000000004"
        self.cf.deps.insert(0, dep(newer, C(4)))

        def newer_goes_live(n: int) -> None:
            if n == 2:
                self.cf.live = newer
        self.cf.on_read = newer_goes_live
        rc, _, _ = self.run_tool("--to-commit", C(2), "--only-if-live-commit", C(3), "--no-put-back")
        self.assertEqual((rc, self.cf.posts, self.cf.live), (7, [], newer))


class AfterTheSwitch(SwitchCase):
    def test_a_confirm_read_that_fails_lets_the_public_check_decide(self):
        # pass 2 N1: a 502 on the re-read was reported as "nothing changed"
        self.cf.fail_project_reads = {2}
        rc, _, _ = self.run_tool("--previous", "--public-url", "https://www.example.test/")
        self.assertEqual((rc, self.cf.live), (0, PREV))

    def test_unconfirmed_and_unreachable_is_production_may_be_wrong(self):
        self.cf.fail_project_reads = {2}
        self.checks.public = [2]
        rc, _, _ = self.run_tool("--previous", "--public-url", "https://www.example.test/", "--attempts", "2")
        self.assertEqual(rc, 6)

    def test_a_switch_cloudflare_did_not_apply_is_reported_as_not_switched(self):
        self.cf.post_applies = False
        rc, _, _ = self.run_tool("--previous", "--public-url", "https://www.example.test/")
        self.assertEqual((rc, self.cf.live), (1, NEW))

    def test_an_automatic_rollback_never_puts_the_rejected_deployment_back(self):
        # pass 2 N2/S8: the put-back restored the deployment that had just failed its check
        self.checks.public = [1]
        rc, _, _ = self.run_tool("--previous", "--public-url", "https://www.example.test/",
                                 "--attempts", "2", "--no-put-back")
        self.assertEqual((rc, self.cf.posts, self.cf.live), (4, [PREV], PREV))

    def test_a_manual_rollback_that_is_wrong_in_public_is_put_back(self):
        self.checks.public = [1, 1, 0]
        rc, _, _ = self.run_tool("--previous", "--public-url", "https://www.example.test/", "--attempts", "2")
        self.assertEqual((rc, self.cf.posts, self.cf.live), (5, [PREV, NEW], NEW))

    def test_unreachable_in_public_is_never_put_back(self):
        self.checks.public = [2]
        rc, _, _ = self.run_tool("--previous", "--public-url", "https://www.example.test/", "--attempts", "2")
        self.assertEqual((rc, self.cf.posts), (4, [PREV]))


class Restore(SwitchCase):
    def state(self, **st) -> str:
        f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(st, f)
        f.close()
        self.addCleanup(os.unlink, f.name)
        return f.name

    def test_restore_after_a_cancel_mid_switch(self):
        self.cf.live = PREV
        path = self.state(phase="switched", original=NEW, original_commit=C(3), target=PREV)
        rc, _, _ = self.run_tool("--restore", path, "--public-url", "https://www.example.test/")
        self.assertEqual((rc, self.cf.live), (5, NEW))

    def test_nothing_restorable_is_recorded_for_an_automatic_rollback(self):
        path = self.state(phase="no-restore", target=PREV)
        rc, _, _ = self.run_tool("--restore", path)
        self.assertEqual((rc, self.cf.posts), (0, []))

    def test_a_put_back_without_a_commit_is_not_called_verified(self):
        # pass 2 nit: "put back ... and verified" when nothing could be verified
        self.cf.live = PREV
        self.cf.deps[0]["deployment_trigger"]["metadata"]["commit_hash"] = ""
        path = self.state(phase="switched", original=NEW, original_commit="", target=PREV)
        rc, _, err = self.run_tool("--restore", path, "--public-url", "https://www.example.test/")
        self.assertEqual(rc, 6)
        self.assertNotIn("and verified", err)


class TheCheckItself(unittest.TestCase):
    def test_the_repositorys_check_never_sees_the_cloudflare_token(self):
        # pass 2 N5: check-live.sh comes from the pushed commit
        seen = {}

        def fake_run(cmd, env=None, stdout=None):
            seen.update(env or {})
            return mock.Mock(returncode=0)
        with mock.patch.dict(os.environ, {"CLOUDFLARE_API_TOKEN": "secret", "CLOUDFLARE_ACCOUNT_ID": "a",
                                          "GITHUB_TOKEN": "g", "GH_TOKEN": "g", "SLACK_WEBHOOK_URL": "s",
                                          "ACTIONS_RUNTIME_TOKEN": "r", "PATH": os.environ.get("PATH", "")}), \
                mock.patch.object(ps.subprocess, "run", fake_run), redirect_stderr(io.StringIO()):
            self.assertEqual(ps.run_check("bash deploy/check-live.sh", "https://x.test/", C(1)), 0)
        self.assertFalse([k for k in seen if k.startswith(("CLOUDFLARE_", "ACTIONS_"))
                          or k in ("GITHUB_TOKEN", "GH_TOKEN", "SLACK_WEBHOOK_URL")])
        self.assertIn("PATH", seen)

    def test_public_verdict_prefers_evidence_over_the_last_attempt(self):
        # pass 2 nit: seven "wrong" then one "unreachable" meant "unreachable"
        for answers, want in (([1, 1, 2], 1), ([2, 2, 2], 2), ([2, 0], 0)):
            seq = list(answers)
            with mock.patch.object(ps, "run_check", lambda c, u, k: seq.pop(0)), \
                    mock.patch.object(ps.time, "sleep", lambda s: None), redirect_stderr(io.StringIO()):
                self.assertEqual(ps.verify_public("x", "https://x.test/", C(1), len(answers), 0), want, answers)


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""deploy_gate.py: was this change approved to be on the public site?

The one human approval before production. GitHub's free plan cannot protect
`main` on a private repository (branch protection and rulesets answer
"Upgrade to GitHub Pro"), so anyone with write access can push to it. An
approved change is a pull request into main merged by an approver.

This stops mistakes and shortcuts, not a determined writer: anyone with write
access can also change the workflow that runs this file.

What it checks, by event:
  push / schedule    every first-parent commit from the known-good commit
                     (exclusive) up to SHA must belong to a pull request into main
                     merged by an approver. The known-good commit is:
                       BASE_COMMIT (a full commit id), or else the commit named by
                       the live site's build.json, read from LIVE_BUILD_FILE (a path)
                       or LIVE_BUILD_JSON (a URL). If one of those is set but cannot
                       be read, the verdict is "unknown": never a silent check of the
                       newest commit alone.
                     With VERIFIED_CONTEXT, the walk also stops at the newest
                     ancestor carrying a genuine "verified" marker (see
                     Repo.verified). So an unapproved direct push cannot ride along
                     under a later approved merge. With no known-good commit
                     configured at all, or none on main's first-parent history
                     within MAX_WALK commits, the verdict is "unknown".
  workflow_dispatch  the person who started the run must be an approver.
  anything else      never approved.

Merge methods: a merge commit or a squash is one commit on main's first-parent
history. A rebase merge puts all N of the pull request's commits there. They are
accepted as part of that pull request when they sit directly below its merge
commit (at most N-1 of them) and GitHub links each one to that same pull request
(GitHub links a commit to the pull request that brought it into main). If GitHub
does not link one, it is judged on its own, so the verdict fails closed.

It never guesses. If GitHub's API cannot answer, the verdict is "unknown"
(callers must not publish on it, and must not roll back on it either).

Writes approved=true|false|unknown, reason=..., and unapproved=<commits> to
$GITHUB_OUTPUT, and a line to the run summary. Exit 0 whenever it ran.

Helper modes (messages on stderr, the answer alone on stdout):
  --last-verified-before SHA
      the newest first-parent ancestor of SHA (excluding SHA) that is known good:
      BASE_COMMIT, or a commit with a genuine VERIFIED_CONTEXT marker. A rollback
      target must be this, not merely "approved": an approved merge can sit on top
      of an unapproved push. Exit 2 if none within MAX_WALK commits, 1 if GitHub
      could not answer.
  --is-approver LOGIN
      exit 0 if LOGIN is in APPROVERS (spaces or commas), else 1.
  --is-verified SHA
      exit 0 if SHA carries a genuine VERIFIED_CONTEXT marker, 1 if it does not,
      2 if GitHub could not answer.

Environment: GITHUB_TOKEN (contents:read, pull-requests:read; with
VERIFIED_CONTEXT also statuses:read and actions:read), GITHUB_REPOSITORY,
GITHUB_API_URL, GITHUB_SERVER_URL, EVENT, SHA, ACTOR, APPROVERS, and optionally
BASE_COMMIT, LIVE_BUILD_FILE, LIVE_BUILD_JSON, VERIFIED_CONTEXT,
VERIFIED_WORKFLOW (default .github/workflows/site-checks.yml).
Standard library only.
"""

from __future__ import annotations

import http.client
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

API = os.environ.get("GITHUB_API_URL", "https://api.github.com").rstrip("/")
SERVER = os.environ.get("GITHUB_SERVER_URL", "https://github.com").rstrip("/")
VERIFIED_WORKFLOW = os.environ.get("VERIFIED_WORKFLOW", ".github/workflows/site-checks.yml")
MAX_WALK = 30
RETRY_SLEEP = 5  # seconds between asks when GitHub has not linked a new merge yet
HEX40 = re.compile(r"[0-9a-f]{40}")


class Unknown(Exception):
    """GitHub (or the live site) could not give an answer; the verdict must be 'unknown'."""


def eprint(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def get(url: str, token: str | None, attempts: int = 3) -> object:
    last: Exception | None = None
    for i in range(attempts):
        req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json",
                                                   "User-Agent": "deploy-gate"})
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code < 500 and e.code != 429:
                raise Unknown(f"GET {url.split('/repos/')[-1]} answered HTTP {e.code}") from e
            last = e
        except (OSError, http.client.HTTPException, ValueError) as e:
            # URLError, timeouts, resets, a dropped connection, a body that is not JSON
            last = e
        if i < attempts - 1:
            time.sleep(2 * (i + 1))
    raise Unknown(f"no answer from {url.split('?')[0]} ({last.__class__.__name__ if last else 'error'})")


def parse_approvers(raw: str) -> set[str]:
    return {a.strip().lower() for a in raw.replace(",", " ").split() if a.strip()}


RUN_URL = re.compile(r"^(?P<server>https://[^/]+)/(?P<repo>[^/]+/[^/]+)/actions/runs/(?P<run>\d+)"
                     r"(?:/attempts/(?P<attempt>\d+))?/?$")


class Repo:
    def __init__(self, name: str, token: str, approvers: set[str]):
        self.name, self.token, self.approvers = name, token, approvers
        self._merged: dict[str, list[dict]] = {}
        self._pr: dict[int, dict] = {}

    def merged_prs(self, sha: str) -> list[dict]:
        """Pull requests into main, merged, that GitHub links to this commit. GitHub links
        a new commit a moment after the merge, so an empty answer is asked again."""
        if sha not in self._merged:
            merges: list[dict] = []
            for attempt in range(3):
                pulls = get(f"{API}/repos/{self.name}/commits/{sha}/pulls", self.token)
                merges = [p for p in pulls if isinstance(p, dict) and p.get("merged_at")
                          and (p.get("base") or {}).get("ref") == "main"] if isinstance(pulls, list) else []
                if merges:
                    break
                if attempt < 2:
                    time.sleep(RETRY_SLEEP)
            self._merged[sha] = merges
        return self._merged[sha]

    def pull(self, number: int) -> dict:
        if number not in self._pr:
            full = get(f"{API}/repos/{self.name}/pulls/{number}", self.token)
            self._pr[number] = full if isinstance(full, dict) else {}
        return self._pr[number]

    def judge(self, sha: str, run: tuple[int, int] | None) -> tuple[bool, str, tuple[int, int] | None]:
        """Is `sha` part of a pull request into main merged by an approver?
        `run` carries a rebase merge down the walk: (its PR number, how many more commits
        directly below may still belong to it). Returns (ok, why, run for the next commit)."""
        merges = self.merged_prs(sha)
        exact = [p for p in merges if p.get("merge_commit_sha") == sha]
        if exact:
            num = exact[0].get("number")
            full = self.pull(num)
            who = (full.get("merged_by") or {}).get("login") or ""
            if who.lower() in self.approvers:
                n = full.get("commits") if isinstance(full.get("commits"), int) else 1
                return True, f"PR #{num} merged by {who}", ((num, n - 1) if n > 1 else None)
            return False, f"PR #{num} was merged by {who or 'an unknown account'}, who is not an approver", None
        if run and run[1] > 0 and any(p.get("number") == run[0] for p in merges):
            left = run[1] - 1
            return True, f"part of PR #{run[0]} (rebase merge)", ((run[0], left) if left > 0 else None)
        if merges:
            nums = ", ".join(f"#{p.get('number')}" for p in merges)
            return False, (f"linked to {nums} but not where it was merged (a commit from a branch "
                           f"that reached main without its pull request's merge)"), None
        return False, "not part of any pull request into main (a direct push)", None

    def first_parent(self, sha: str) -> str:
        c = get(f"{API}/repos/{self.name}/commits/{sha}", self.token)
        parents = (c.get("parents") or []) if isinstance(c, dict) else []
        return parents[0]["sha"] if parents else ""

    def verified(self, context: str, sha: str) -> bool:
        """Does this commit carry a GENUINE marker that a real check passed on it? A writer
        can post any commit status by hand, so a marker counts only when all of these hold:
          - context `context`, state success, created by github-actions[bot]
            (a workflow's own token, not a person);
          - its target_url is a run of VERIFIED_WORKFLOW in this repository, on main,
            started by a push or by hand;
          - in that run, a step named exactly "Mark <this commit> verified" succeeded.
        Faking all three means committing a workflow change to main, the stated limit."""
        statuses = get(f"{API}/repos/{self.name}/commits/{sha}/statuses?per_page=100", self.token)
        for s in statuses if isinstance(statuses, list) else []:
            if not isinstance(s, dict) or s.get("context") != context or s.get("state") != "success":
                continue
            if ((s.get("creator") or {}).get("login") or "") != "github-actions[bot]":
                continue
            m = RUN_URL.match(s.get("target_url") or "")
            if not m or m.group("server") != SERVER or m.group("repo").lower() != self.name.lower():
                continue
            if self._marked_by_run(int(m.group("run")), m.group("attempt"), sha):
                return True
        return False

    def _marked_by_run(self, run_id: int, attempt: str | None, sha: str) -> bool:
        run = get(f"{API}/repos/{self.name}/actions/runs/{run_id}", self.token)
        if not isinstance(run, dict):
            return False
        if (run.get("path") != VERIFIED_WORKFLOW or run.get("head_branch") != "main"
                or run.get("event") not in ("push", "workflow_dispatch")
                or ((run.get("repository") or {}).get("full_name") or "").lower() != self.name.lower()):
            return False
        url = (f"{API}/repos/{self.name}/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100" if attempt
               else f"{API}/repos/{self.name}/actions/runs/{run_id}/jobs?filter=all&per_page=100")
        jobs = get(url, self.token)
        want = f"Mark {sha} verified"
        for job in (jobs.get("jobs") or []) if isinstance(jobs, dict) else []:
            for step in job.get("steps") or []:
                if step.get("name") == want and step.get("conclusion") == "success":
                    return True
        return False


def known_good() -> str:
    """The commit the walk may stop at, or '' when none is configured. Raises Unknown when
    one IS configured but cannot be read: a missing base must never shrink the check."""
    base = os.environ.get("BASE_COMMIT", "").strip()
    if base:
        if not HEX40.fullmatch(base):
            raise Unknown(f"BASE_COMMIT '{base[:12]}' is not a full 40-character commit id")
        return base
    path = os.environ.get("LIVE_BUILD_FILE", "").strip()
    url = os.environ.get("LIVE_BUILD_JSON", "").strip()
    if path:
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError) as e:
            raise Unknown(f"could not read the live commit from {path} ({e.__class__.__name__})") from e
        src = path
    elif url:
        try:
            data = get(f"{url}{'&' if '?' in url else '?'}cb={int(time.time())}", None)
        except Unknown as e:
            raise Unknown(f"could not read the live commit from {url}: {e}") from e
        src = url
    else:
        return ""
    commit = (data.get("commit") or "") if isinstance(data, dict) else ""
    if not HEX40.fullmatch(commit):
        raise Unknown(f"the live build.json at {src} names no full commit id")
    return commit


def check_range(repo: Repo, sha: str, base: str, context: str) -> tuple[str, str, list[str]]:
    """Walk first parents from sha back to a known-good commit (base, or one with a genuine
    verified marker); every commit on the way must be part of an approved pull request.
    Returns (verdict, reason, unapproved commits)."""
    if sha == base:
        return ("true", f"{sha[:7]} is already the live, known-good commit; nothing new to check", [])
    walked, whys, bad = [], [], []
    run: tuple[int, int] | None = None
    cur = sha
    for _ in range(MAX_WALK):
        if not cur:
            return ("unknown", f"the known-good commit {base[:7] or '(a verified one)'} is not on main's "
                               f"first-parent history of {sha[:7]}, so what is going live cannot be checked", [])
        if cur == base or (context and cur != sha and repo.verified(context, cur)):
            break
        ok, why, run = repo.judge(cur, run)
        walked.append(cur)
        whys.append(why)
        if not ok:
            bad.append(f"{cur[:7]} ({why})")
        cur = repo.first_parent(cur)
    else:
        return ("unknown", f"no known-good commit within {MAX_WALK} commits of {sha[:7]}", [])
    if bad:
        return ("false", f"{len(bad)} of the {len(walked)} commit(s) going live were not approved: "
                         + "; ".join(bad), bad)
    if len(walked) == 1:
        return ("true", whys[0], [])
    return ("true", f"all {len(walked)} commits going live are approved (newest: {whys[0]})", [])


def decide() -> tuple[str, str, list[str]]:
    event = os.environ.get("EVENT", "")
    sha = os.environ.get("SHA", "")
    actor = os.environ.get("ACTOR", "")
    approvers = parse_approvers(os.environ.get("APPROVERS", ""))
    if not approvers:
        return ("false", "APPROVERS is empty, so nobody can approve a publish", [])

    if event == "workflow_dispatch":
        if actor.lower() in approvers:
            return ("true", f"manual run started by {actor}, an approver", [])
        return ("false", f"manual run started by {actor or 'an unknown account'}, who is not an approver", [])
    if event not in ("push", "schedule"):
        return ("false", f"event '{event}' never publishes", [])

    name, token = os.environ.get("GITHUB_REPOSITORY", ""), os.environ.get("GITHUB_TOKEN", "")
    if not (sha and name and token):
        return ("unknown", "missing SHA, GITHUB_REPOSITORY or GITHUB_TOKEN", [])
    if not HEX40.fullmatch(sha):
        return ("unknown", f"SHA '{sha[:12]}' is not a full 40-character commit id", [])
    context = os.environ.get("VERIFIED_CONTEXT", "")
    try:
        base = known_good()
    except Unknown as e:
        return ("unknown", str(e), [])
    if not base and not context:
        return ("unknown", "no known-good commit is configured (BASE_COMMIT, LIVE_BUILD_FILE, "
                           "LIVE_BUILD_JSON or VERIFIED_CONTEXT), so what is going live cannot be checked", [])
    try:
        return check_range(Repo(name, token, approvers), sha, base, context)
    except Unknown as e:
        return ("unknown", f"could not check with the GitHub API: {e}", [])


def last_verified_before(sha: str) -> int:
    context = os.environ.get("VERIFIED_CONTEXT", "")
    try:
        base = known_good()
    except Unknown as e:
        eprint(f"::error::{e}")
        return 1
    if not base and not context:
        eprint("::error::no known-good commit is configured (BASE_COMMIT or VERIFIED_CONTEXT)")
        return 2
    repo = Repo(os.environ.get("GITHUB_REPOSITORY", ""), os.environ.get("GITHUB_TOKEN", ""),
                parse_approvers(os.environ.get("APPROVERS", "")))
    try:
        cur = repo.first_parent(sha)
        for _ in range(MAX_WALK):
            if not cur:
                break
            if cur == base or (context and repo.verified(context, cur)):
                print(cur)
                return 0
            cur = repo.first_parent(cur)
    except Unknown as e:
        eprint(f"::error::could not walk the history: {e}")
        return 1
    eprint(f"::error::no known-good commit within {MAX_WALK} commits before {sha[:7]}")
    return 2


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--last-verified-before":
        return last_verified_before(sys.argv[2])
    if len(sys.argv) == 3 and sys.argv[1] == "--is-approver":
        return 0 if sys.argv[2].strip().lower() in parse_approvers(os.environ.get("APPROVERS", "")) else 1
    if len(sys.argv) == 3 and sys.argv[1] == "--is-verified":
        context = os.environ.get("VERIFIED_CONTEXT", "")
        if not context or not HEX40.fullmatch(sys.argv[2]):
            eprint("::error::--is-verified needs VERIFIED_CONTEXT and a full commit id")
            return 2
        repo = Repo(os.environ.get("GITHUB_REPOSITORY", ""), os.environ.get("GITHUB_TOKEN", ""), set())
        try:
            return 0 if repo.verified(context, sys.argv[2]) else 1
        except Unknown as e:
            eprint(f"::warning::could not check the marker: {e}")
            return 2
    if len(sys.argv) != 1:
        eprint("usage: deploy_gate.py [--last-verified-before SHA | --is-approver LOGIN | --is-verified SHA]")
        return 64
    verdict, reason, bad = decide()
    print(f"approved={verdict}: {reason}")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"approved={verdict}\n")
            f.write(f"reason={reason.replace(chr(10), ' ')}\n")
            f.write(f"unapproved={' '.join(b.split(' ')[0] for b in bad)}\n")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            head = {"true": "Approved", "false": "NOT approved", "unknown": "Approval could not be checked"}[verdict]
            f.write(f"### {head}\n\n{reason}\n\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

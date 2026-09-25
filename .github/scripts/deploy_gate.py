#!/usr/bin/env python3
"""deploy_gate.py: was this change approved to be on the public site?

The one human approval before production. GitHub's free plan cannot protect
`main` on a private repository (branch protection and rulesets answer
"Upgrade to GitHub Pro"), so anyone with write access can push to it. An
approved change is a pull request into main merged by an approver.

What it checks, by event:
  push / schedule    every first-parent commit from BASE (exclusive) up to SHA
                     must be an approved merge. BASE is the commit that is known
                     good: the live site's commit (BASE_COMMIT or LIVE_BUILD_JSON),
                     or, with VERIFIED_CONTEXT, the newest ancestor carrying that
                     commit status (set only by a check that passed). So an
                     unapproved direct push cannot ride along under a later
                     approved merge. If the known-good commit is not on main's
                     first-parent history, the verdict is "unknown".
                     With neither, only SHA itself is checked.
  schedule           also: SHA equal to the live commit is already approved.
  workflow_dispatch  the person who started the run must be an approver.
  anything else      never approved.

It never guesses. If GitHub's API cannot answer, the verdict is "unknown"
(callers must not publish on it, and must not roll back on it either).

Writes approved=true|false|unknown, reason=..., and unapproved=<commits> to
$GITHUB_OUTPUT, and a line to the run summary. Exit 0 whenever it ran.

Also a helper mode for rollbacks:
  deploy_gate.py --last-approved-before SHA
      prints the newest first-parent ancestor of SHA (excluding SHA) that is an
      approved merge; exit 2 if none within MAX_WALK commits.

Environment: GITHUB_TOKEN (contents:read, pull-requests:read; statuses:read for
VERIFIED_CONTEXT), GITHUB_REPOSITORY, GITHUB_API_URL, EVENT, SHA, ACTOR,
APPROVERS (logins, spaces or commas), and optionally BASE_COMMIT,
LIVE_BUILD_JSON (a URL whose JSON has "commit"), VERIFIED_CONTEXT (a commit
status context). Standard library only.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

API = os.environ.get("GITHUB_API_URL", "https://api.github.com").rstrip("/")
MAX_WALK = 30


class Unknown(Exception):
    """GitHub could not give an answer; the verdict must be 'unknown'."""


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
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last = e
        time.sleep(2 * (i + 1))
    raise Unknown(f"GitHub did not answer ({last})")


class Repo:
    def __init__(self, name: str, token: str, approvers: set[str]):
        self.name, self.token, self.approvers = name, token, approvers
        self._approved: dict[str, tuple[bool, str]] = {}

    def approved_merge(self, sha: str) -> tuple[bool, str]:
        """Is `sha` the merge (or squash) commit of a PR into main merged by an approver?
        GitHub links a new merge commit to its PR a moment after the merge, so an empty
        answer is asked again before it counts as 'not a merge'."""
        if sha in self._approved:
            return self._approved[sha]
        merges: list[dict] = []
        for attempt in range(3):
            pulls = get(f"{API}/repos/{self.name}/commits/{sha}/pulls", self.token)
            merges = [p for p in pulls if isinstance(p, dict) and p.get("merged_at")
                      and p.get("merge_commit_sha") == sha
                      and (p.get("base") or {}).get("ref") == "main"] if isinstance(pulls, list) else []
            if merges:
                break
            if attempt < 2:
                time.sleep(5)
        if not merges:
            res = (False, f"{sha[:7]} is not the merge of a pull request into main (a direct push, or a commit made inside a branch)")
        else:
            full = get(f"{API}/repos/{self.name}/pulls/{merges[0]['number']}", self.token)
            who = ((full.get("merged_by") or {}).get("login") or "") if isinstance(full, dict) else ""
            if who.lower() in self.approvers:
                res = (True, f"PR #{merges[0]['number']} merged by {who}")
            else:
                res = (False, f"PR #{merges[0]['number']} was merged by {who or 'an unknown account'}, who is not an approver")
        self._approved[sha] = res
        return res

    def first_parent(self, sha: str) -> str:
        c = get(f"{API}/repos/{self.name}/commits/{sha}", self.token)
        parents = (c.get("parents") or []) if isinstance(c, dict) else []
        return parents[0]["sha"] if parents else ""

    def verified(self, context: str, sha: str) -> bool:
        """Did a real check already pass on this commit? Only the check itself sets this
        commit status (context VERIFIED_CONTEXT), and only after it passed."""
        r = get(f"{API}/repos/{self.name}/commits/{sha}/status", self.token)
        states = [s.get("state") for s in (r.get("statuses") or []) if s.get("context") == context] if isinstance(r, dict) else []
        return bool(states) and states[0] == "success"


def live_commit(url: str) -> str:
    if not url:
        return ""
    try:
        data = get(f"{url}{'&' if '?' in url else '?'}cb={int(time.time())}", None, attempts=2)
    except Unknown:
        return ""
    return (data.get("commit") or "") if isinstance(data, dict) else ""


def check_range(repo: Repo, sha: str, base: str, context: str) -> tuple[str, str, list[str]]:
    """Walk first parents from sha back to a known-good commit (base, or one whose check
    already passed); every commit on the way must be an approved merge.
    Returns (verdict, reason, unapproved commits)."""
    walked, bad = [], []
    cur, reached = sha, False
    for _ in range(MAX_WALK):
        if not cur:
            break  # the start of the history
        if cur == base or (context and cur != sha and repo.verified(context, cur)):
            reached = True
            break
        ok, why = repo.approved_merge(cur)
        walked.append(cur)
        if not ok:
            bad.append(f"{cur[:7]} ({why})")
        if not base and not context:
            reached = True
            break  # nothing to walk back to: the head alone decides
        cur = repo.first_parent(cur)
    else:
        return ("unknown", f"no known-good commit within {MAX_WALK} commits of {sha[:7]}", [])
    if not reached:
        return ("unknown", f"the known-good commit {base[:7] or '(none recorded)'} is not on main's "
                           f"first-parent history of {sha[:7]}, so what is going live cannot be checked", [])
    if bad:
        return ("false", f"{len(bad)} of the {len(walked)} commit(s) going live were not approved: " + "; ".join(bad), bad)
    if len(walked) == 1:
        return ("true", repo.approved_merge(sha)[1], [])
    return ("true", f"all {len(walked)} commits going live are approved merges (head: {repo.approved_merge(sha)[1]})", [])


def decide() -> tuple[str, str, list[str]]:
    event = os.environ.get("EVENT", "")
    sha = os.environ.get("SHA", "")
    actor = os.environ.get("ACTOR", "")
    approvers = {a.strip().lower() for a in os.environ.get("APPROVERS", "").replace(",", " ").split() if a.strip()}
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
    base = os.environ.get("BASE_COMMIT", "") or live_commit(os.environ.get("LIVE_BUILD_JSON", ""))
    if event == "schedule" and base and base == sha:
        return ("true", f"{sha[:7]} is already the live commit", [])
    try:
        return check_range(Repo(name, token, approvers), sha, base, os.environ.get("VERIFIED_CONTEXT", ""))
    except Unknown as e:
        return ("unknown", f"could not check with the GitHub API: {e}", [])


def last_approved_before(sha: str) -> int:
    approvers = {a.strip().lower() for a in os.environ.get("APPROVERS", "").replace(",", " ").split() if a.strip()}
    repo = Repo(os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_TOKEN"], approvers)
    try:
        cur = repo.first_parent(sha)
        for _ in range(MAX_WALK):
            if not cur:
                break
            if repo.approved_merge(cur)[0]:
                print(cur)
                return 0
            cur = repo.first_parent(cur)
    except Unknown as e:
        print(f"::error::could not walk the history: {e}")
        return 1
    print(f"::error::no approved merge within {MAX_WALK} commits before {sha[:7]}")
    return 2


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--last-approved-before":
        return last_approved_before(sys.argv[2])
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

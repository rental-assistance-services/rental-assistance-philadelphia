#!/usr/bin/env python3
"""deploy_gate.py: may this run put a commit on the public site?

The one human approval before production. On GitHub's free plan a private
repository cannot protect `main` (branch protection and rulesets answer
"Upgrade to GitHub Pro"), so anyone with write access can push straight to
main. This check is what stands between that and the live site:

  push to main       the pushed commit must be the merge of a pull request,
                     merged by an approver. A direct push is built, never
                     published.
  schedule           the daily rebuild publishes main's head only if that
                     head was approved the same way, or is already what the
                     live site serves (it was approved when it went live).
  workflow_dispatch  the person who pressed "Run workflow" must be an approver.
  anything else      never approved.

Standard library only, so it runs on the self-hosted runner's system Python
with nothing installed. Writes approved=true|false and reason=... to
$GITHUB_OUTPUT and a line to the run summary. Exit status is 0 whenever a
decision was made (the decision is the output); a check that cannot reach the
GitHub API decides "not approved" rather than guessing.

Environment:
  GITHUB_TOKEN        token with contents:read and pull-requests:read
  GITHUB_REPOSITORY   owner/name
  GITHUB_API_URL      default https://api.github.com
  EVENT               github.event_name
  SHA                 the commit that would be published
  ACTOR               github.triggering_actor
  APPROVERS           GitHub logins, separated by spaces or commas
  LIVE_BUILD_JSON     optional URL of the live site's /build.json (schedule only)
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

API = os.environ.get("GITHUB_API_URL", "https://api.github.com").rstrip("/")


def _get(url: str, token: str | None = None, attempts: int = 3) -> object:
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
            # A 4xx other than rate limiting will not change on retry.
            if e.code < 500 and e.code != 429:
                raise
            last = e
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last = e
        time.sleep(2 * (i + 1))
    raise RuntimeError(f"GET {url} failed after {attempts} attempts: {last}")


def merged_by_approver(repo: str, sha: str, token: str, approvers: set[str]) -> tuple[bool, str]:
    pulls = _get(f"{API}/repos/{repo}/commits/{sha}/pulls", token)
    merges = [p for p in pulls if isinstance(p, dict)
              and p.get("merged_at")
              and p.get("merge_commit_sha") == sha
              and (p.get("base") or {}).get("ref") == "main"]
    if not merges:
        return False, (f"{sha[:7]} is not the merge of a pull request into main "
                       f"(a direct push, or a commit inside a branch)")
    for p in merges:
        full = _get(f"{API}/repos/{repo}/pulls/{p['number']}", token)
        who = ((full.get("merged_by") or {}).get("login") or "") if isinstance(full, dict) else ""
        if who.lower() in approvers:
            return True, f"PR #{p['number']} merged by {who}"
        return False, (f"PR #{p['number']} was merged by {who or 'an unknown account'}, "
                       f"who is not an approver")
    return False, "no merged pull request found"  # unreachable, kept for clarity


def live_commit(url: str) -> str:
    try:
        data = _get(f"{url}{'&' if '?' in url else '?'}cb={int(time.time())}", None, attempts=2)
    except Exception:
        return ""
    return (data.get("commit") or "") if isinstance(data, dict) else ""


def decide() -> tuple[bool, str]:
    event = os.environ.get("EVENT", "")
    sha = os.environ.get("SHA", "")
    actor = os.environ.get("ACTOR", "")
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get("GITHUB_TOKEN", "")
    approvers = {a.strip().lower() for a in os.environ.get("APPROVERS", "").replace(",", " ").split() if a.strip()}

    if not approvers:
        return False, "APPROVERS is empty, so nobody can approve a publish"

    if event == "workflow_dispatch":
        if actor.lower() in approvers:
            return True, f"manual run started by {actor}, an approver"
        return False, f"manual run started by {actor or 'an unknown account'}, who is not an approver"

    if event not in ("push", "schedule"):
        return False, f"event '{event}' never publishes"
    if not (sha and repo and token):
        return False, "missing SHA, GITHUB_REPOSITORY or GITHUB_TOKEN"

    try:
        ok, why = merged_by_approver(repo, sha, token, approvers)
    except Exception as e:  # the API could not answer: do not guess
        return False, f"could not check the merge with the GitHub API ({e})"
    if ok:
        return True, why

    if event == "schedule":
        live_url = os.environ.get("LIVE_BUILD_JSON", "")
        if live_url and live_commit(live_url) == sha:
            return True, f"{sha[:7]} is already the live commit (approved when it went live); rebuilding it"
    return False, why


def main() -> int:
    approved, reason = decide()
    verdict = "true" if approved else "false"
    print(f"approved={verdict}: {reason}")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"approved={verdict}\n")
            f.write(f"reason={reason.replace(chr(10), ' ')}\n")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            mark = "Approved to publish" if approved else "NOT approved to publish"
            f.write(f"### {mark}\n\n{reason}\n\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""pages_switch.py — point a Cloudflare Pages project's production at another
deployment, safely, and prove it.

Used for every rollback (automatic after a failed deploy, and by hand). A Pages
"rollback" only re-points production at a deployment Cloudflare already holds;
this wraps it so it can never quietly leave the site on something worse:

  1. pick the target: --to ID (a full id or the 8-character prefix the dashboard
     shows), --previous (the successful production deployment before the live
     one), or --before-commit SHA (the one before the newest deployment of SHA).
     Failed deployments are skipped; a target with no commit is refused.
  2. check the TARGET on its own address (https://<id>.<project>.pages.dev)
     before anything changes. A password-gated, stale or leaking deployment is
     refused here and production is never touched.
  3. switch, then re-read the project to confirm Cloudflare really switched
     (a timed-out request can still have been applied).
  4. verify the PUBLIC address serves the target (retried while the edge catches
     up). "Definitely wrong" puts the original back; "unreachable" does not
     (unreachable is not evidence), it reports and stops.
  5. a put-back is itself confirmed and verified, and reported as what it is.

A state file records the original deployment before the switch, so a step that
runs on cancel can call --restore and undo a half-finished switch.

Exit codes: 0 switched and verified (or dry run, or already live)
            1 refused or could not switch (production unchanged)
            2 nothing suitable to switch to
            3 the target failed its own check (production unchanged)
            4 switched, but the public address could not be reached to verify it
            5 the target was wrong in public; the original was put back and verified
            6 PUT-BACK FAILED or unverified: production may be wrong right now
            7 production no longer serves --only-if-live-commit: nothing switched
Needs CLOUDFLARE_API_TOKEN (Account > Cloudflare Pages > Edit) and
CLOUDFLARE_ACCOUNT_ID in the environment (never on the command line).
Standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4/accounts/{acc}/pages/projects/{path}"


def api(method: str, path: str) -> dict:
    req = urllib.request.Request(
        API.format(acc=os.environ["CLOUDFLARE_ACCOUNT_ID"], path=path), method=method,
        headers={"Authorization": f"Bearer {os.environ['CLOUDFLARE_API_TOKEN']}",
                 "User-Agent": "pages-switch"})
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            try:
                return json.load(e)
            except Exception:  # noqa: BLE001
                return {"success": False, "errors": [{"message": f"HTTP {e.code}"}]}
        except Exception as e:  # noqa: BLE001 - network: retry, then report
            last = e
            time.sleep(3 * (attempt + 1))
    return {"success": False, "errors": [{"message": f"no answer from the API: {last}"}]}


def commit_of(d: dict) -> str:
    return ((d.get("deployment_trigger") or {}).get("metadata") or {}).get("commit_hash") or ""


def succeeded(d: dict) -> bool:
    return (d.get("latest_stage") or {}).get("status") == "success"


def live_id(project: str) -> tuple[str, dict]:
    p = api("GET", project)
    if not p.get("success"):
        return "", p
    return ((p.get("result") or {}).get("canonical_deployment") or {}).get("id", ""), p


def run_check(check: str, url: str, commit: str) -> int:
    cmd = shlex.split(check) + ["--url", url, "--expect-commit", commit]
    print(f"$ {' '.join(cmd)}", flush=True)
    return subprocess.run(cmd).returncode


def verify_public(check: str, url: str, commit: str, attempts: int, wait: int) -> int:
    rc = 1
    for i in range(1, attempts + 1):
        time.sleep(wait)
        rc = run_check(check, url, commit)
        if rc == 0:
            print(f"public address serves {commit[:7]} (attempt {i}/{attempts})", flush=True)
            return 0
        print(f"attempt {i}/{attempts}: check exited {rc}", flush=True)
    return rc


def save(state_file: str | None, **state) -> None:
    if state_file:
        with open(state_file, "w", encoding="utf-8") as f:
            json.dump(state, f)


def put_back(a, original: str, original_commit: str) -> int:
    if not original:
        print("::error::the deployment that was live before is unknown, so it cannot be put back. "
              f"Cloudflare > Workers & Pages > {a.project} > Deployments: roll back by hand.")
        return 6
    print(f"::warning::putting production back to {original} ({original_commit[:7]})", flush=True)
    api("POST", f"{a.project}/deployments/{original}/rollback")
    now, _ = live_id(a.project)
    if now != original:
        print(f"::error::PUT-BACK FAILED: production is {now or 'unknown'}, not {original}. "
              f"Cloudflare > Workers & Pages > {a.project} > Deployments > {original} > Rollback.")
        return 6
    if a.public_url and original_commit:
        rc = verify_public(a.check, a.public_url, original_commit, a.attempts, a.wait)
        if rc != 0:
            print(f"::error::put back to {original}, but the public address does not confirm it (exit {rc})")
            return 6
    save(a.state_file, phase="restored", original=original, original_commit=original_commit)
    print(f"put back to {original} and verified")
    return 5


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--to")
    g.add_argument("--previous", action="store_true")
    g.add_argument("--before-commit")
    g.add_argument("--to-commit", help="the newest successful production deployment of this commit")
    g.add_argument("--restore", metavar="STATE_FILE")
    g.add_argument("--print-live", action="store_true", help="print id and commit of the live deployment")
    ap.add_argument("--check", default="bash deploy/check-live.sh",
                    help="the repo's live check; --url and --expect-commit are appended")
    ap.add_argument("--public-url", default="", help="verify here after switching (empty: skip)")
    ap.add_argument("--state-file", default="")
    ap.add_argument("--attempts", type=int, default=8)
    ap.add_argument("--wait", type=int, default=10)
    ap.add_argument("--only-if-live-commit", default="",
                    help="do nothing (exit 7) unless production still serves this commit")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if a.restore:
        try:
            st = json.load(open(a.restore, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            print("no switch was recorded; nothing to restore")
            return 0
        if st.get("phase") not in ("switching", "switched"):
            print(f"last recorded phase is {st.get('phase')}; nothing to restore")
            return 0
        a.state_file = a.restore
        return put_back(a, st["original"], st.get("original_commit", ""))

    live, proj = live_id(a.project)
    if not proj.get("success"):
        print(f"::error::cannot read project {a.project}: {proj.get('errors')}")
        return 1
    listing = api("GET", f"{a.project}/deployments?env=production&per_page=25")
    deps = [d for d in (listing.get("result") or []) if d.get("environment") == "production"]
    by_id = {d.get("id"): d for d in deps}
    live_dep = by_id.get(live, {})
    if a.print_live:
        print(f"{live} {commit_of(live_dep)}")
        return 0 if live else 1
    if a.only_if_live_commit and commit_of(live_dep) != a.only_if_live_commit:
        print(f"production now serves {commit_of(live_dep)[:7] or 'something else'}, not "
              f"{a.only_if_live_commit[:7]}: a newer deployment took over, so nothing is switched")
        return 7

    target = None
    if a.to:
        matches = [d for d in deps if d.get("id", "").startswith(a.to)]
        if len(matches) != 1:
            print(f"::error::'{a.to}' matches {len(matches)} of the last {len(deps)} production deployments; "
                  "give the full id (Workers & Pages > project > Deployments)")
            return 1
        target = matches[0]
        if not succeeded(target):
            print(f"::error::{target.get('id')} did not build successfully; refusing")
            return 1
    elif a.to_commit:
        target = next((d for d in deps if commit_of(d) == a.to_commit and succeeded(d)), None)
        if target is None:
            print(f"::error::no successful production deployment of {a.to_commit[:7]} among the last {len(deps)}")
            return 2
    else:
        if a.before_commit:
            idx = next((i for i, d in enumerate(deps) if commit_of(d) == a.before_commit), None)
        else:
            idx = next((i for i, d in enumerate(deps) if d.get("id") == live), None)
        if idx is not None:
            target = next((d for d in deps[idx + 1:] if succeeded(d)), None)
    if target is None:
        print("::warning::no earlier successful production deployment to switch to")
        return 2
    tid, tcommit = target.get("id", ""), commit_of(target)
    print(f"live: {live} ({commit_of(live_dep)[:7]}) -> target: {tid} ({tcommit[:7]})")
    if tid == live:
        print("the target is already live; nothing to do")
        return 0
    if not tcommit:
        print(f"::error::{tid} records no commit, so it cannot be verified; refusing")
        return 1

    turl = target.get("url") or ""
    if not turl:
        print(f"::error::{tid} has no deployment address to check; refusing")
        return 1
    print(f"checking the target on its own address first: {turl}")
    if run_check(a.check, turl.rstrip("/") + "/", tcommit) != 0:
        print(f"::error::{tid} fails its own check (gated, stale or leaking); production was NOT touched")
        return 3
    if a.dry_run:
        print("dry run: the target passed its own check; nothing switched")
        return 0

    save(a.state_file, phase="switching", original=live, original_commit=commit_of(live_dep), target=tid)
    api("POST", f"{a.project}/deployments/{tid}/rollback")
    now, _ = live_id(a.project)
    if now != tid:
        save(a.state_file, phase="not-switched", original=live, original_commit=commit_of(live_dep))
        print(f"::error::Cloudflare did not switch production (it is {now or 'unknown'}); nothing changed")
        return 1
    save(a.state_file, phase="switched", original=live, original_commit=commit_of(live_dep), target=tid)
    print(f"production now points at {tid}")

    if not a.public_url:
        save(a.state_file, phase="done", original=live, target=tid)
        return 0
    rc = verify_public(a.check, a.public_url, tcommit, a.attempts, a.wait)
    if rc == 0:
        save(a.state_file, phase="done", original=live, target=tid)
        return 0
    if rc == 2:
        save(a.state_file, phase="unverified", original=live, target=tid)
        print("::error::switched, but the public address could not be reached to verify it; NOT putting back "
              "(unreachable is not evidence). Check it by hand.")
        return 4
    return put_back(a, live, commit_of(live_dep))


if __name__ == "__main__":
    sys.exit(main())

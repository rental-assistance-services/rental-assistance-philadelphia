#!/usr/bin/env python3
"""pages_switch.py: point a Cloudflare Pages project's production at another
deployment, safely, and prove it.

Used for every rollback (automatic after a failed or unapproved deploy, and by
hand). A Pages "rollback" only re-points production at a deployment Cloudflare
already holds; this wraps it so it never quietly leaves the site on something
worse:

  1. pick the target: --to ID (a full id, or at least the first 8 characters the
     dashboard shows), --previous (the successful production deployment before
     the live one), --before-commit SHA (the one before the newest deployment of
     SHA) or --to-commit SHA (the newest successful deployment of SHA). Failed
     deployments are skipped; a target that records no commit is refused.
  2. check the TARGET on its own address (https://<id>.<project>.pages.dev)
     before anything changes, retried while it is only unreachable. A
     password-gated, stale or leaking deployment is refused here and production
     is never touched.
  3. with --only-if-live-commit, read production again right before switching:
     if a newer deployment took over during the check, nothing is switched.
  4. switch, then re-read the project to confirm Cloudflare really switched (a
     timed-out request can still have been applied). If that read fails, the
     public check below decides.
  5. verify the PUBLIC address serves the target, retried while the edge catches
     up. Unreachable is never evidence: it reports and stops. "Definitely wrong"
     puts the original back, EXCEPT with --no-put-back, which every automatic
     rollback uses: there the original is the deployment being removed, so it
     stays removed and the run reports production as unverified.
  6. a put-back is itself confirmed and verified, and reported as what it is.

--state-file records what --restore must put back if the job is cancelled
half-way. With --no-put-back nothing restorable is recorded, so a cancel can never
bring back the deployment that was being removed.

The live check (--check; --url and --expect-commit are appended) is code from the
repository, so it runs without any CLOUDFLARE_* or ACTIONS_* variable, GITHUB_TOKEN,
GH_TOKEN or SLACK_WEBHOOK_URL in its environment.

Exit codes: 0 switched and verified (or a dry run that would switch)
            1 refused, or could not switch (production unchanged)
            2 nothing suitable to switch to (production unchanged)
            3 the target failed, or could not get through, its own check
              (production unchanged)
            4 switched, but the public address did not confirm it (unreachable,
              or wrong under --no-put-back): production is the target, unverified
            5 the target was wrong in public; the original was put back and verified
            6 production may be wrong right now: a put-back failed or is
              unverified, or the switch could not be confirmed either way
            7 production no longer serves --only-if-live-commit: nothing switched
            8 the target is already live: nothing to do
Messages go to stderr. stdout carries only --print-live's "<id> <commit>".
Needs CLOUDFLARE_API_TOKEN (Account > Cloudflare Pages > Edit) and
CLOUDFLARE_ACCOUNT_ID in the environment (never on the command line).
Standard library only.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import re
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "https://api.cloudflare.com/client/v4/accounts/{acc}/pages/projects/{path}"
ID_RE = re.compile(r"[0-9a-f][0-9a-f-]{7,35}")
HEX40 = re.compile(r"[0-9a-f]{40}")
SLEEP = 3  # seconds, times the attempt number, between API retries
# Never handed to the repository's check (it is code from the commit being judged).
WITHHELD_PREFIXES = ("CLOUDFLARE_", "ACTIONS_")
WITHHELD = {"GITHUB_TOKEN", "GH_TOKEN", "SLACK_WEBHOOK_URL"}


class Fail(Exception):
    pass


def say(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def errors(resp: dict) -> str:
    return "; ".join(str((e or {}).get("message", e)) for e in (resp.get("errors") or [])) or "no detail"


def api(method: str, path: str) -> dict:
    """GETs are retried on 5xx, 429 and network errors. A POST is sent once: the caller
    confirms what happened by reading the project again."""
    tries = 3 if method == "GET" else 1
    last = "no attempt"
    for i in range(tries):
        req = urllib.request.Request(
            API.format(acc=os.environ["CLOUDFLARE_ACCOUNT_ID"], path=path), method=method,
            headers={"Authorization": f"Bearer {os.environ['CLOUDFLARE_API_TOKEN']}",
                     "User-Agent": "pages-switch"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code >= 500 or e.code == 429:
                last = f"HTTP {e.code}"
            else:
                try:
                    body = json.load(e)
                except (OSError, ValueError):
                    body = None
                return body if isinstance(body, dict) else {"success": False, "errors": [{"message": f"HTTP {e.code}"}]}
        except (OSError, http.client.HTTPException, ValueError) as e:
            last = e.__class__.__name__
        if i < tries - 1:
            time.sleep(SLEEP * (i + 1))
    return {"success": False, "errors": [{"message": f"no answer from the API ({last})"}]}


def commit_of(d: dict) -> str:
    return ((d.get("deployment_trigger") or {}).get("metadata") or {}).get("commit_hash") or ""


def succeeded(d: dict) -> bool:
    return (d.get("latest_stage") or {}).get("status") == "success"


def live(project: str) -> tuple[str, str]:
    """(id, commit) of the deployment production serves; raises Fail if it cannot be read."""
    p = api("GET", project)
    dep = ((p.get("result") or {}).get("canonical_deployment") or {}) if p.get("success") else {}
    lid = dep.get("id") or ""
    if not lid:
        raise Fail(f"cannot read project {project}: {errors(p)}")
    commit = commit_of(dep)
    if not commit:
        d = api("GET", f"{project}/deployments/{lid}")
        commit = commit_of(d.get("result") or {}) if d.get("success") else ""
    return lid, commit


def run_check(check: str, url: str, commit: str) -> int:
    cmd = shlex.split(check) + ["--url", url, "--expect-commit", commit]
    say(f"$ {' '.join(cmd)}")
    env = {k: v for k, v in os.environ.items() if not k.startswith(WITHHELD_PREFIXES) and k not in WITHHELD}
    try:
        return subprocess.run(cmd, env=env, stdout=sys.stderr).returncode
    except OSError as e:
        say(f"::error::cannot run the check: {e}")
        return 2


def verify_public(check: str, url: str, commit: str, attempts: int, wait: int) -> int:
    """0 as soon as one attempt passes; otherwise 1 if any attempt saw the wrong site
    (that is evidence), 2 if every attempt was only unreachable."""
    seen_wrong = False
    for i in range(1, attempts + 1):
        time.sleep(wait)
        rc = run_check(check, url, commit)
        if rc == 0:
            say(f"public address serves {commit[:7]} (attempt {i}/{attempts})")
            return 0
        seen_wrong = seen_wrong or rc == 1
        say(f"attempt {i}/{attempts}: check exited {rc}")
    return 1 if seen_wrong else 2


def save(state_file: str | None, **state) -> None:
    if state_file:
        with open(state_file, "w", encoding="utf-8") as f:
            json.dump(state, f)


def put_back(a, original: str, original_commit: str) -> int:
    if not original:
        say("::error::the deployment that was live before is unknown, so it cannot be put back. "
            f"Cloudflare > Workers & Pages > {a.project} > Deployments: roll back by hand.")
        return 6
    say(f"::warning::putting production back to {original} ({original_commit[:7] or 'no commit recorded'})")
    api("POST", f"{a.project}/deployments/{original}/rollback")
    try:
        now, _ = live(a.project)
    except Fail:
        now = ""
    if now != original:
        say(f"::error::PUT-BACK NOT CONFIRMED: production is {now or 'unreadable'}, not {original}. "
            f"Cloudflare > Workers & Pages > {a.project} > Deployments > {original} > Rollback.")
        return 6
    if not a.public_url:
        save(a.state_file, phase="restored", original=original)
        say(f"put back to {original} (confirmed by the Cloudflare API; no public address to check)")
        return 5
    if not original_commit:
        say(f"::error::put back to {original}, but it records no commit, so the public address cannot "
            "confirm it. Check the site by hand.")
        return 6
    rc = verify_public(a.check, a.public_url, original_commit, a.attempts, a.wait)
    if rc != 0:
        say(f"::error::put back to {original}, but the public address does not confirm it (exit {rc})")
        return 6
    save(a.state_file, phase="restored", original=original)
    say(f"put back to {original} and verified")
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
    ap.add_argument("--no-put-back", action="store_true",
                    help="automatic rollbacks: never switch back to the deployment being removed")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if not (os.environ.get("CLOUDFLARE_API_TOKEN") and os.environ.get("CLOUDFLARE_ACCOUNT_ID")):
        say("::error::CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set")
        return 1

    if a.restore:
        try:
            with open(a.restore, encoding="utf-8") as f:
                st = json.load(f)
        except (OSError, ValueError):
            say("no switch was recorded; nothing to restore")
            return 0
        if st.get("phase") not in ("switching", "switched"):
            say(f"last recorded phase is {st.get('phase')}; nothing to restore")
            return 0
        a.state_file = a.restore
        return put_back(a, st.get("original", ""), st.get("original_commit", ""))

    try:
        lid, lcommit = live(a.project)
    except Fail as e:
        say(f"::error::{e}")
        return 1
    if a.print_live:
        print(f"{lid} {lcommit}")
        return 0

    listing = api("GET", f"{a.project}/deployments?env=production&per_page=25")
    if not listing.get("success") or not isinstance(listing.get("result"), list):
        say(f"::error::cannot list the production deployments of {a.project}: {errors(listing)}")
        return 1
    deps = [d for d in listing["result"] if isinstance(d, dict) and d.get("environment") == "production"]

    target = None
    if a.to:
        if not ID_RE.fullmatch(a.to):
            say(f"::error::'{a.to[:40]}' is not a deployment id (at least 8 characters of it)")
            return 1
        matches = [d for d in deps if (d.get("id") or "").startswith(a.to)]
        if len(matches) != 1:
            say(f"::error::'{a.to}' matches {len(matches)} of the last {len(deps)} production deployments; "
                "give the full id (Workers & Pages > project > Deployments)")
            return 1
        target = matches[0]
        if not succeeded(target):
            say(f"::error::{target.get('id')} did not build successfully; refusing")
            return 1
    elif a.to_commit:
        if not HEX40.fullmatch(a.to_commit):
            say(f"::error::'{a.to_commit[:40]}' is not a full commit id")
            return 1
        target = next((d for d in deps if commit_of(d) == a.to_commit and succeeded(d)), None)
        if target is None:
            say(f"::error::no successful production deployment of {a.to_commit[:7]} among the last {len(deps)}")
            return 2
    else:
        if a.before_commit:
            if not HEX40.fullmatch(a.before_commit):
                say(f"::error::'{a.before_commit[:40]}' is not a full commit id")
                return 1
            idx = next((i for i, d in enumerate(deps) if commit_of(d) == a.before_commit), None)
        else:
            idx = next((i for i, d in enumerate(deps) if d.get("id") == lid), None)
            if idx is None:
                say(f"::error::the live deployment {lid} is not among the last {len(deps)} production "
                    "deployments, so 'the one before it' is unknown; name the target with --to")
                return 1
        if idx is not None:
            target = next((d for d in deps[idx + 1:] if succeeded(d)), None)
    if target is None:
        say("::warning::no earlier successful production deployment to switch to")
        return 2
    tid, tcommit = target.get("id", ""), commit_of(target)
    say(f"live: {lid} ({lcommit[:7]}) -> target: {tid} ({tcommit[:7]})")
    if tid == lid:
        say("the target is already live; nothing to do")
        return 8
    if a.only_if_live_commit:
        if not lcommit:
            say(f"::error::cannot read which commit production serves ({lid}), so whether a newer "
                "deployment took over is unknown; nothing switched")
            return 1
        if lcommit != a.only_if_live_commit:
            say(f"production now serves {lcommit[:7]}, not {a.only_if_live_commit[:7]}: a newer deployment "
                "took over, so nothing is switched")
            return 7
    if not tcommit:
        say(f"::error::{tid} records no commit, so it cannot be verified; refusing")
        return 1
    turl = (target.get("url") or "").rstrip("/")
    if not turl:
        say(f"::error::{tid} has no deployment address to check; refusing")
        return 1

    say(f"checking the target on its own address first: {turl}/")
    rc = 2
    for i in range(1, 4):
        rc = run_check(a.check, turl + "/", tcommit)
        if rc != 2:
            break
        if i < 3:
            time.sleep(a.wait)
    if rc == 2:
        say(f"::error::{tid} could not be checked on its own address (no answer in 3 tries); "
            "production was NOT touched")
        return 3
    if rc != 0:
        say(f"::error::{tid} fails its own check (gated, stale or leaking); production was NOT touched")
        return 3
    if a.dry_run:
        say("dry run: the target passed its own check; nothing switched")
        return 0

    if a.only_if_live_commit:
        try:
            lid, lcommit = live(a.project)
        except Fail as e:
            say(f"::error::cannot re-read production right before switching ({e}); nothing switched")
            return 1
        if not lcommit:
            say("::error::cannot read which commit production serves right before switching; nothing switched")
            return 1
        if lcommit != a.only_if_live_commit:
            say(f"production changed to {lcommit[:7]} during the check: a newer deployment took over, "
                "so nothing is switched")
            return 7

    if a.no_put_back:
        save(a.state_file, phase="no-restore", target=tid)
    else:
        save(a.state_file, phase="switching", original=lid, original_commit=lcommit, target=tid)
    post = api("POST", f"{a.project}/deployments/{tid}/rollback")
    try:
        now, _ = live(a.project)
    except Fail:
        now = ""
    if now and now != tid:
        if not a.no_put_back:
            save(a.state_file, phase="not-switched", original=lid)
        say(f"::error::Cloudflare did not switch production (it is still {now}): {errors(post)}")
        return 1
    if now:
        say(f"production now points at {tid}")
    else:
        say("::warning::could not re-read the project after the switch; the public check decides")
    if not a.no_put_back:
        save(a.state_file, phase="switched", original=lid, original_commit=lcommit, target=tid)

    if not a.public_url:
        if not now:
            say("::error::the switch could not be confirmed, and there is no public address to check")
            return 6
        save(a.state_file, phase="done", target=tid)
        return 0
    rc = verify_public(a.check, a.public_url, tcommit, a.attempts, a.wait)
    if rc == 0:
        save(a.state_file, phase="done", target=tid)
        return 0
    if rc == 1 and not a.no_put_back:
        return put_back(a, lid, lcommit)
    if not now:
        say(f"::error::production may be wrong: the switch could not be confirmed and the public check "
            f"exited {rc}. Cloudflare > Workers & Pages > {a.project} > Deployments.")
        return 6
    if not a.no_put_back:
        save(a.state_file, phase="unverified", target=tid)
    why = "could not be reached" if rc == 2 else "does not serve it yet"
    say(f"::error::production points at {tid}, but the public address {why}; NOT putting back "
        f"({'unreachable is not evidence' if rc == 2 else 'the original is the deployment being removed'}). "
        "Check the site by hand.")
    return 4


if __name__ == "__main__":
    sys.exit(main())

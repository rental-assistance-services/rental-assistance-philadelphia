#!/usr/bin/env python3
"""deploy/pages_rollback.py — make an earlier production deployment live again.

Cloudflare Pages keeps every deployment; a rollback just points production at an
older one (seconds, no rebuild). Usage:

  pages_rollback.py --project P --before-commit SHA   the successful production
                                                      deployment before the newest
                                                      one built from SHA
  pages_rollback.py --project P --previous            the one before what is live now
  pages_rollback.py --project P --to DEPLOYMENT_ID    that exact deployment
  add --dry-run to print the choice without changing anything

Prints "target=<id> commit=<sha>" and, unless --dry-run, performs the rollback.
Exit 0 done (or dry run), 1 refused or failed, 2 nothing suitable to roll back to.
Needs CLOUDFLARE_API_TOKEN (Account > Cloudflare Pages > Edit) and
CLOUDFLARE_ACCOUNT_ID. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def api(method: str, path: str) -> dict:
    acc = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{acc}/pages/projects/{path}",
        method=method,
        headers={"Authorization": f"Bearer {os.environ['CLOUDFLARE_API_TOKEN']}",
                 "User-Agent": "pages-rollback"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return json.load(e)
        except Exception:  # noqa: BLE001
            return {"success": False, "errors": [{"message": f"HTTP {e.code}"}]}


def commit_of(d: dict) -> str:
    return ((d.get("deployment_trigger") or {}).get("metadata") or {}).get("commit_hash") or ""


def ok(d: dict) -> bool:
    return (d.get("latest_stage") or {}).get("status") == "success"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--before-commit")
    g.add_argument("--previous", action="store_true")
    g.add_argument("--to")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    proj = api("GET", a.project)
    if not proj.get("success"):
        print(f"::error::cannot read project {a.project}: {proj.get('errors')}")
        return 1
    live = ((proj.get("result") or {}).get("canonical_deployment") or {}).get("id", "")
    listing = api("GET", f"{a.project}/deployments?env=production&per_page=25")
    deps = [d for d in (listing.get("result") or []) if d.get("environment") == "production"]

    target = None
    if a.to:
        target = next((d for d in deps if d.get("id") == a.to), None)
        if target is None:
            print(f"::error::{a.to} is not one of the last {len(deps)} production deployments")
            return 1
    else:
        if a.before_commit:
            idx = next((i for i, d in enumerate(deps) if commit_of(d) == a.before_commit), None)
        else:
            idx = next((i for i, d in enumerate(deps) if d.get("id") == live), None)
        if idx is not None:
            target = next((d for d in deps[idx + 1:] if ok(d)), None)
    if target is None:
        print("::warning::no earlier successful production deployment to roll back to")
        return 2
    if target.get("id") == live:
        print(f"target={target['id']} commit={commit_of(target)} (already live, nothing to do)")
        return 0

    print(f"target={target['id']} commit={commit_of(target)} live_before={live}")
    if a.dry_run:
        return 0
    res = api("POST", f"{a.project}/deployments/{target['id']}/rollback")
    if not res.get("success"):
        print(f"::error::Cloudflare refused the rollback: {res.get('errors')}")
        return 1
    print("rolled back")
    return 0


if __name__ == "__main__":
    sys.exit(main())

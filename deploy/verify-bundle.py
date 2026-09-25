#!/usr/bin/env python3
"""deploy/verify-bundle.py — refuse a bad bundle before Cloudflare publishes it.

Usage: python3 deploy/verify-bundle.py dist

Fails (exit 1) if:
  - the homepage, the 404 page or /build.json is missing;
  - anything a visitor should never be able to fetch is in the bundle
    (dev folders, READMEs, package files, configs, specs, dotfiles);
  - a page is missing this build's stamp;
  - a page links to a local file that is not in the bundle (a forgotten asset
    would otherwise ship as a broken page).
Standard library only.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys
from urllib.parse import unquote, urlsplit

FORBIDDEN_DIRS = {".git", ".github", ".claude", ".cursor", "node_modules", "tests",
                  "test", "deploy", "playwright-report", "test-results", "docs"}
FORBIDDEN_NAMES = {"README.md", "AGENTS.md", "CLAUDE.md", "package.json",
                   "package-lock.json", "playwright.config.js", "CNAME", ".nojekyll",
                   ".gitignore", "wrangler.toml", "config.env"}
FORBIDDEN_SUFFIXES = {".md", ".yml", ".yaml", ".sh", ".py", ".env", ".map", ".toml",
                      ".lock", ".log", ".ts", ".tsx", ".mjs"}
UNSTAMPED = re.compile(r"^google[0-9a-f]+\.html$")
REF = re.compile(r"""\b(?:href|src)\s*=\s*["']([^"']+)["']""", re.IGNORECASE)


def resolves(dist: pathlib.Path, page: pathlib.Path, ref: str) -> bool:
    parts = urlsplit(ref)
    if parts.scheme or parts.netloc or not parts.path:
        return True  # external, mailto:, tel:, data:, or a pure #fragment / ?query
    path = unquote(parts.path)
    base = dist if path.startswith("/") else page.parent
    target = (base / path.lstrip("/")).resolve()
    try:
        target.relative_to(dist.resolve())
    except ValueError:
        return False  # climbs out of the bundle
    if path.endswith("/"):
        return (target / "index.html").is_file()
    return (target.is_file() or (target / "index.html").is_file()
            or target.with_name(target.name + ".html").is_file())


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: verify-bundle.py <dist>")
        return 2
    dist = pathlib.Path(sys.argv[1])
    problems: list[str] = []

    for must in ("index.html", "404.html", "build.json"):
        if not (dist / must).is_file():
            problems.append(f"missing {must}")
    try:
        build = json.loads((dist / "build.json").read_text(encoding="utf-8"))
        short = build["short"]
    except Exception as e:  # noqa: BLE001 - any failure here is a bad bundle
        print(f"::error::build.json is unreadable: {e}")
        return 1
    stamp = f'<meta name="ras-build" content="{short}">'

    pages = 0
    for f in sorted(p for p in dist.rglob("*") if p.is_file()):
        rel = f.relative_to(dist)
        if (rel.parts[0] in FORBIDDEN_DIRS or rel.name in FORBIDDEN_NAMES
                or (f.suffix.lower() in FORBIDDEN_SUFFIXES)
                or (f.name.startswith(".") and f.name != ".well-known")
                or f.name.endswith((".spec.js", ".test.js", ".config.js"))
                or (f.suffix.lower() == ".json" and str(rel) != "build.json")):
            problems.append(f"{rel} must never be published")
            continue
        if f.suffix.lower() != ".html" or UNSTAMPED.match(f.name):
            continue
        pages += 1
        html = f.read_text(encoding="utf-8")
        if stamp not in html:
            problems.append(f"{rel} is missing this build's stamp ({short})")
        for ref in REF.findall(html):
            if not resolves(dist, f, ref.strip()):
                problems.append(f"{rel} links to {ref}, which is not in the bundle")

    for p in problems:
        print(f"::error::{p}")
    if problems:
        print(f"verify-bundle: FAILED with {len(problems)} problem(s)")
        return 1
    print(f"verify-bundle: ok ({pages} pages stamped {short}, every local link resolves, no dev files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

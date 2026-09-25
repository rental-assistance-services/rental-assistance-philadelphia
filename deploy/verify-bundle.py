#!/usr/bin/env python3
"""deploy/verify-bundle.py — refuse a bad bundle before Cloudflare publishes it.

Usage: python3 deploy/verify-bundle.py dist

deploy/build.sh runs this as its last step, so it runs inside Cloudflare's own
build: a bad bundle fails that build and the previous deployment stays live.

Fails (exit 1) if:
  - the homepage, the 404 page or /build.json is missing;
  - anything a visitor should never be able to fetch is in the bundle
    (dev folders, READMEs, package files, configs, specs, dotfiles);
  - a page is missing this build's stamp;
  - a page (href, src, srcset) or a stylesheet (url()) points at a file of this
    site that is not in the bundle, including absolute links to the site's own
    domain. A forgotten asset would otherwise ship as a broken page.
Standard library only.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys
from urllib.parse import unquote, urlsplit

OWN_HOSTS = {"rentalassistanceservices.com", "www.rentalassistanceservices.com"}
FORBIDDEN_DIRS = {".git", ".github", ".claude", ".cursor", "node_modules", "tests",
                  "test", "deploy", "playwright-report", "test-results", "docs"}
FORBIDDEN_NAMES = {"README.md", "AGENTS.md", "CLAUDE.md", "package.json",
                   "package-lock.json", "playwright.config.js", "CNAME", ".nojekyll",
                   ".gitignore", "wrangler.toml", "config.env"}
FORBIDDEN_SUFFIXES = {".md", ".yml", ".yaml", ".sh", ".py", ".env", ".map", ".toml",
                      ".lock", ".log", ".ts", ".tsx", ".mjs"}
UNSTAMPED = re.compile(r"^google[0-9a-f]+\.html$")
ATTR = re.compile(r"""\b(?:href|src)\s*=\s*["']([^"']+)["']""", re.IGNORECASE)
SRCSET = re.compile(r"""\bsrcset\s*=\s*["']([^"']+)["']""", re.IGNORECASE)
CSS_URL = re.compile(r"""url\(\s*['"]?([^'")]+)['"]?\s*\)""", re.IGNORECASE)


def local_path(ref: str) -> str | None:
    """The site path a reference points at, or None when it is not this site's file."""
    # Decode first: "%23n" inside an SVG data URI is "#n", a fragment, not a file.
    parts = urlsplit(unquote(ref.strip()))
    if parts.scheme in ("http", "https"):
        if parts.netloc.lower() not in OWN_HOSTS:
            return None
        return unquote(parts.path) or "/"
    if parts.scheme or parts.netloc or not parts.path:
        return None  # mailto:, tel:, data:, javascript:, //cdn, or a pure #fragment / ?query
    return unquote(parts.path)


def resolves(dist: pathlib.Path, base: pathlib.Path, path: str) -> bool:
    target = ((dist if path.startswith("/") else base) / path.lstrip("/")).resolve()
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
        short = json.loads((dist / "build.json").read_text(encoding="utf-8"))["short"]
    except Exception as e:  # noqa: BLE001 - any failure here is a bad bundle
        print(f"::error::build.json is unreadable: {e}")
        return 1
    stamp = f'<meta name="ras-build" content="{short}">'

    pages = 0
    for f in sorted(p for p in dist.rglob("*") if p.is_file()):
        rel = f.relative_to(dist)
        in_well_known = rel.parts[0] == ".well-known"
        if (rel.parts[0] in FORBIDDEN_DIRS or rel.name in FORBIDDEN_NAMES
                or (f.suffix.lower() in FORBIDDEN_SUFFIXES and not in_well_known)
                or (any(p.startswith(".") for p in rel.parts) and not in_well_known)
                or f.name.endswith((".spec.js", ".test.js", ".config.js"))
                or (f.suffix.lower() == ".json" and str(rel) != "build.json" and not in_well_known)):
            problems.append(f"{rel} must never be published")
            continue
        suffix = f.suffix.lower()
        if suffix == ".css":
            for ref in CSS_URL.findall(f.read_text(encoding="utf-8", errors="replace")):
                path = local_path(ref)
                if path is not None and not resolves(dist, f.parent, path):
                    problems.append(f"{rel} uses url({ref}), which is not in the bundle")
            continue
        if suffix != ".html" or UNSTAMPED.match(f.name):
            continue
        pages += 1
        html = f.read_text(encoding="utf-8")
        if stamp not in html:
            problems.append(f"{rel} is missing this build's stamp ({short})")
        refs = ATTR.findall(html)
        for srcset in SRCSET.findall(html):
            refs += [c.strip().split()[0] for c in srcset.split(",") if c.strip()]
        for ref in refs:
            path = local_path(ref)
            if path is not None and not resolves(dist, f.parent, path):
                problems.append(f"{rel} links to {ref}, which is not in the bundle")

    for p in problems:
        print(f"::error::{p}")
    if problems:
        print(f"verify-bundle: FAILED with {len(problems)} problem(s)")
        return 1
    print(f"verify-bundle: ok ({pages} pages stamped {short}, every local link and stylesheet url resolves, no dev files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

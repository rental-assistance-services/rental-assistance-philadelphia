#!/usr/bin/env bash
#
# deploy/build.sh — assemble the publishable site into dist/.
#
# Cloudflare Pages runs this on every push (build command `bash deploy/build.sh`,
# output directory `dist`). It also runs in CI and by hand.
#
# Why a build step for a site that has none: GitHub Pages published the WHOLE
# repository. Measured on the live site 2026-09-25: /README.md (the internal
# notes: CRM fields, the honeypot name, the conversion rules) answered 200 as
# text/markdown, and /tests/static-server.js answered 200. This script copies
# only what a visitor's browser needs, by file type, and never the dev folders.
#
# It also:
#   - stamps every page with this build's commit (<meta name="ras-build">) and
#     writes /build.json, so anyone can tell which version is live and the
#     checks can prove a deploy actually landed;
#   - keeps unknown URLs as REAL 404s: Cloudflare Pages treats a site with no
#     404.html as a single-page app and answers every unknown URL with the
#     homepage and status 200. If the source has no 404.html, a minimal one is
#     generated here;
#   - rewrites canonical/og/sitemap/structured-data URLs to CANONICAL_ORIGIN
#     when it differs from the source's bare-domain origin;
#   - marks every non-production branch build noindex (_headers).
#
# Usage: bash deploy/build.sh      (needs bash and python3, nothing to install)
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUT="$ROOT/dist"

# shellcheck disable=SC1091
. "$HERE/config.env"
# Lets deploy/selftest.sh build with another origin without editing the committed
# setting. Cloudflare and CI never set it.
CANONICAL_ORIGIN="${CANONICAL_ORIGIN_OVERRIDE:-${CANONICAL_ORIGIN:-}}"

COMMIT="${CF_PAGES_COMMIT_SHA:-${GITHUB_SHA:-${BUILD_COMMIT:-}}}"
if ! printf '%s' "$COMMIT" | grep -qE '^[0-9a-f]{40}$'; then
  echo "::error::no 40-character commit (CF_PAGES_COMMIT_SHA, GITHUB_SHA or BUILD_COMMIT): refusing to build an unidentifiable site"
  exit 1
fi
BRANCH="${CF_PAGES_BRANCH:-${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-local}}}"
# A typo here would ship broken canonical links on every page while every check stays
# green (the check compares against this same value), so only the two real origins pass.
case "${CANONICAL_ORIGIN%/}" in
  https://rentalassistanceservices.com|https://www.rentalassistanceservices.com) ;;
  *) echo "::error::CANONICAL_ORIGIN '${CANONICAL_ORIGIN}' is not https://rentalassistanceservices.com or https://www.rentalassistanceservices.com"; exit 1 ;;
esac
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

python3 - "$ROOT" "$OUT" "$COMMIT" "$BRANCH" "$BUILT_AT" "${PRODUCTION_BRANCH:-main}" \
        "${CANONICAL_ORIGIN:-https://rentalassistanceservices.com}" <<'PY'
import json, pathlib, re, shutil, sys

root, out, commit, branch, built_at, prod_branch, canonical = sys.argv[1:8]
root, out = pathlib.Path(root), pathlib.Path(out)
short = commit[:7]
SOURCE_ORIGIN = "https://rentalassistanceservices.com"

# What a browser may fetch, by type. Everything else stays out.
SITE_TYPES = {".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".svg",
              ".webp", ".avif", ".ico", ".woff", ".woff2", ".txt", ".xml",
              ".webmanifest", ".pdf", ".mp4", ".webm"}
# Never published, whatever their type.
DEV_DIRS = {".git", ".github", ".claude", ".cursor", "node_modules", "tests",
            "test", "deploy", "dist", "playwright-report", "test-results", "docs"}
DEV_FILES = {"playwright.config.js", "package.json", "package-lock.json",
             "CNAME", ".nojekyll", ".gitignore", "README.md", "AGENTS.md",
             "CLAUDE.md", "wrangler.toml"}
# Plain-text verification files: served byte for byte, never stamped.
UNSTAMPED = re.compile(r"^google[0-9a-f]+\.html$")

if out.exists():
    shutil.rmtree(out)
out.mkdir(parents=True)

copied, skipped = [], []
for path in sorted(root.rglob("*")):
    rel = path.relative_to(root)
    if not path.is_file() or rel.parts[0] in DEV_DIRS:
        continue
    if any(p.startswith(".") for p in rel.parts) and rel.parts[0] != ".well-known":
        continue
    if rel.name in DEV_FILES or rel.name.endswith((".spec.js", ".test.js", ".config.js")):
        continue
    if rel.suffix.lower() not in SITE_TYPES and rel.parts[0] != ".well-known":
        skipped.append(str(rel))
        continue
    dest = out / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, dest)
    copied.append(str(rel))

if "index.html" not in copied:
    print("::error::no index.html at the repository root: refusing to build a site with no homepage")
    sys.exit(1)

# A real 404 page, so unknown URLs keep answering 404 (see the header).
generated_404 = False
if not (out / "404.html").exists():
    (out / "404.html").write_text(
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<meta name="robots" content="noindex">\n'
        '<title>Page not found | Rental Assistance Services</title>\n'
        '<link rel="stylesheet" href="/site.css">\n</head>\n<body>\n'
        '<main style="max-width:40rem;margin:4rem auto;padding:0 1.25rem;">\n'
        '<h1>Page not found</h1>\n'
        '<p>The page you asked for is not here. It may have moved.</p>\n'
        '<p><a href="/">Go to the home page</a></p>\n'
        '</main>\n</body>\n</html>\n', encoding="utf-8")
    generated_404 = True

rewrite = canonical.rstrip("/") != SOURCE_ORIGIN
origin_re = re.compile(re.escape(SOURCE_ORIGIN) + r"(?=[/\"'\s<)?#]|$)")
close_head = re.compile(r"</head\s*>", re.IGNORECASE)
meta = (f'<meta name="ras-build" content="{short}">\n'
        f'<meta name="ras-build-commit" content="{commit}">\n'
        f'<meta name="ras-build-time" content="{built_at}">\n')

stamped, rewritten = [], []
for page in sorted(out.rglob("*")):
    if not page.is_file() or page.suffix.lower() not in {".html", ".xml", ".txt"}:
        continue
    rel = str(page.relative_to(out))
    if UNSTAMPED.match(page.name):
        continue
    text = page.read_text(encoding="utf-8")
    if rewrite:
        new = origin_re.sub(canonical.rstrip("/"), text)
        if new != text:
            rewritten.append(rel)
            text = new
    if page.suffix.lower() == ".html":
        m = close_head.search(text)
        if not m:
            print(f"::error::{rel} has no </head>: every page must carry the build stamp")
            sys.exit(1)
        text = text[:m.start()] + meta + text[m.start():]
        stamped.append(rel)
    page.write_text(text, encoding="utf-8")

# Cloudflare Pages reads _headers from the bundle. Previews must never be indexed.
headers = []
if branch != prod_branch:
    headers += ["# this build is a preview (branch %s): never index it" % branch,
                "/*", "  X-Robots-Tag: noindex, nofollow"]
if headers:
    (out / "_headers").write_text("\n".join(headers) + "\n", encoding="utf-8")

(out / "build.json").write_text(json.dumps({
    "commit": commit, "short": short, "built_at": built_at, "branch": branch,
    "repo": "rental-assistance-services/rental-assistance-philadelphia",
    "canonical_origin": canonical.rstrip("/"),
    "pages": stamped,
}, indent=2) + "\n", encoding="utf-8")

print(f"copied {len(copied)} file(s); stamped {len(stamped)} page(s) with {short} (branch {branch})")
if skipped:
    print(f"::warning::left out {len(skipped)} file(s) of a type the site does not publish: " + ", ".join(skipped[:20]))
if generated_404:
    print("the source has no 404.html: generated a minimal one so unknown URLs stay real 404s")
if rewrite:
    print(f"rewrote {SOURCE_ORIGIN} -> {canonical.rstrip('/')} in {len(rewritten)} file(s)")
if branch != prod_branch:
    print("preview build: _headers marks every URL noindex")
PY

python3 "$HERE/verify-bundle.py" "$OUT"

echo
echo "=== dist/: exactly what Cloudflare Pages publishes ==="
( cd "$OUT" && find . -type f | sed 's|^\./||' | sort | while read -r p; do
    printf '  %8s  %s\n' "$(wc -c < "$p" | tr -d ' ')" "$p"
  done )

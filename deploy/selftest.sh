#!/usr/bin/env bash
#
# deploy/selftest.sh — prove the build guards actually fire.
#
# Each case breaks one thing in a scratch copy of the site and asserts the
# build or the verifier refuses it (or, for the good cases, accepts it). A
# guard that has never been seen failing is a comment, not a check.
#
# Runs in CI (site-checks.yml) and by hand: bash deploy/selftest.sh
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SHA=0123456789abcdef0123456789abcdef01234567
PASS=0
FAIL=0

scratch() { # a fresh copy of the site without its history or old builds
  local d
  d="$(mktemp -d)"
  (cd "$ROOT" && tar cf - --exclude=.git --exclude=dist --exclude=node_modules .) | (cd "$d" && tar xf -)
  echo "$d"
}
# CI and Cloudflare set these; a scratch build must decide from its own arguments only.
CLEAN_ENV=(env -u CF_PAGES_COMMIT_SHA -u CF_PAGES_BRANCH -u GITHUB_SHA -u GITHUB_HEAD_REF -u GITHUB_REF_NAME -u CANONICAL_ORIGIN_OVERRIDE)
build()  { (cd "$1" && "${CLEAN_ENV[@]}" CF_PAGES_BRANCH="${2:-main}" BUILD_COMMIT="${3:-$SHA}" bash deploy/build.sh >/dev/null 2>&1); }
verify() { python3 "$1/deploy/verify-bundle.py" "$1/dist" >/dev/null 2>&1; }
ok()     { echo "  ok    $1"; PASS=$((PASS + 1)); }
bad()    { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }
expect_refused() { if "${@:2}"; then bad "$1 — the guard did NOT fire"; else ok "$1 — refused"; fi; }
expect_ok()      { if "${@:2}"; then ok "$1"; else bad "$1 — a good case was rejected"; fi; }

echo "build + verify guards:"

d=$(scratch); expect_ok "a real build of this repo succeeds" build "$d"
expect_ok "and that real bundle passes verification" verify "$d"
expect_refused "README.md is never in the bundle" test -e "$d/dist/README.md"
expect_refused "tests/ is never in the bundle" test -e "$d/dist/tests"
expect_refused "package.json is never in the bundle" test -e "$d/dist/package.json"
expect_refused "CNAME is never in the bundle" test -e "$d/dist/CNAME"
expect_ok "a real 404 page is in the bundle" test -s "$d/dist/404.html"
expect_refused "a production build has no noindex _headers" test -e "$d/dist/_headers"
g=$(find "$d" -maxdepth 1 -name 'google*.html' | head -n1)
if [ -n "$g" ]; then
  expect_ok "the Google verification file is byte-identical" cmp -s "$g" "$d/dist/$(basename "$g")"
fi
rm -rf "$d"

d=$(scratch); build "$d"; echo "# internal" > "$d/dist/NOTES.md"
expect_refused "a markdown file slipped into the bundle" verify "$d"; rm -rf "$d"

d=$(scratch); build "$d"; mkdir -p "$d/dist/tests"; echo x > "$d/dist/tests/a.spec.js"
expect_refused "a test file slipped into the bundle" verify "$d"; rm -rf "$d"

d=$(scratch); build "$d"; echo '{}' > "$d/dist/data.json"
expect_refused "a stray json file in the bundle" verify "$d"; rm -rf "$d"

d=$(scratch); build "$d"; sed -i.bak 's#</body>#<img src="/missing-hero.png"></body>#' "$d/dist/index.html"; rm -f "$d/dist/index.html.bak"
expect_refused "a page pointing at an asset that is not there" verify "$d"; rm -rf "$d"

d=$(scratch); build "$d"; sed -i.bak 's#<meta name="ras-build" content="[0-9a-f]*">##' "$d/dist/faq/index.html"; rm -f "$d/dist/faq/index.html.bak"
expect_refused "an unstamped page" verify "$d"; rm -rf "$d"

d=$(scratch); rm -f "$d/dist/build.json" 2>/dev/null; build "$d"; rm -f "$d/dist/build.json"
expect_refused "a bundle without build.json" verify "$d"; rm -rf "$d"

d=$(scratch)
expect_refused "a build with no commit id" build "$d" main "not-a-commit"; rm -rf "$d"

d=$(scratch); printf '<html><body>no head here</body></html>\n' > "$d/nohead.html"
expect_refused "a page with no </head> (it could not be stamped)" build "$d"; rm -rf "$d"

d=$(scratch); build "$d" some-feature-branch
expect_ok "a preview build marks every URL noindex" grep -q 'X-Robots-Tag: noindex' "$d/dist/_headers"; rm -rf "$d"

d=$(scratch)
expect_refused "a canonical origin that is not one of the two real ones" \
  sh -c "cd '$d' && env -u CF_PAGES_COMMIT_SHA -u GITHUB_SHA CANONICAL_ORIGIN_OVERRIDE=https://rentalassistanceservices.co CF_PAGES_BRANCH=main BUILD_COMMIT=$SHA bash deploy/build.sh >/dev/null 2>&1"
rm -rf "$d"

d=$(scratch); build "$d"; printf '\nbody{background:url(/missing-texture.png)}\n' >> "$d/dist/site.css"
expect_refused "a stylesheet pointing at a file that is not there" verify "$d"; rm -rf "$d"

d=$(scratch); mkdir -p "$d/.well-known"; echo "Contact: mailto:info@rentalassistanceservices.com" > "$d/.well-known/security.txt"
build "$d"
expect_ok ".well-known/security.txt is published" test -s "$d/dist/.well-known/security.txt"
expect_ok "and the bundle with it passes verification" verify "$d"; rm -rf "$d"

d=$(scratch); build "$d"; mkdir -p "$d/dist/.well-known"; printf 'x\n' > "$d/dist/.well-known/run.sh"
expect_refused "a script under .well-known/ in the bundle" verify "$d"; rm -rf "$d"

d=$(scratch); build "$d"; mkdir -p "$d/dist/.well-known"; printf 'x\n' > "$d/dist/.well-known/.env"
expect_refused "a dotfile under .well-known/ in the bundle" verify "$d"; rm -rf "$d"

d=$(scratch); build "$d"; printf 'x' > "$d/dist/photo#1.png"
sed -i.bak 's#</body>#<img src="/photo%231.png"></body>#' "$d/dist/index.html"; rm -f "$d/dist/index.html.bak"
expect_ok "a real file whose name holds a # (linked as %23) is found" verify "$d"; rm -rf "$d"

d=$(scratch); sed -i.bak -e 's/^CHECKS=.*/CHECKS=on/' -e 's/^VERIFIED_SINCE=.*/VERIFIED_SINCE=/' "$d/deploy/config.env"; rm -f "$d/deploy/config.env.bak"
expect_refused "CHECKS=on without a VERIFIED_SINCE commit" bash "$d/deploy/config-check.sh"; rm -rf "$d"

d=$(scratch)
# shellcheck disable=SC2016 # the literal text is the point: config-check must refuse it
printf 'CHECKS=$(true)\n' >> "$d/deploy/config.env"
expect_refused "a config.env line that would run a command" bash "$d/deploy/config-check.sh"; rm -rf "$d"

d=$(scratch); printf 'APPROVERS=kyle192003\n' >> "$d/deploy/config.env"
expect_refused "a config.env line setting something other than a known setting" bash "$d/deploy/config-check.sh"; rm -rf "$d"

d=$(scratch); printf 'PATH=deploy:/usr/bin:/bin\n' >> "$d/deploy/config.env"
expect_refused "a config.env line changing PATH" bash "$d/deploy/config-check.sh"; rm -rf "$d"

d=$(scratch); sed -i.bak 's#^PAGES_URL=.*#PAGES_URL=https://rental-assistance-services.pages.dev#' "$d/deploy/config.env"; rm -f "$d/deploy/config.env.bak"
expect_refused "a PAGES_URL without its trailing slash" bash "$d/deploy/config-check.sh"; rm -rf "$d"

d=$(scratch); sed -i.bak 's#^PAGES_URL=.*#PAGES_URL=https://look-alike.pages.dev/#' "$d/deploy/config.env"; rm -f "$d/deploy/config.env.bak"
expect_refused "a PAGES_URL pointing at another Pages project" bash "$d/deploy/config-check.sh"; rm -rf "$d"

d=$(scratch); sed -i.bak 's#^PAGES_URL=.*#PAGES_URL=https://rental-assistance-services-evil.pages.dev/#' "$d/deploy/config.env"; rm -f "$d/deploy/config.env.bak"
expect_refused "a PAGES_URL for a same-named project in someone else's account" bash "$d/deploy/config-check.sh"; rm -rf "$d"

d=$(scratch); sed -i.bak 's#^PUBLIC_URL=.*#PUBLIC_URL=https://x.example/#' "$d/deploy/config.env"; rm -f "$d/deploy/config.env.bak"
expect_refused "a PUBLIC_URL that is not this site" bash "$d/deploy/config-check.sh"; rm -rf "$d"

d=$(scratch); printf 'APPROVERS=kyle192003\n' >> "$d/deploy/config.env"
expect_refused "a build with an unknown setting in config.env" build "$d"; rm -rf "$d"

d=$(scratch)
(cd "$d" && "${CLEAN_ENV[@]}" CANONICAL_ORIGIN_OVERRIDE=https://www.rentalassistanceservices.com CF_PAGES_BRANCH=main BUILD_COMMIT=$SHA bash deploy/build.sh >/dev/null 2>&1)
expect_refused "no bare-domain URL left after the www rewrite" grep -rqE 'https://rentalassistanceservices\.com([/"<]|$)' "$d/dist" --include='*.html' --include='*.xml' --include='*.txt'
expect_ok "email addresses are not rewritten" grep -rq 'info@rentalassistanceservices.com' "$d/dist" --include='*.html'
rm -rf "$d"

echo
echo "selftest: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]

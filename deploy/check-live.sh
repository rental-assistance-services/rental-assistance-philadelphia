#!/usr/bin/env bash
#
# deploy/check-live.sh — ask the real public URL whether the site is what we
# think it is. Read-only; safe to run at any time, from anywhere.
#
#   deploy/check-live.sh                          # full check of PUBLIC_URL (else PAGES_URL)
#   deploy/check-live.sh --url https://x.pages.dev/ --release --expect-commit <sha>
#
# Every request uses HTTPS with FULL certificate verification: no -k, no --resolve.
#
# Two kinds of check, because only one kind is evidence against a deployment:
#
#   release  what the deployment's files decide: the homepage answers 200, it
#            is THIS build (the ras-build stamp and /build.json), the key pages
#            exist, an unknown URL is a real 404, no dev file is served, and a
#            production URL is not marked noindex. A failure here may roll back.
#   site     what DNS and forwarding decide: the bare domain forwards to www
#            with the page path and the query string (the Google Ads ?gclid)
#            intact, and the canonical link names the public origin. A failure
#            here alerts; it never rolls a deployment back.
#
# Exit codes: 0 good · 1 definitely wrong · 2 could not reach the site (no verdict).
# A caller must never roll back on the strength of exit code 2.
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$HERE/config.env"

URL="${PUBLIC_URL:-${PAGES_URL}}"
MODE=full
EXPECT_COMMIT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --url)           URL="${2:-}"; shift 2 ;;
    --release)       MODE=release; shift ;;
    --expect-commit) EXPECT_COMMIT="${2:-}"; shift 2 ;;
    -h|--help)       sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
URL="${URL%/}/"
CB="chk-$(date -u +%s)-$$"
FAILURES=0
fail() { echo "::error::$*"; FAILURES=$((FAILURES + 1)); }
ok()   { echo "  ok  $*"; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch() { # fetch <path> <name> -> status; body $TMP/<name>, headers $TMP/<name>.h
  local code sep='?'
  case "$1" in *\?*) sep='&' ;; esac
  code=$(curl -sS --proto '=https' -m 25 --retry 4 --retry-delay 3 \
           -H 'Cache-Control: no-cache' -D "$TMP/$2.h" -o "$TMP/$2" -w '%{http_code}' \
           "${URL}${1}${sep}cb=${CB}" 2>/dev/null) || code=000
  echo "${code:-000}"
}
json_field() { python3 -c 'import json,sys
try: v = json.load(open(sys.argv[1])).get(sys.argv[2])
except Exception: v = None
print("" if v is None else v)' "$1" "$2"; }

echo "checking ${URL} (${MODE})"

# ---------------------------------------------------------------- release ---
CODE="$(fetch "" root)"
if [ "$CODE" = "000" ]; then
  echo "::warning::${URL} could not be reached at all (DNS, TLS or timeout). No verdict."
  echo "check-live: INCONCLUSIVE (the site could not be reached)"
  exit 2
fi
if [ "$CODE" = "200" ]; then ok "homepage answers 200 over verified TLS"; else fail "the homepage answered HTTP ${CODE}, not 200"; fi

BCODE="$(fetch "build.json" build)"
LIVE_COMMIT=""
if [ "$BCODE" = "200" ] && python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$TMP/build" 2>/dev/null; then
  LIVE_COMMIT="$(json_field "$TMP/build" commit)"
  ok "live build: $(json_field "$TMP/build" short) built $(json_field "$TMP/build" built_at) from $(json_field "$TMP/build" branch)"
elif [ -n "$EXPECT_COMMIT" ]; then
  fail "/build.json did not come back as JSON (HTTP ${BCODE})"
else
  echo "  --  no /build.json (GitHub Pages, or a deployment older than this build script)"
fi
if [ -n "$EXPECT_COMMIT" ]; then
  short="${EXPECT_COMMIT:0:7}"
  if grep -qF "<meta name=\"ras-build\" content=\"${short}\">" "$TMP/root"; then
    ok "homepage carries this build's stamp (${short})"
  else
    fail "the homepage does not carry this build's stamp (${short}); a 200 alone does not prove it landed"
  fi
  if [ -n "$LIVE_COMMIT" ] && [ "$LIVE_COMMIT" != "$EXPECT_COMMIT" ]; then
    fail "/build.json says the live commit is ${LIVE_COMMIT}, expected ${EXPECT_COMMIT}"
  fi
fi

for page in back-rent/ services/back-rent/ services/licensing/ faq/ tenants/; do
  c="$(fetch "$page" page)"
  if [ "$c" = "200" ]; then ok "/${page} answers 200"; else fail "/${page} answered HTTP ${c}, not 200"; fi
done

c="$(fetch "w6-this-page-does-not-exist-${CB}" notfound)"
if [ "$c" = "404" ]; then ok "an unknown URL is a real 404"; else fail "an unknown URL answered HTTP ${c}, not 404 (a soft 404 hurts search)"; fi

leaked=0
for p in README.md AGENTS.md CLAUDE.md package.json playwright.config.js tests/static-server.js \
         tests/pages.spec.js deploy/build.sh deploy/config.env .github/workflows/tests.yml CNAME .gitignore; do
  c="$(fetch "$p" leak)"
  case "$c" in
    404|403) : ;;
    000) echo "::warning::could not reach /${p} to check it is not served" ;;
    *) fail "/${p} answered HTTP ${c}; dev files must never be served"; leaked=$((leaked + 1)) ;;
  esac
done
[ "$leaked" = "0" ] && ok "no dev file is served"

if tr -d '\r' < "$TMP/root.h" | grep -qi '^x-robots-tag:.*noindex'; then
  case "$URL" in
    https://*.*.pages.dev/) ok "a branch preview is marked noindex, as it should be" ;;
    *) fail "the production homepage is marked noindex (X-Robots-Tag): search engines would drop the site" ;;
  esac
else
  ok "the homepage is indexable"
fi

if [ "$MODE" = "release" ]; then
  echo
  if [ "$FAILURES" -gt 0 ]; then echo "check-live FAILED (release) with ${FAILURES} problem(s)"; exit 1; fi
  echo "check-live: release checks passed"
  exit 0
fi

# ------------------------------------------------------------------- site ---
if [ "$URL" = "https://www.rentalassistanceservices.com/" ]; then
  r=$(curl -sS --proto '=https' -m 25 --retry 3 -o /dev/null -w '%{http_code} %{redirect_url}' \
        "https://rentalassistanceservices.com/back-rent/?gclid=w6check&cb=${CB}" 2>/dev/null || echo "000")
  case "$r" in
    "301 https://www.rentalassistanceservices.com/back-rent/?gclid=w6check&cb=${CB}"|"308 https://www.rentalassistanceservices.com/back-rent/?gclid=w6check&cb=${CB}")
      ok "the bare domain forwards to www with the path and ?gclid intact" ;;
    000*) fail "https://rentalassistanceservices.com could not be reached (DNS, TLS or timeout): the bare domain is broken" ;;
    *) fail "the bare domain answered '${r}'; expected a 301 to www keeping the path and the query string" ;;
  esac
fi

want="${CANONICAL_ORIGIN%/}/"
canon=$(grep -oiE '<link[^>]+rel="canonical"[^>]*>' "$TMP/root" | grep -oE 'href="[^"]+"' | head -n1 | sed 's/^href="//; s/"$//')
if [ "$canon" = "$want" ]; then ok "the homepage's canonical link is ${want}"; else fail "the homepage's canonical link is '${canon}', expected '${want}'"; fi

echo
if [ "$FAILURES" -gt 0 ]; then echo "check-live FAILED with ${FAILURES} problem(s)"; exit 1; fi
echo "check-live: passed"

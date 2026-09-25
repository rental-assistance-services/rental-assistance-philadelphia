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
#   site     what DNS and forwarding decide: once BARE_DOMAIN_FORWARDED=yes, the
#            bare domain forwards to www with the page path and the query string
#            (the Google Ads ?gclid) intact; and the canonical link names the
#            public origin. A failure here alerts; it never rolls anything back.
#
# "Could not tell" is its own answer: no answer at all, or a 5xx, is
# inconclusive, never evidence against a deployment. The run also stops at a
# deadline (CHECK_DEADLINE seconds, default 180) instead of hanging a job.
#
# Exit codes: 0 good · 1 definitely wrong · 2 inconclusive (no verdict).
# A caller must never roll back on the strength of exit code 2.
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Only the eight known settings, each with a valid value (deploy/config-check.sh).
if ! bash "$HERE/config-check.sh" >&2; then
  echo "check-live: deploy/config.env failed its check; no verdict" >&2
  exit 2
fi
# shellcheck disable=SC1091
. "$HERE/config.env"

URL="${PUBLIC_URL:-${PAGES_URL}}"
MODE=full
EXPECT_COMMIT=""
DEADLINE=$(( $(date +%s) + ${CHECK_DEADLINE:-180} ))
need() { [ $# -ge 2 ] && [ -n "$2" ] || { echo "check-live: $1 needs a value" >&2; exit 2; }; }
while [ $# -gt 0 ]; do
  case "$1" in
    --url)           need "$@"; URL="$2"; shift 2 ;;
    --release)       MODE=release; shift ;;
    --expect-commit) need "$@"; EXPECT_COMMIT="$2"; shift 2 ;;
    -h|--help)       sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
URL="${URL%/}/"
CB="chk-$(date -u +%s)-$$"
FAILURES=0
INCONCLUSIVE=0
fail()  { echo "::error::$*"; FAILURES=$((FAILURES + 1)); }
unsure(){ echo "::warning::$*"; INCONCLUSIVE=$((INCONCLUSIVE + 1)); }
ok()    { echo "  ok  $*"; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

finish() {
  echo
  if [ "$FAILURES" -gt 0 ]; then echo "check-live FAILED ($MODE) with ${FAILURES} problem(s)"; exit 1; fi
  if [ "$INCONCLUSIVE" -gt 0 ]; then echo "check-live: INCONCLUSIVE ($MODE): ${INCONCLUSIVE} check(s) could not get an answer"; exit 2; fi
  echo "check-live: ${MODE} checks passed"; exit 0
}
past_deadline() { [ "$(date +%s)" -lt "$DEADLINE" ] || { unsure "stopped at the ${CHECK_DEADLINE:-180}s deadline"; finish; }; }
fetch() { # fetch <path> <name> -> status; body $TMP/<name>, headers $TMP/<name>.h
  local code sep='?'
  case "$1" in *\?*) sep='&' ;; esac
  code=$(curl -sS --proto '=https' -m 15 --retry 2 --retry-delay 2 \
           -H 'Cache-Control: no-cache' -D "$TMP/$2.h" -o "$TMP/$2" -w '%{http_code}' \
           "${URL}${1}${sep}cb=${CB}" 2>/dev/null) || code=000
  echo "${code:-000}"
}
# get runs in the main shell, so the deadline can end the whole run.
get() { past_deadline; R="$(fetch "$1" "$2")"; }
no_answer() { case "$1" in 000|5??) return 0 ;; *) return 1 ;; esac; }
json_field() { python3 -c 'import json,sys
try: v = json.load(open(sys.argv[1])).get(sys.argv[2])
except Exception: v = None
print("" if v is None else v)' "$1" "$2"; }

echo "checking ${URL} (${MODE})"

# ---------------------------------------------------------------- release ---
get "" root; CODE="$R"
if no_answer "$CODE"; then
  unsure "${URL} gave no usable answer (HTTP ${CODE}: DNS, TLS, timeout or a server error). No verdict."
  finish
fi
if [ "$CODE" = "200" ]; then ok "homepage answers 200 over verified TLS"; else fail "the homepage answered HTTP ${CODE}, not 200"; fi

get "build.json" build; BCODE="$R"
LIVE_COMMIT=""
if [ "$BCODE" = "200" ] && python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$TMP/build" 2>/dev/null; then
  LIVE_COMMIT="$(json_field "$TMP/build" commit)"
  ok "live build: $(json_field "$TMP/build" short) built $(json_field "$TMP/build" built_at) from $(json_field "$TMP/build" branch)"
elif no_answer "$BCODE"; then
  unsure "/build.json gave no usable answer (HTTP ${BCODE})"
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
  get "$page" page; c="$R"
  if [ "$c" = "200" ]; then ok "/${page} answers 200"
  elif no_answer "$c"; then unsure "/${page} gave no usable answer (HTTP ${c})"
  else fail "/${page} answered HTTP ${c}, not 200"; fi
done

get "w6-this-page-does-not-exist-${CB}" notfound; c="$R"
if [ "$c" = "404" ]; then ok "an unknown URL is a real 404"
elif no_answer "$c"; then unsure "an unknown URL gave no usable answer (HTTP ${c})"
else fail "an unknown URL answered HTTP ${c}, not 404 (a soft 404 hurts search)"; fi

leaked=0
for p in README.md AGENTS.md CLAUDE.md package.json playwright.config.js tests/static-server.js \
         tests/pages.spec.js deploy/build.sh deploy/config.env .github/workflows/tests.yml CNAME .gitignore; do
  get "$p" leak; c="$R"
  case "$c" in
    404|403) : ;;
    000|5??) unsure "could not check /${p} (HTTP ${c})" ;;
    *) fail "/${p} answered HTTP ${c}; dev files must never be served"; leaked=$((leaked + 1)) ;;
  esac
done
[ "$leaked" = "0" ] && ok "no dev file is served"

if tr -d '\r' < "$TMP/root.h" | grep -qi '^x-robots-tag:.*noindex'; then
  case "$URL" in
    https://*.*.pages.dev/) ok "a branch preview or deployment address is marked noindex, as it should be" ;;
    *) fail "the production homepage is marked noindex (X-Robots-Tag): search engines would drop the site" ;;
  esac
else
  ok "the homepage is indexable"
fi

[ "$MODE" = "release" ] && finish

# ------------------------------------------------------------------- site ---
if [ "${BARE_DOMAIN_FORWARDED:-no}" = "yes" ] && [ "$URL" = "https://www.rentalassistanceservices.com/" ]; then
  past_deadline
  r=$(curl -sS --proto '=https' -m 15 --retry 2 -o /dev/null -w '%{http_code} %{redirect_url}' \
        "https://rentalassistanceservices.com/back-rent/?gclid=w6check&cb=${CB}" 2>/dev/null || echo "000")
  case "$r" in
    "301 https://www.rentalassistanceservices.com/back-rent/?gclid=w6check&cb=${CB}"|"308 https://www.rentalassistanceservices.com/back-rent/?gclid=w6check&cb=${CB}")
      ok "the bare domain forwards to www with the path and ?gclid intact" ;;
    000*|5*) unsure "https://rentalassistanceservices.com gave no usable answer (${r})" ;;
    *) fail "the bare domain answered '${r}'; expected a 301 to www keeping the path and the query string" ;;
  esac
fi

want="${CANONICAL_ORIGIN%/}/"
canon=$(grep -oiE '<link[^>]+rel="canonical"[^>]*>' "$TMP/root" | grep -oE 'href="[^"]+"' | head -n1 | sed 's/^href="//; s/"$//')
if [ "$canon" = "$want" ]; then ok "the homepage's canonical link is ${want}"; else fail "the homepage's canonical link is '${canon}', expected '${want}'"; fi

finish

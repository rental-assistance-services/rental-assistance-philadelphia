#!/usr/bin/env bash
#
# deploy/config-check.sh: is deploy/config.env safe to source, and complete?
#
# Every job and script that reads the settings runs this first. Sourcing a file
# runs whatever is in it, and this one arrives through pull requests, so only
# comments and plain assignments to the eight known settings are allowed: a line
# such as APPROVERS=..., PATH=... or GITHUB_API_URL=... would otherwise reach the
# approval gate or a Cloudflare token in the same shell. Each value is checked
# too. And with CHECKS=on the approval walk needs its starting point: without a
# full VERIFIED_SINCE no commit could ever be verified.
#
# Exit 0 = fine to source. Exit 1 = do not source; the reason is printed.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F="$HERE/config.env"
KEYS='CHECKS|PAGES_PROJECT|PAGES_URL|PUBLIC_URL|VERIFIED_SINCE|BARE_DOMAIN_FORWARDED|CANONICAL_ORIGIN|PRODUCTION_BRANCH'
OK_RE="^(#.*)?\$|^(${KEYS})=[A-Za-z0-9._/:-]*\$"

if grep -qvE "$OK_RE" "$F"; then
  echo "::error::deploy/config.env holds a line that is not a comment or a plain assignment to one of its known settings; it will not be sourced:"
  grep -nvE "$OK_RE" "$F"
  exit 1
fi
# shellcheck disable=SC1090
. "$F"

bad() { echo "::error::deploy/config.env: $1"; exit 1; }
case "${CHECKS:-}" in on|off) ;; *) bad "CHECKS must be on or off" ;; esac
[[ "${PAGES_PROJECT:-}" =~ ^[a-z0-9][a-z0-9-]*$ ]] || bad "PAGES_PROJECT must be a Pages project name"
[[ "${PAGES_URL:-}" =~ ^https://[a-z0-9][a-z0-9.-]*\.pages\.dev/$ ]] || bad "PAGES_URL must be https://<project>.pages.dev/, with the trailing slash"
[ -z "${PUBLIC_URL:-}" ] || [[ "$PUBLIC_URL" =~ ^https://[a-z0-9][a-z0-9.-]*/$ ]] || bad "PUBLIC_URL must be empty or https://<host>/, with the trailing slash"
[ -z "${VERIFIED_SINCE:-}" ] || [[ "$VERIFIED_SINCE" =~ ^[0-9a-f]{40}$ ]] || bad "VERIFIED_SINCE must be empty or a full 40-character commit id"
case "${BARE_DOMAIN_FORWARDED:-no}" in yes|no) ;; *) bad "BARE_DOMAIN_FORWARDED must be yes or no" ;; esac
case "${CANONICAL_ORIGIN:-}" in
  https://rentalassistanceservices.com|https://www.rentalassistanceservices.com) ;;
  *) bad "CANONICAL_ORIGIN must be https://rentalassistanceservices.com or https://www.rentalassistanceservices.com" ;;
esac
[[ "${PRODUCTION_BRANCH:-main}" =~ ^[A-Za-z0-9._/-]+$ ]] || bad "PRODUCTION_BRANCH is not a branch name"
if [ "$CHECKS" = "on" ] && ! [[ "${VERIFIED_SINCE:-}" =~ ^[0-9a-f]{40}$ ]]; then
  bad "CHECKS=on needs VERIFIED_SINCE: the full 40-character id of the commit production served when the checks were switched on."
fi

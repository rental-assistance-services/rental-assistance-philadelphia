#!/usr/bin/env bash
#
# deploy/config-check.sh: is deploy/config.env safe to source, and complete?
#
# Every job that reads the settings runs this first. Sourcing a file runs
# whatever is in it, and this one arrives through pull requests, so only
# comments and plain assignments are allowed. And with CHECKS=on the approval
# walk needs its starting point: without a full VERIFIED_SINCE no commit could
# ever be verified, so every check would answer "unknown" forever.
#
# Exit 0 = fine to source. Exit 1 = do not source; the reason is printed.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F="$HERE/config.env"
OK_RE='^(#.*)?$|^[A-Z_]+=[A-Za-z0-9._/:-]*$'

if grep -qvE "$OK_RE" "$F"; then
  echo "::error::deploy/config.env holds a line that is not a comment or a plain assignment; it will not be sourced:"
  grep -nvE "$OK_RE" "$F"
  exit 1
fi
# shellcheck disable=SC1090
. "$F"
if [ "${CHECKS:-off}" = "on" ] && ! [[ "${VERIFIED_SINCE:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::CHECKS=on needs VERIFIED_SINCE: the full 40-character id of the commit production served when the checks were switched on."
  exit 1
fi

"""Exercise the live-check shell script with curl replaced; no network or credentials."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest


COMMIT = "0123456789abcdef0123456789abcdef01234567"
SCRIPT = Path(__file__).with_name("check-live.sh")
MOCK_CURL = r'''
curl() {
  local headers='' output='' url='' code=200 body='ok' path
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -D) headers="$2"; shift 2 ;;
      -o) output="$2"; shift 2 ;;
      https://*) url="$1"; shift ;;
      *) shift ;;
    esac
  done
  path="${url#https://check-live.test/}"
  path="${path%%\?*}"
  case "$path" in
    '') body="<meta name=\"ras-build\" content=\"${CHECK_LIVE_COMMIT:0:7}\">" ;;
    build.json) body="$CHECK_LIVE_BODY"; code="$CHECK_LIVE_STATUS" ;;
    back-rent/|services/back-rent/|services/licensing/|faq/|tenants/) ;;
    *) code=404 ;;
  esac
  printf 'HTTP/1.1 %s Test\r\n\r\n' "$code" > "$headers"
  printf '%s' "$body" > "$output"
  printf '%s' "$code"
}
export -f curl
exec bash "$CHECK_LIVE_SCRIPT" --url https://check-live.test/ --release --expect-commit "$CHECK_LIVE_COMMIT"
'''


class BuildIdentity(unittest.TestCase):
    def check(self, body, status=200):
        return subprocess.run(
            [shutil.which("bash") or "bash", "-c", MOCK_CURL],
            env={**os.environ, "CHECK_LIVE_SCRIPT": SCRIPT.as_posix(),
                 "CHECK_LIVE_COMMIT": COMMIT, "CHECK_LIVE_BODY": json.dumps(body),
                 "CHECK_LIVE_STATUS": str(status)},
            capture_output=True, text=True, timeout=30,
        )

    def test_a_full_matching_commit_passes(self):
        result = self.check({"commit": COMMIT})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_a_short_stamp_does_not_replace_a_missing_full_commit(self):
        for body in ({}, {"commit": None}, {"commit": ""}, []):
            with self.subTest(body=body):
                result = self.check(body)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)

    def test_the_full_commit_must_match_even_when_the_short_stamp_matches(self):
        result = self.check({"commit": COMMIT[:7] + "f" * 33})
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)

    def test_a_metadata_server_error_remains_inconclusive(self):
        result = self.check({}, status=503)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()

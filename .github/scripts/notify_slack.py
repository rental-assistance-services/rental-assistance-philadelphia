#!/usr/bin/env python3
"""notify_slack.py — post one line to the deploy-alert Slack webhook.

  python3 .github/scripts/notify_slack.py "the message"

The webhook URL comes from the SLACK_WEBHOOK_URL environment variable and never
appears on a command line: a curl argument is visible to every user of the
machine in the process list, and this runs on a shared server. The URL is never
printed. A failed or missing webhook is a warning, not a failure: the problem
being reported stands on its own. Standard library only.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request


def main() -> int:
    text = " ".join(sys.argv[1:]).strip() or sys.stdin.read().strip()
    print(text)
    url = os.environ.get("SLACK_WEBHOOK_URL", "").strip()
    if not url:
        print("::warning::SLACK_WEBHOOK_URL is not set; no alert was sent")
        return 0
    req = urllib.request.Request(url, data=json.dumps({"text": text}).encode(), method="POST",
                                 headers={"Content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            print("Slack alerted" if r.status == 200 else f"::warning::Slack answered HTTP {r.status}")
    except Exception as e:  # noqa: BLE001 - never let the alert path fail the job
        print(f"::warning::the Slack alert failed to send ({type(e).__name__})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

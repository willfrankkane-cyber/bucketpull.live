#!/bin/bash
# cron entry point. Box clock = America/El_Salvador (CST, UTC-6, no DST).
cd /workspace/bucketpull-autopilot || exit 1
export PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/box
case "$1" in
  live)      exec timeout 5h /workspace/ktvenv/bin/python autopilot.py live >> logs/cron-live.log 2>&1 ;;
  keepalive) exec /workspace/ktvenv/bin/python autopilot.py keepalive >> logs/keepalive.log 2>&1 ;;
esac

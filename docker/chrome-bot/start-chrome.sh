#!/bin/bash
set -e

echo "[chrome-bot] Waiting for display :99..."
for i in $(seq 1 30); do
  if [ -e /tmp/.X11-unix/X99 ]; then
    echo "[chrome-bot] Display :99 ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[chrome-bot] ERROR: Display :99 not ready after 30s"
    exit 1
  fi
  sleep 1
done

# Clean stale lock files from unclean shutdown
if [ -f /data/chrome-profile/SingletonLock ]; then
  echo "[chrome-bot] Removing stale SingletonLock"
  rm -f /data/chrome-profile/SingletonLock
fi
if [ -f /data/chrome-profile/SingletonSocket ]; then
  rm -f /data/chrome-profile/SingletonSocket
fi
if [ -f /data/chrome-profile/SingletonCookie ]; then
  rm -f /data/chrome-profile/SingletonCookie
fi

# Prevent "Chrome didn't shut down correctly" restore bubble
PREFS_FILE="/data/chrome-profile/Default/Preferences"
if [ -f "$PREFS_FILE" ]; then
  sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/g' "$PREFS_FILE"
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/g' "$PREFS_FILE"
fi

echo "[chrome-bot] Launching Chrome with x-ext extension..."
exec google-chrome-stable \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --disable-software-rasterizer \
  --user-data-dir=/data/chrome-profile \
  --load-extension=/opt/x-ext \
  --disable-extensions-except=/opt/x-ext \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-networking \
  --disable-sync \
  --disable-translate \
  --disable-session-crashed-bubble \
  --hide-crash-restore-bubble \
  --start-maximized \
  --remote-debugging-port=9222 \
  --display=:99 \
  "https://x.com/home"

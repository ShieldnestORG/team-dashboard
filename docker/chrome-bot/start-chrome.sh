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
  --start-maximized \
  --display=:99 \
  "https://x.com/home"

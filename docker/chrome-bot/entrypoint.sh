#!/bin/bash
# Entrypoint runs as root to fix volume permissions before supervisor starts

# Fix ownership of /data — Docker volumes may create dirs as root,
# and previous Chrome crashes can leave root-owned artifacts
chown -R botuser:botuser /data 2>/dev/null || true

# Hand off to supervisord
exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/chrome-bot.conf

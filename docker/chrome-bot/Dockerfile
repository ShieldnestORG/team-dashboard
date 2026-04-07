FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Install Chrome, Xvfb, VNC, noVNC, supervisord
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl gnupg ca-certificates \
    xvfb x11vnc novnc websockify \
    supervisor dbus dbus-x11 \
    fonts-liberation fonts-noto-color-emoji \
    procps && \
    # Add Google Chrome repo
    curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
      | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg && \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] \
      http://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list && \
    apt-get update && apt-get install -y --no-install-recommends google-chrome-stable && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash botuser && \
    mkdir -p /data/chrome-profile && \
    chown -R botuser:botuser /data

# Copy extension
COPY packages/x-bot/ /opt/x-ext/

# Copy configs
COPY docker/chrome-bot/supervisord.conf /etc/supervisor/conf.d/chrome-bot.conf
COPY docker/chrome-bot/start-chrome.sh /usr/local/bin/start-chrome.sh
COPY docker/chrome-bot/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/start-chrome.sh /usr/local/bin/entrypoint.sh

EXPOSE 6080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

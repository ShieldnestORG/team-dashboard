FROM node:lts-trixie-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git ffmpeg \
     # Playwright Chromium dependencies for presentation slide rendering
     libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 \
     libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2t64 \
     libpango-1.0-0 libcairo2 libxshmfence1 fonts-liberation \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# whisper.cpp: word-level audio transcription used by the YouTube pipeline to
# align rendered TTS audio to slide texts (replaces fragile silence-detection-
# based boundary inference). Built as a separate stage so the production image
# doesn't carry build-essential / cmake. tiny.en is ~75MB and gives word-perfect
# timestamps in ~5-10s for a 2-3 minute audio.
FROM debian:trixie-slim AS whisper-build
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /opt
RUN git clone --depth=1 https://github.com/ggerganov/whisper.cpp.git whisper.cpp \
  && cd whisper.cpp \
  && cmake -B build -DCMAKE_BUILD_TYPE=Release \
  && cmake --build build -j --config Release \
  && bash ./models/download-ggml-model.sh tiny.en

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY cli/package.json cli/
COPY server/package.json server/
COPY ui/package.json ui/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/brand-guide/package.json packages/brand-guide/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/adapter-utils/package.json packages/adapter-utils/
COPY packages/adapters/claude-local/package.json packages/adapters/claude-local/
COPY packages/adapters/codex-local/package.json packages/adapters/codex-local/
COPY packages/adapters/cursor-local/package.json packages/adapters/cursor-local/
COPY packages/adapters/gemini-local/package.json packages/adapters/gemini-local/
COPY packages/adapters/openclaw-gateway/package.json packages/adapters/openclaw-gateway/
COPY packages/adapters/opencode-local/package.json packages/adapters/opencode-local/
COPY packages/adapters/pi-local/package.json packages/adapters/pi-local/
COPY packages/plugins/sdk/package.json packages/plugins/sdk/
COPY packages/plugins/plugin-firecrawl/package.json packages/plugins/plugin-firecrawl/
COPY packages/plugins/plugin-twitter/package.json packages/plugins/plugin-twitter/
COPY packages/plugins/plugin-discord/package.json packages/plugins/plugin-discord/
COPY packages/plugins/plugin-moltbook/package.json packages/plugins/plugin-moltbook/
COPY patches/ patches/

RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app /app
COPY . .
RUN pnpm --filter @paperclipai/ui build
RUN pnpm --filter @paperclipai/plugin-sdk build
RUN pnpm --filter @paperclipai/plugin-firecrawl build
RUN pnpm --filter @paperclipai/plugin-twitter build
RUN pnpm --filter @paperclipai/plugin-discord build
RUN pnpm --filter @paperclipai/server build
RUN test -f server/dist/index.js || (echo "ERROR: server build output missing" && exit 1)

FROM base AS production
WORKDIR /app
COPY --chown=node:node --from=build /app /app
# whisper.cpp binary + tiny.en model for word-level TTS alignment in YouTube pipeline.
# Path is fixed because the Node code shells out to it; if you move these,
# update WHISPER_BIN / WHISPER_MODEL in server/src/services/youtube/tts.ts too.
COPY --from=whisper-build /opt/whisper.cpp/build/bin/whisper-cli /opt/whisper/whisper
COPY --from=whisper-build /opt/whisper.cpp/models/ggml-tiny.en.bin /opt/whisper/ggml-tiny.en.bin
RUN npm install --global --omit=dev @anthropic-ai/claude-code@latest @openai/codex@latest opencode-ai \
  && mkdir -p /paperclip /opt/pw-browsers \
  && chown node:node /paperclip /opt/pw-browsers \
  && PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
     npx --prefix /app/server playwright install chromium 2>/dev/null || true

ENV NODE_ENV=production \
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  HOME=/paperclip \
  HOST=0.0.0.0 \
  PORT=3100 \
  SERVE_UI=true \
  PAPERCLIP_HOME=/paperclip \
  PAPERCLIP_INSTANCE_ID=default \
  PAPERCLIP_CONFIG=/paperclip/instances/default/config.json \
  PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  PAPERCLIP_DEPLOYMENT_EXPOSURE=private

VOLUME ["/paperclip"]
EXPOSE 3100

USER node
CMD ["node", "--import", "./server/node_modules/tsx/dist/loader.mjs", "server/dist/index.js"]

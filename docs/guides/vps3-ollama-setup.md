# VPS_3 Ollama Setup Guide

**Server:** `147.79.78.251` (15GB RAM, ~119GB free disk)  
**Model:** Gemma 4 E4B (4.5B effective params, 9.6GB, fits fully in RAM)  
**Status:** COMPLETE (as of 2026-04-10)

## What was done

### 1. Disk cleanup (freed ~28GB)
- Truncated PM2 logs (21GB)
- Removed stopped Docker containers + unused images + volumes (~5GB)
- Cleared yarn/pip/npm caches

### 2. Added 16GB swap
```bash
fallocate -l 16G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
# Persisted in /etc/fstab
```

### 3. Installed Ollama
```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

### 4. Configured remote access
Override at `/etc/systemd/system/ollama.service.d/override.conf`:
```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
```
No firewall active — port 11434 is open.

### 5. Model: gemma4:e4b
```bash
ollama pull gemma4:e4b
```
- **Speed:** 5.8 tok/s on CPU
- **RAM usage:** ~9.6GB (fits fully in 15GB RAM, no swap needed)
- **Quality:** Gemma 4 architecture, massive upgrade from qwen2.5:1.5b

Note: gemma4:31b (19GB) was tested but too slow on CPU+swap (~0.5 tok/s). Removed.

## Content generation model

Ollama for content generation now runs on **VPS_1** (`31.220.61.12`) with **gemma4:26b** (MoE, 11.6 tok/s, fits in 31GB RAM).
The team-dashboard backend reaches it via Docker bridge at `http://172.17.0.1:11434`.

VPS_3 Ollama is still installed and available for future use (e.g. additional models, agent work).

## Connected services

VPS_3 hosts:
- **BGE-M3 embeddings** at `:8000` — used by team-dashboard and coherencedaddy for vector search
- **Vosk STT** at `:2700` — speech-to-text service
- **Ollama** at `:11434` — available for future model hosting

## PM2 apps still running

All 6 PM2 apps were kept: launchpad, ShieldAssist, ShieldNews, ShieldYoutube, shieldnesteye, toknstwitter. Using ~600MB total RAM.

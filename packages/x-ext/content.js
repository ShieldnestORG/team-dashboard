// content.js — TestMedia Bot | Entry point + UI wiring
// All modules loaded before this file via manifest.json js array.

/**
 * 🕵️‍♂️ NETWORK INTERCEPTOR (VEGAS SPY V3)
 * Injected into the Page Context (the 'World' where X.com's scripts live).
 */
function injectNetworkSpy() {
  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('tracer.js');
    (document.head || document.documentElement).appendChild(s);
    s.onload = () => s.remove();
  } catch (e) {
    console.error("[Bot][Spy] Failed to inject tracer:", e);
  }
}
injectNetworkSpy();

// ─────────────────────────────────────────────────────
// 1. STYLES
// ─────────────────────────────────────────────────────
function mountStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
/* ============================================================
   TOKNS AUTOMATION BOT — PREMIUM UI STYLESHEET
   Design System: Cyber-Fintech / Glassmorphism Dark
   Font: Outfit (display) + DM Mono (data/labels)
   ============================================================ */

@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');

/* ─────────────────────────────────────────
   CSS CUSTOM PROPERTIES — Design Tokens
───────────────────────────────────────── */
#testmedia-bot-ui {
  position: fixed;
  z-index: 2147483647;
  pointer-events: none;
  font-family: 'Outfit', -apple-system, sans-serif;
}

#tmb-card,
#tmb-pill {
  --tmb-bg-void:        #07070d;
  --tmb-bg-surface:     #0d0d18;
  --tmb-bg-elevated:    #13131f;
  --tmb-bg-overlay:     rgba(13, 13, 24, 0.95);

  --tmb-border-dim:     rgba(255, 255, 255, 0.06);
  --tmb-border-glow:    rgba(0, 229, 160, 0.3);
  --tmb-border-focus:   rgba(0, 229, 160, 0.7);

  --tmb-mint:           #00e5a0;
  --tmb-mint-dim:       rgba(0, 229, 160, 0.15);
  --tmb-mint-glow:      rgba(0, 229, 160, 0.4);
  --tmb-blue:           #4f8eff;
  --tmb-blue-dim:       rgba(79, 142, 255, 0.15);
  --tmb-blue-glow:      rgba(79, 142, 255, 0.35);
  --tmb-orange:         #ff8c42;
  --tmb-orange-dim:     rgba(255, 140, 66, 0.2);
  --tmb-red:            #ff4f6a;

  --tmb-text-primary:   #e8eaf0;
  --tmb-text-secondary: rgba(220, 224, 235, 0.55);
  --tmb-text-muted:     rgba(220, 224, 235, 0.28);

  --tmb-radius-card:    16px;
  --tmb-radius-inner:   10px;
  --tmb-radius-pill:    40px;

  --tmb-shadow-card:
    0 0 0 1px var(--tmb-border-dim),
    0 8px 32px rgba(0, 0, 0, 0.55),
    0 2px 8px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);

  --tmb-shadow-card-hover:
    0 0 0 1px rgba(0, 229, 160, 0.18),
    0 16px 48px rgba(0, 0, 0, 0.65),
    0 4px 16px rgba(0, 229, 160, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);

  --tmb-transition-fast:   150ms cubic-bezier(0.4, 0, 0.2, 1);
  --tmb-transition-smooth: 280ms cubic-bezier(0.4, 0, 0.2, 1);
  --tmb-transition-spring: 420ms cubic-bezier(0.34, 1.56, 0.64, 1);

  font-family: 'Outfit', -apple-system, sans-serif;
  box-sizing: border-box;
}

/* ─────────────────────────────────────────
   GLOBAL CARD BASE
───────────────────────────────────────── */
#tmb-card {
  pointer-events: all;
  position: relative;
  z-index: 2147483647;
  width: 300px;
  background: var(--tmb-bg-overlay);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-radius: var(--tmb-radius-card);
  box-shadow: var(--tmb-shadow-card);
  border: 1px solid var(--tmb-border-dim);
  user-select: none;
  transition: box-shadow var(--tmb-transition-smooth), transform var(--tmb-transition-smooth), left 0.25s cubic-bezier(0.23,1,0.32,1), top 0.25s cubic-bezier(0.23,1,0.32,1);

  /* Subtle top-left scanline texture */
  background-image:
    linear-gradient(135deg, rgba(0, 229, 160, 0.03) 0%, transparent 50%),
    repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      rgba(255,255,255,0.012) 2px,
      rgba(255,255,255,0.012) 3px
    );
}

#tmb-card:hover {
  box-shadow: var(--tmb-shadow-card-hover);
}

#tmb-card.tmb-dragging {
  box-shadow: 0 32px 80px rgba(0,0,0,0.75), 0 8px 32px rgba(0,0,0,0.55) !important;
  transform: scale(1.02);
  transition: none !important;
}

#tmb-card.tmb-snapping {
  transition: left 0.25s cubic-bezier(0.23,1,0.32,1),
              top  0.25s cubic-bezier(0.23,1,0.32,1),
              box-shadow 0.2s, transform 0.2s;
}

/* ─────────────────────────────────────────
   KEYFRAME ANIMATIONS
───────────────────────────────────────── */

/* Card entrance — slides up from bottom-right with a subtle overshoot */
@keyframes tmb-card-enter {
  0%   { opacity: 0; transform: translateY(28px) scale(0.94); }
  60%  { opacity: 1; transform: translateY(-4px) scale(1.01); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

/* Login card enters from center scale */
@keyframes tmb-login-enter {
  0%   { opacity: 0; transform: scale(0.92) translateY(14px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}

/* Pulsing status dot */
@keyframes tmb-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--tmb-mint-glow); }
  50%       { box-shadow: 0 0 0 5px rgba(0, 229, 160, 0); }
}

@keyframes tmb-pulse-orange {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 140, 66, 0.5); }
  50%       { box-shadow: 0 0 0 5px rgba(255, 140, 66, 0); }
}

/* Pill entrance — snaps in from right */
@keyframes tmb-pill-enter {
  0%   { opacity: 0; transform: translateY(-50%) translateX(20px); }
  100% { opacity: 1; transform: translateY(-50%) translateX(0); }
}
@keyframes tmb-pill-exit {
  0%   { opacity: 1; transform: translateY(-50%) translateX(0); }
  100% { opacity: 0; transform: translateY(-50%) translateX(20px); }
}

/* Gradient shimmer on the login title */
@keyframes tmb-shimmer {
  0%   { background-position: -200% center; }
  100% { background-position: 200% center; }
}

/* Counter digit pop */
@keyframes tmb-count-pop {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.12); color: var(--tmb-mint); }
  100% { transform: scale(1); }
}

/* Scanline sweep over card on load */
@keyframes tmb-scanline {
  0%   { transform: translateY(-100%); opacity: 0.4; }
  100% { transform: translateY(400%); opacity: 0; }
}

.tmb-anim-in {
  animation: tmb-view-in 0.22s ease forwards;
}

@keyframes tmb-view-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes tmb-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* ── Interaction Shield ── */
#tmb-interaction-shield {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 2147483646; /* One level below the dashboard UI */
  background: transparent;
  backdrop-filter: none;
  cursor: default;
  pointer-events: all;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

#tmb-shield-watermark {
  width: clamp(200px, 40vw, 400px);
  height: auto;
  opacity: 0.15;
  filter: grayscale(1);
  pointer-events: none;
  user-select: none;
  animation: tmb-watermark-pulse 8s ease-in-out infinite;
}

@keyframes tmb-watermark-pulse {
  0%, 100% { transform: scale(1); opacity: 0.12; }
  50% { transform: scale(1.05); opacity: 0.18; }
}

/* ── Notification ── */
.tmb-notif {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  margin-bottom: 14px;
  overflow: hidden;
  animation: tmb-view-in 0.2s ease forwards;
}

.tmb-notif-icon {
  font-weight: 700;
  font-size: 12px;
  flex-shrink: 0;
  margin-top: 1px;
}

.tmb-notif-text {
  font-family: 'DM Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.03em;
  line-height: 1.5;
  flex: 1;
}

.tmb-notif-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  opacity: 0.4;
  transition: opacity 0.15s;
  color: inherit;
  padding: 0;
  flex-shrink: 0;
}

.tmb-notif-close:hover { opacity: 0.8; }

.tmb-notif-bar {
  position: absolute;
  bottom: 0; left: 0;
  height: 2px;
  border-radius: 0 0 10px 10px;
  animation: tmb-shrink 4s linear forwards;
}

@keyframes tmb-shrink {
  from { width: 100%; }
  to   { width: 0%; }
}

/* ─────────────────────────────────────────
   STATE 1 — LOGIN MODAL
───────────────────────────────────────── */
#tmb-card.tmb-card-login {
  width: clamp(340px, 90vw, 400px);
  animation: tmb-login-enter 0.55s cubic-bezier(0.34, 1.36, 0.64, 1) forwards;
  /* Slightly stronger glow for login */
  box-shadow:
    0 0 0 1px var(--tmb-border-dim),
    0 0 60px rgba(0, 229, 160, 0.08),
    0 20px 60px rgba(0, 0, 0, 0.7),
    inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

/* Scanline sweep pseudo-element */
#tmb-card.tmb-card-login::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    transparent 40%,
    rgba(0, 229, 160, 0.04) 50%,
    transparent 60%
  );
  pointer-events: none;
  animation: tmb-scanline 1.8s ease-out 0.3s 1 forwards;
  z-index: -1;
}

/* Login drag handle — acts as a decorative header bar */
#tmb-card.tmb-card-login #tmb-drag-handle {
  height: 48px;
  background: linear-gradient(90deg,
    rgba(0, 229, 160, 0.07) 0%,
    rgba(79, 142, 255, 0.04) 100%
  );
  border-bottom: 1px solid var(--tmb-border-dim);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 8px;
  cursor: grab;
  justify-content: flex-start;
}

/* Login body */
.tmb-body-login {
  padding: 28px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* Title */
.tmb-login-title {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.5px;
  margin-bottom: 4px;
  background: linear-gradient(100deg,
    #e8eaf0 0%,
    var(--tmb-mint) 40%,
    #e8eaf0 70%,
    var(--tmb-blue) 100%
  );
  background-size: 200% auto;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: tmb-shimmer 4s linear 0.6s infinite;
}

/* Subtitle line under login title */
.tmb-login-sub {
  font-size: 11px;
  font-family: 'DM Mono', monospace;
  color: var(--tmb-text-muted);
  letter-spacing: 0.3px;
  margin-bottom: 24px;
  margin-top: -2px;
}

/* Label */
.tmb-field-label {
  display: block;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--tmb-text-muted);
  margin-bottom: 8px;
  font-family: 'DM Mono', monospace;
}

/* Token Input */
#tmb-token-input {
  width: 100%;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--tmb-border-dim);
  border-radius: var(--tmb-radius-inner);
  padding: 11px 14px;
  color: var(--tmb-text-primary);
  font-family: 'DM Mono', monospace;
  font-size: 13px;
  letter-spacing: 2px;
  outline: none;
  transition:
    border-color var(--tmb-transition-fast),
    box-shadow var(--tmb-transition-fast),
    background var(--tmb-transition-fast);
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.3);
  margin-bottom: 16px;
}

#tmb-token-input::placeholder {
  color: var(--tmb-text-muted);
  letter-spacing: 1px;
  font-size: 12px;
}

#tmb-token-input:focus {
  border-color: var(--tmb-border-focus);
  background: rgba(0, 0, 0, 0.5);
  box-shadow:
    inset 0 2px 6px rgba(0, 0, 0, 0.3),
    0 0 0 3px var(--tmb-mint-dim),
    0 0 16px var(--tmb-mint-dim);
}

/* Login Button */
#tmb-login-btn {
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg,
    rgba(0, 229, 160, 0.18) 0%,
    rgba(79, 142, 255, 0.12) 100%
  );
  border: 1px solid var(--tmb-border-glow);
  border-radius: var(--tmb-radius-inner);
  color: var(--tmb-mint);
  font-family: 'Outfit', sans-serif;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition:
    background var(--tmb-transition-smooth),
    box-shadow var(--tmb-transition-smooth),
    transform var(--tmb-transition-fast),
    border-color var(--tmb-transition-smooth);
  box-shadow:
    0 0 20px rgba(0, 229, 160, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

/* Button shimmer sweep on hover */
#tmb-login-btn::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 60%;
  height: 100%;
  background: linear-gradient(90deg,
    transparent,
    rgba(0, 229, 160, 0.15),
    transparent
  );
  transition: left 0.45s ease;
}

#tmb-login-btn:hover::before {
  left: 160%;
}

#tmb-login-btn:hover:not(:disabled) {
  background: linear-gradient(135deg,
    rgba(0, 229, 160, 0.28) 0%,
    rgba(79, 142, 255, 0.18) 100%
  );
  border-color: var(--tmb-mint);
  box-shadow:
    0 0 28px rgba(0, 229, 160, 0.22),
    0 4px 16px rgba(0, 229, 160, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  transform: translateY(-1px);
}

#tmb-login-btn:active:not(:disabled) {
  transform: translateY(0) scale(0.98);
  box-shadow: 0 0 12px rgba(0, 229, 160, 0.15);
}

#tmb-login-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.tmb-spinner {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid rgba(79,142,255,0.3);
  border-top-color: rgba(79,142,255,0.9);
  animation: tmb-spin 0.7s linear infinite;
  display: inline-block;
}

/* ─────────────────────────────────────────
   STATE 2 — MAIN DASHBOARD
───────────────────────────────────────── */
#tmb-card.tmb-card-main {
  width: clamp(280px, 90vw, 320px);
  animation: tmb-card-enter 0.5s cubic-bezier(0.34, 1.36, 0.64, 1) forwards;
  display: flex;
  flex-direction: column;
}

/* Drag Handle */
#tmb-card.tmb-card-main #tmb-drag-handle,
#tmb-card.tmb-card-login #tmb-drag-handle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
  padding: 12px 14px 11px;
  background: linear-gradient(90deg,
    rgba(0, 229, 160, 0.05) 0%,
    transparent 100%
  );
  border-bottom: 1px solid var(--tmb-border-dim);
  cursor: grab;
  transition: background var(--tmb-transition-smooth);
}

.tmb-brand { display: flex; align-items: center; gap: 8px; }

.tmb-handle-actions { display: flex; align-items: center; gap: 6px; }

#tmb-card.tmb-card-main #tmb-drag-handle:hover,
#tmb-card.tmb-card-login #tmb-drag-handle:hover {
  background: linear-gradient(90deg,
    rgba(0, 229, 160, 0.09) 0%,
    transparent 100%
  );
}

#tmb-card.tmb-card-main #tmb-drag-handle:active,
#tmb-card.tmb-card-login #tmb-drag-handle:active {
  cursor: grabbing;
}

/* Brand dot — pulsing status indicator */
.tmb-brand-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background var(--tmb-transition-smooth), box-shadow var(--tmb-transition-smooth);
}

.tmb-brand-dot.active {
  background: var(--tmb-mint);
  box-shadow: 0 0 0 2px var(--tmb-mint-dim);
  animation: tmb-pulse 2.4s ease-in-out infinite;
}

.tmb-brand-dot:not(.active), .tmb-brand-dot.locked {
  background: var(--tmb-orange);
  box-shadow: 0 0 0 2px var(--tmb-orange-dim);
  /* animation: tmb-pulse-orange 2.4s ease-in-out infinite; */
}

/* Brand name */
.tmb-brand-name {
  font-size: 11.5px;
  font-family: 'DM Mono', monospace;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--tmb-text-secondary);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tmb-grip {
  display: flex; flex-direction: column; gap: 3px;
  opacity: 0.2; transition: opacity 0.15s;
}

#tmb-drag-handle:hover .tmb-grip { opacity: 0.4; }
.tmb-grip span { display: flex; gap: 3px; }

.tmb-grip-dot {
  width: 3px; height: 3px; border-radius: 50%;
  background: rgba(255,255,255,0.9); display: inline-block;
}

.tmb-icon-btn {
  background: none; border: none;
  padding: 3px 4px; cursor: pointer;
  color: rgba(255,255,255,0.2); font-size: 13px;
  line-height: 1; border-radius: 4px;
  transition: color 0.15s, background 0.15s;
  display: flex; align-items: center; justify-content: center;
}

.tmb-icon-btn:hover {
  color: var(--tmb-text-primary);
  border-color: rgba(255,255,255,0.18);
  background: rgba(255, 255, 255, 0.05);
}

/* Main Body */
.tmb-body {
  padding: 18px 16px 14px;
  overflow-y: scroll;
  overflow-x: hidden;
  flex: 1 1 auto;
  min-height: 0;
  max-height: 340px;
  scroll-behavior: smooth;
  scrollbar-width: none;
  -ms-overflow-style: none;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.tmb-body::-webkit-scrollbar { display: none; }
.tmb-body::-webkit-scrollbar-track { background: transparent; }

/* Online/Offline row */
#tmb-main-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--tmb-border-dim);
  border-radius: var(--tmb-radius-inner);
  padding: 10px 14px;
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
  transition: border-color var(--tmb-transition-smooth);
}

#tmb-main-row:has(#tmb-toggle-input:checked) {
  border-color: rgba(0, 229, 160, 0.15);
  background: rgba(0, 229, 160, 0.04);
}

/* State label */
#tmb-state-label {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: var(--tmb-text-muted);
  transition: color var(--tmb-transition-smooth);
  font-family: 'DM Mono', monospace;
  text-transform: uppercase;
}
#tmb-state-label.active { color: var(--tmb-mint); }

#tmb-main-row:has(#tmb-toggle-input:checked) #tmb-state-label {
  color: var(--tmb-mint);
}

/* ── Toggle Switch ── */
#tmb-toggle-wrap {
  position: relative;
  display: flex;
  align-items: center;
  cursor: pointer;
  width: 46px;
  height: 26px;
  flex-shrink: 0;
}

#tmb-toggle-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}

#tmb-track {
  position: absolute;
  inset: 0;
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid var(--tmb-border-dim);
  transition:
    background var(--tmb-transition-smooth),
    border-color var(--tmb-transition-smooth),
    box-shadow var(--tmb-transition-smooth);
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);
}

#tmb-toggle-input:checked ~ #tmb-track {
  background: linear-gradient(90deg,
    rgba(0, 229, 160, 0.3),
    rgba(0, 229, 160, 0.2)
  );
  border-color: var(--tmb-border-glow);
  box-shadow:
    inset 0 2px 4px rgba(0,0,0,0.2),
    0 0 12px rgba(0, 229, 160, 0.2);
}

#tmb-thumb {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(180, 185, 200, 0.6);
  border: 1px solid rgba(255,255,255,0.12);
  transition:
    transform var(--tmb-transition-spring),
    background var(--tmb-transition-smooth),
    box-shadow var(--tmb-transition-smooth);
  box-shadow: 0 1px 4px rgba(0,0,0,0.4);
}

#tmb-toggle-input:checked ~ #tmb-thumb {
  transform: translateX(20px);
  background: var(--tmb-mint);
  border-color: rgba(0, 229, 160, 0.5);
  box-shadow:
    0 1px 4px rgba(0,0,0,0.3),
    0 0 8px var(--tmb-mint-glow);
}

/* Post Counter */
#tmb-post-counter {
  font-family: 'DM Mono', monospace;
  font-size: 12px;
  font-weight: 500;
  color: var(--tmb-text-muted);
  text-align: center;
  letter-spacing: 0.5px;
  padding: 9px 14px;
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid var(--tmb-border-dim);
  border-radius: var(--tmb-radius-inner);
  position: relative;
  overflow: hidden;
  transition: border-color var(--tmb-transition-smooth);
}

/* Accent bar on left edge of counter */
#tmb-post-counter::before {
  content: '';
  position: absolute;
  left: 0;
  top: 20%;
  bottom: 20%;
  width: 2px;
  border-radius: 2px;
  background: linear-gradient(to bottom, var(--tmb-mint), var(--tmb-blue));
  opacity: 0.6;
}

/* ── Footer ── */
#tmb-footer {
  padding: 10px 16px 14px;
  border-top: 1px solid var(--tmb-border-dim);
}

/* Logout button */
#tmb-logout {
  width: 100%;
  padding: 9px;
  background: transparent;
  border: 1px solid var(--tmb-border-dim);
  border-radius: var(--tmb-radius-inner);
  color: var(--tmb-text-muted);
  font-family: 'Outfit', sans-serif;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1px;
  text-transform: uppercase;
  cursor: pointer;
  transition:
    color var(--tmb-transition-fast),
    border-color var(--tmb-transition-fast),
    background var(--tmb-transition-fast),
    box-shadow var(--tmb-transition-smooth);
}

#tmb-logout:hover {
  color: var(--tmb-red);
  border-color: rgba(255, 79, 106, 0.35);
  background: rgba(255, 79, 106, 0.06);
  box-shadow: 0 0 12px rgba(255, 79, 106, 0.1);
}

#tmb-logout:active {
  transform: scale(0.97);
}

/* ─────────────────────────────────────────
   STATE 3 — ZEN MODE PILL
───────────────────────────────────────── */
#tmb-pill {
  position: fixed;
  right: 0;
  top: 50%;
  pointer-events: all;
  transform: translateY(-50%);
  z-index: 2147483647;

  width: 26px;
  height: 72px;
  border-radius: 12px 0 0 12px;

  background: var(--tmb-bg-overlay);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);

  border: 1px solid var(--tmb-border-dim);
  border-right: none;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  cursor: pointer;

  box-shadow:
    -4px 0 20px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);

  animation: tmb-pill-enter 0.4s cubic-bezier(0.34, 1.36, 0.64, 1) forwards;
  transition:
    width var(--tmb-transition-spring),
    box-shadow var(--tmb-transition-smooth),
    border-color var(--tmb-transition-smooth),
    background var(--tmb-transition-smooth);
}

#tmb-pill.entering { animation: tmb-pill-enter 0.3s cubic-bezier(0.23,1,0.32,1) forwards; }
#tmb-pill.exiting  { animation: tmb-pill-exit  0.2s ease forwards; }

#tmb-pill:hover {
  width: 34px;
  border-color: rgba(0, 229, 160, 0.25);
  background: rgba(13, 13, 24, 0.88);
  box-shadow:
    -6px 0 28px rgba(0, 0, 0, 0.5),
    -2px 0 12px rgba(0, 229, 160, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

/* Pill dot */
#tmb-pill-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background var(--tmb-transition-smooth), box-shadow var(--tmb-transition-smooth);
}

#tmb-pill-dot.active {
  background: var(--tmb-mint);
  box-shadow: 0 0 0 2px var(--tmb-mint-dim);
  animation: tmb-pulse 2.4s ease-in-out infinite;
}

#tmb-pill-dot:not(.active), #tmb-pill-dot.locked {
  background: var(--tmb-orange);
  box-shadow: 0 0 0 2px var(--tmb-orange-dim);
  /* animation: tmb-pulse-orange 2.4s ease-in-out infinite; */
}

/* Pill label */
#tmb-pill-label {
  font-family: 'Outfit', sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: var(--tmb-text-muted);
  writing-mode: vertical-rl;
  text-orientation: mixed;
  transform: rotate(180deg);
  line-height: 1;
  transition: color var(--tmb-transition-smooth);
}

#tmb-pill:hover #tmb-pill-label {
  color: var(--tmb-text-secondary);
}

#tmb-sidebar-section {
  margin-bottom: 16px;
  overflow: hidden;
  position: relative;
  cursor: pointer;
  background: var(--tmb-bg-overlay) !important;
  border: 1px solid var(--tmb-border-dim) !important;
  backdrop-filter: blur(24px) saturate(180%);
  border-radius: 16px;
  padding: 20px;
  font-family: 'Outfit', sans-serif;
  transition: all 0.3s cubic-bezier(0.23,1,0.32,1);
  animation: tmb-view-in 0.4s ease-out;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

#tmb-sidebar-section:hover {
  border-color: rgba(0, 229, 160, 0.3) !important;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6), 0 0 20px rgba(0, 229, 160, 0.05);
  transform: translateY(-2px);
}

.tmb-sidebar-glow {
  position: absolute;
  top: -50%; left: -50%; width: 200%; height: 200%;
  background: radial-gradient(circle at 70% 30%, var(--tmb-mint-dim) 0%, transparent 60%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.5s ease;
}

#tmb-sidebar-section:hover .tmb-sidebar-glow {
  opacity: 0.15;
}

#tmb-sidebar-section::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: linear-gradient(to bottom, var(--tmb-mint), var(--tmb-blue));
  opacity: 0.4;
  transition: opacity 0.3s;
}

#tmb-sidebar-section:hover::before {
  opacity: 1;
}

#tmb-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.tmb-sidebar-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.tmb-sidebar-title {
  font-family: 'DM Mono', monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 2px;
  color: var(--tmb-text-muted);
  text-transform: uppercase;
}

.tmb-sidebar-ver {
  font-family: 'DM Mono', monospace;
  font-size: 8px;
  color: var(--tmb-text-muted);
  opacity: 0.4;
}

.tmb-sidebar-status {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tmb-sidebar-label {
  font-size: 16px;
  font-weight: 700;
  color: var(--tmb-text-primary);
  letter-spacing: -0.5px;
}

.tmb-sidebar-action-container {
  margin-top: 20px;
}

.tmb-sidebar-large-btn {
  width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: linear-gradient(135deg, rgba(0, 229, 160, 0.12), rgba(0, 229, 160, 0.04));
  border: 1px solid rgba(0, 229, 160, 0.25);
  border-radius: 12px;
  color: var(--tmb-mint);
  font-family: 'DM Mono', monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  transition: all 0.3s cubic-bezier(0.23, 1, 0.32, 1);
  position: relative;
  overflow: hidden;
}

#tmb-sidebar-section:hover .tmb-sidebar-large-btn {
  background: linear-gradient(135deg, rgba(0, 229, 160, 0.2), rgba(0, 229, 160, 0.08));
  border-color: rgba(0, 229, 160, 0.5);
  letter-spacing: 1.8px;
}

.tmb-sidebar-large-btn::after {
  content: '';
  position: absolute;
  top: 0; left: -100%; width: 100%; height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
  transition: left 0.6s ease-in-out;
}

#tmb-sidebar-section:hover .tmb-sidebar-large-btn::after {
  left: 100%;
}

/* ─────────────────────────────────────────
   UTILITY — Cascade stagger on first render
   Apply .tmb-stagger-[n] to children
───────────────────────────────────────── */
.tmb-card-main .tmb-body > *,
.tmb-card-main #tmb-footer {
  animation: tmb-card-enter 0.45s cubic-bezier(0.34, 1.2, 0.64, 1) both;
}

.tmb-card-main .tmb-body > *:nth-child(1) { animation-delay: 0.08s; }
.tmb-card-main .tmb-body > *:nth-child(2) { animation-delay: 0.14s; }
.tmb-card-main #tmb-footer               { animation-delay: 0.18s; }

  `;
  document.head.appendChild(s);
}

// ─────────────────────────────────────────────────────
// 2. RENDER — LOGIN
// ─────────────────────────────────────────────────────
function renderLoginUI(container) {
  removePill();
  saveUIState("login");

  const card = getOrCreateCard(container);
  card.className = "tmb-card-login";

  card.innerHTML = `
    <div id="tmb-drag-handle">
      <div class="tmb-brand">
        <div class="tmb-brand-dot locked"></div>
        <span class="tmb-brand-name">Tokns automation Bot</span>
      </div>
      <div class="tmb-handle-actions">
        ${gripHTML}
        ${minimizeBtnHTML}
      </div>
    </div>
    <div class="tmb-body-login tmb-anim-in">
      <div class="tmb-login-title">Welcome back</div>
      <div class="tmb-login-sub">Connect to the Team Dashboard. Click Continue to start.</div>
      <label class="tmb-field-label">Access Token</label>
      <input id="tmb-token-input" type="password" value="${DEFAULT_DASHBOARD_TOKEN}" placeholder="••••••••••••••••" autocomplete="off" spellcheck="false"/>
      <div style="height:14px;"></div>
      <button id="tmb-login-btn">Continue</button>
    </div>
  `;

  const input = card.querySelector("#tmb-token-input");
  const btn = card.querySelector("#tmb-login-btn");

  input.addEventListener("input", () => {
    btn.disabled = !input.value.trim();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !btn.disabled) btn.click();
  });

  btn.addEventListener("click", async () => {
    const token = input.value.trim();
    if (!token) return;

    btn.disabled = true;
    input.disabled = true;
    btn.innerHTML = `<span class="tmb-spinner"></span> Validating...`;

    const result = await fetchProfile(token);

    input.disabled = false;
    btn.disabled = false;
    btn.innerHTML = "Continue";

    if (!result || !result.ok) {
      input.value = "";
      const msg =
        result?.status === 401
          ? "Invalid or expired token. Please check your dashboard."
          : result?.status === 0
            ? "Could not reach the server. Is the dashboard running?"
            : `Error ${result?.status || ""}: ${result?.error || "Something went wrong."}`;
      showNotification(card, "error", msg);
      return;
    }

    const profile = result.profile;
    const settings = result.settings;

    chrome.storage.local.set(
      {
        [STORAGE_KEY]: token,
        [PROFILE_KEY]: profile,
        [SETTINGS_KEY]: settings,
        [BOT_ENABLED]:
          settings?.bot_enabled ?? settings?.posting_enabled ?? false,
      },
      () => {
        chrome.storage.local.get([STORAGE_KEY], (saved) => {
          console.log("[Bot] Token saved:", saved[STORAGE_KEY]);
          console.log("[Bot] Settings saved:", settings);
          if (saved[STORAGE_KEY]) {
            fadeOut(card, () => renderMainUI(container, profile));
          } else {
            console.error("[Bot] Storage save failed");
            showNotification(
              card,
              "error",
              "Failed to save session. Please try again.",
            );
          }
        });
      },
    );
  });

  card.querySelector("#tmb-minimize-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    handleMinimize(container, false);
  });

  container.style.display = "block";
  setTimeout(() => input && input.focus(), 420);
  setTimeout(() => {
    const left = Math.max(
      CARD_MARGIN,
      (window.innerWidth - card.offsetWidth) / 2,
    );
    const top = Math.max(
      CARD_MARGIN,
      (window.innerHeight - card.offsetHeight) / 2,
    );
    restorePosition(container, left, top);
    initDrag(container, card);
  }, 50);
}

// ─────────────────────────────────────────────────────
// 3. RENDER — MAIN
// ─────────────────────────────────────────────────────
function renderMainUI(container, profile = null) {
  removePill();
  saveUIState("expanded");

  const card = getOrCreateCard(container);
  card.className = "tmb-card-main";

  card.innerHTML = `
    <div id="tmb-drag-handle">
      <div class="tmb-brand">
        <div class="tmb-brand-dot" id="tmb-dot"></div>
        <span class="tmb-brand-name">Neural Engine</span>
      </div>
      <div class="tmb-handle-actions">
        ${gripHTML}
        ${minimizeBtnHTML}
      </div>
    </div>
    <div class="tmb-body tmb-anim-in">
      <div id="tmb-main-row" style="justify-content: center; border: none; background: transparent; padding: 10px 0;">
        <div style="display:flex; flex-direction:column; align-items:center; gap: 8px;">
           <span id="tmb-state-label" style="font-size: 14px;">Offline</span>
           <span style="font-family: 'DM Mono', monospace; font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Awaiting Directives</span>
           <div id="tmb-toggle-wrap" style="margin-top: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 10px; padding: 6px 16px; border-radius: 20px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);">
             <input type="checkbox" id="tmb-toggle-input" style="position:absolute;opacity:0;pointer-events:none;" />
             <span id="tmb-track" style="display:inline-block; width: 36px; height: 20px; border-radius: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); position: relative; transition: background 0.3s; flex-shrink: 0;">
               <span id="tmb-thumb" style="position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #555; transition: all 0.25s ease; box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></span>
             </span>
             <span id="tmb-toggle-label" style="font-family: 'DM Mono', monospace; font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1.5px; user-select: none;">Enable</span>
           </div>
        </div>
      </div>
    </div>
    <div id="tmb-footer">
      <button id="tmb-logout">Logout</button>
    </div>
  `;

  chrome.storage.local.get(
    [BOT_ENABLED, SETTINGS_KEY, PROFILE_KEY, STORAGE_KEY],
    (stored) => {
      const settings = stored[SETTINGS_KEY] || {};
      const savedEmail = stored[PROFILE_KEY]?.email || profile?.email || "";
      const token = stored[STORAGE_KEY];

      // Use settings.online as persistent source of truth
      const botActive = settings.online ?? false;

      const dot = card.querySelector("#tmb-dot");
      const label = card.querySelector("#tmb-state-label");
      const toggle = card.querySelector("#tmb-toggle-input");
      const thumb = card.querySelector("#tmb-thumb");
      const toggleLabel = card.querySelector("#tmb-toggle-label");

      function updateBotUI(isActive) {
        if (dot && label) {
          if (isActive) {
            dot.classList.add("active");
            label.textContent = "Online";
            label.style.color = "var(--tmb-mint)";
          } else {
            dot.classList.remove("active");
            label.textContent = "Offline";
            label.style.color = "var(--tmb-text-secondary)";
          }
        }
        if (toggle) toggle.checked = isActive;
        if (thumb) {
          thumb.style.left = isActive ? "20px" : "2px";
          thumb.style.background = isActive ? "var(--tmb-mint, #00e5a0)" : "#666";
        }
        if (toggleLabel) toggleLabel.textContent = isActive ? "Disable" : "Enable";
      }

      updateBotUI(botActive);

      // Toggle event — enable/disable bot locally
      // Click on wrapper toggles the hidden checkbox
      const toggleWrap = card.querySelector("#tmb-toggle-wrap");
      if (toggleWrap && toggle) {
        toggleWrap.addEventListener("click", (e) => {
          if (e.target !== toggle) toggle.checked = !toggle.checked;
          toggle.dispatchEvent(new Event("change"));
        });
      }
      if (toggle) {
        toggle.addEventListener("change", async () => {
          const isOn = toggle.checked;
          const currentSettings = (await chrome.storage.local.get([SETTINGS_KEY]))[SETTINGS_KEY] || {};
          currentSettings.online = isOn;
          await chrome.storage.local.set({ [SETTINGS_KEY]: currentSettings, [BOT_ENABLED]: isOn });
          updateBotUI(isOn);
          if (isOn) {
            startBot();
            showNotification(card, "success", "Bot enabled — polling for queued tweets");
          } else {
            stopBot();
            showNotification(card, "info", "Bot disabled");
          }
          syncInteractionShield(isOn);
        });
      }

      if (botActive) startBot();
      syncInteractionShield(botActive);

      // Hide the UI automatically 5 seconds after load if bot is active
      if (botActive) queueAutoMinimize(container, 5000);

      if (profile && savedEmail) {
        setTimeout(() => {
          showNotification(card, "success", `Logged in as ${savedEmail}`);
        }, 400);
      }
    },
  );

  // Live-update UI when settings change (from sync settings polling)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes[SETTINGS_KEY]) {
      const newSettings = changes[SETTINGS_KEY].newValue || {};
      const oldSettings = changes[SETTINGS_KEY].oldValue || {};

      // 1. Sync UI Status
      if (newSettings.online !== oldSettings.online) {
        const isOnline = !!newSettings.online;
        
        const dot = card.querySelector("#tmb-dot");
        const label = card.querySelector("#tmb-state-label");
        if (dot && label) {
            if (isOnline) {
              dot.classList.add("active");
              label.textContent = "Online";
              label.style.color = "var(--tmb-mint)";
            } else {
              dot.classList.remove("active");
              label.textContent = "Offline";
              label.style.color = "var(--tmb-text-secondary)";
            }
        }
        
        syncInteractionShield(isOnline);

        if (isOnline) {
          startBot();
          queueAutoMinimize(container, 5000); // Hide after 5s when toggled on
        } else {
          stopBot();
          cancelAutoMinimize(); // Keep UI visible if bot is off
        }
      }
    }
  });

  // ── PERSISTENT ZOOM WATCHER (Every 10 seconds) ──
  // Continuously polls settings and applies browser zoom in real-time,
  // even between bot cycles so the user sees instant feedback on the dashboard change.
  setInterval(async () => {
    try {
      const stored = await chrome.storage.local.get([SETTINGS_KEY]);
      const s = stored[SETTINGS_KEY] || {};
      if (s.browser_zoom_mode === 'custom' && s.browser_zoom_percent) {
        const current = document.body.style.zoom;
        const target = `${s.browser_zoom_percent}%`;
        if (current !== target) {
          document.body.style.zoom = target;
          console.log(`[Zoom] 🔬 Viewport updated to ${s.browser_zoom_percent}%`);
        }
      } else {
        if (document.body.style.zoom && document.body.style.zoom !== '100%') {
          document.body.style.zoom = '100%';
          console.log(`[Zoom] 🖥️ Viewport reset to 100% (Normal Mode)`);
        }
      }
    } catch (e) { /* Silently ignore storage errors */ }
  }, 10000);

  card.querySelector("#tmb-minimize-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    handleMinimize(container, true);
  });

  card.querySelector("#tmb-logout").addEventListener("click", () => {
    fadeOut(card, () => {
      chrome.storage.local.remove(
        [STORAGE_KEY, PROFILE_KEY, SETTINGS_KEY, BOT_ENABLED, STATE_KEY],
        () => renderLoginUI(container),
      );
    });
  });

  container.style.display = "block";
  setTimeout(() => {
    const defaultLeft = window.innerWidth - card.offsetWidth - CARD_MARGIN;
    restorePosition(container, defaultLeft, CARD_MARGIN);
    initDrag(container, card);
  }, 50);

  // ── Poll backend settings every SETTINGS_FETCH_INTERVAL ──
  async function syncSettings() {
    try {
      const stored = await chrome.storage.local.get([STORAGE_KEY]);
      const token = stored[STORAGE_KEY];
      if (!token) return;

      // Send heartbeat to dashboard plugin
      const botState = await chrome.storage.local.get([BOT_ENABLED]);
      const sessionMem = await chrome.storage.local.get(['session_id']);
      fetch(`${WEBHOOK_BASE}/ext-heartbeat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionMem.session_id || "unknown",
          botEnabled: !!botState[BOT_ENABLED],
          currentUrl: window.location.href,
        })
      }).catch(() => {});

      const res = await fetch(`${API_BASE}/api/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;

      const data = await res.json();
      if (data.settings) {
        const mem = await chrome.storage.local.get(['session_id']);
        const newMissionId = data.settings.last_mission_id;
        
        // AUTO-RESET: Reset progress if mission identity changed
        if (newMissionId !== mem.session_id) {
           console.log("[Bot] Command change detected. Resetting tactical index.");
           await chrome.storage.local.set({ 
             mission_step_index: 0,
             session_id: newMissionId || null
           });
        }

        await chrome.storage.local.set({ [SETTINGS_KEY]: data.settings });
      }
    } catch {
      // Silent — network errors don't break anything
    }
  }

  const settingsInterval = setInterval(syncSettings, SETTINGS_FETCH_INTERVAL);

  // Clean up interval on logout
  card.querySelector("#tmb-logout").addEventListener("click", () => {
    clearInterval(settingsInterval);
  });

  // ── AUTO-MINIMIZE GLOBAL LISTENERS ──
  // Hide UI 5s after scrolling begins (Signifies user is reading/bot is working)
  let scrollHideTimer = null;
  window.addEventListener("scroll", () => {
    chrome.storage.local.get([SETTINGS_KEY], (stored) => {
      const s = stored[SETTINGS_KEY] || {};
      if (s.online) {
        if (scrollHideTimer) clearTimeout(scrollHideTimer);
        scrollHideTimer = setTimeout(() => {
          handleMinimize(container, true);
        }, 5000);
      }
    });
  }, { passive: true });
}

// ─────────────────────────────────────────────────────
// 4. RENDER — MINIMIZED PILL / SIDEBAR
// ─────────────────────────────────────────────────────
function renderMinimizedPill(container, isLoggedIn) {
  saveUIState("minimized");
  const card = document.getElementById("tmb-card");
  if (card) card.style.display = "none";
  container.style.display = "none";
  let sidebarList = null;
  const sidebarColumn = document.querySelector('[data-testid="sidebarColumn"]');
  if (sidebarColumn) {
    sidebarList = sidebarColumn.querySelector('form[role="search"]')?.parentElement?.parentElement ||
      sidebarColumn.querySelector('[role="region"]') ||
      sidebarColumn.querySelector('[role="complementary"]') ||
      sidebarColumn.querySelector('section')?.parentElement;
  }

  if (sidebarList) {
    if (document.getElementById("tmb-sidebar-section")) return; 
    const pill = document.getElementById("tmb-pill");
    if (pill) pill.remove(); 

    console.log("[Bot] Attaching to X sidebar...");
    const section = document.createElement("div");
    section.id = "tmb-sidebar-section";

    const dotClass = isLoggedIn ? "active" : "locked";
    const statusText = isLoggedIn ? "ONLINE" : "LOCKED";

    section.innerHTML = `
      <div class="tmb-sidebar-glow"></div>
      <div class="tmb-sidebar-title-row">
        <div class="tmb-sidebar-title">Tokns Control Unit</div>
        <div class="tmb-sidebar-ver">v1.2.4r</div>
      </div>
      <div id="tmb-sidebar-header">
        <div class="tmb-sidebar-status">
          <div class="tmb-brand-dot ${dotClass}" style="width: 8px; height: 8px;"></div>
          <span class="tmb-sidebar-label">${statusText}</span>
        </div>
      </div>
      <div class="tmb-sidebar-action-container">
        <div class="tmb-sidebar-large-btn">
          <span>OPEN DASHBOARD HUBLINK</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </div>
      </div>
    `;

    if (sidebarList.firstChild) {
      sidebarList.insertBefore(section, sidebarList.firstChild);
    } else {
      sidebarList.appendChild(section);
    }

    section.addEventListener("click", () => handleRestore(container));
  } else {
    const pill = document.createElement("div");
    pill.id = "tmb-pill";
    pill.classList.add("entering");

    const dotClass = isLoggedIn ? "active" : "locked";
    pill.innerHTML = `
      <div id="tmb-pill-dot" class="${dotClass}"></div>
      <span id="tmb-pill-label">TM</span>
    `;

    document.body.appendChild(pill);
    pill.addEventListener("click", () => handleRestore(container));
  }
}

// ─────────────────────────────────────────────────────
// 5. MINIMIZE / RESTORE
// ─────────────────────────────────────────────────────
function handleMinimize(container, isLoggedIn) {
  fadeOut(document.getElementById("tmb-card"), () => {
    renderMinimizedPill(container, isLoggedIn);
  });
}

function handleRestore(container) {
  const pill = document.getElementById("tmb-pill");
  if (pill) {
    pill.classList.remove("entering");
    pill.classList.add("exiting");
    setTimeout(() => pill.remove(), 220);
  }
  const sidebar = document.getElementById("tmb-sidebar-section");
  if (sidebar) {
    fadeOut(sidebar, () => sidebar.remove());
  }
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    result[STORAGE_KEY] ? renderMainUI(container) : renderLoginUI(container);

    // Auto-hide again after 10s of manual restore if bot is active
    chrome.storage.local.get([SETTINGS_KEY], (stored) => {
      const s = stored[SETTINGS_KEY] || {};
      if (s.online) queueAutoMinimize(container, 10000);
    });
  });
}

function removePill() {
  const pill = document.getElementById("tmb-pill");
  if (pill) pill.remove();
  const sidebar = document.getElementById("tmb-sidebar-section");
  if (sidebar) sidebar.remove();
}

// 6. AUTO-MINIMIZE HUD LOGIC
// ─────────────────────────────────────────────────────
let __autoMinTimer = null;

function queueAutoMinimize(container, delay) {
  cancelAutoMinimize();
  __autoMinTimer = setTimeout(() => {
    handleMinimize(container, true);
  }, delay);
}

function cancelAutoMinimize() {
  if (__autoMinTimer) {
    clearTimeout(__autoMinTimer);
    __autoMinTimer = null;
  }
}

// 7. INTERACTION SHIELD
// ─────────────────────────────────────────────────────
function syncInteractionShield(online) {
  let shield = document.getElementById("tmb-interaction-shield");

  chrome.storage.local.get([STATE_KEY], (res) => {
    const isMinimized = res[STATE_KEY] === "minimized";

    if (online) {
      if (!shield) {
        shield = document.createElement("div");
        shield.id = "tmb-interaction-shield";
        const logoUrl = chrome.runtime.getURL("icons/logo.png");
        shield.innerHTML = `<img src="${logoUrl}" id="tmb-shield-watermark" alt="Tokns Bot" />`;

        // Block trackpad swipes and mouse wheel scrolling
        shield.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
        shield.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

        // CLICK FORWARDING SYSTEM — Enables clicking bot UI through the shield
        shield.addEventListener("mousedown", (e) => {
          const sidebar = document.getElementById("tmb-sidebar-section");
          const pill = document.getElementById("tmb-pill");
          const card = document.getElementById("tmb-card");

          const targets = [sidebar, pill, card].filter(Boolean);
          for (const target of targets) {
            const rect = target.getBoundingClientRect();
            if (
              e.clientX >= rect.left && e.clientX <= rect.right &&
              e.clientY >= rect.top && e.clientY <= rect.bottom
            ) {
              target.click();
              e.preventDefault();
              e.stopPropagation();
              return;
            }
          }
        });

        // Update cursor when hovering over our UI parts
        shield.addEventListener("mousemove", (e) => {
          const sidebar = document.getElementById("tmb-sidebar-section");
          const pill = document.getElementById("tmb-pill");
          const card = document.getElementById("tmb-card");

          const targets = [sidebar, pill, card].filter(Boolean);
          let hover = false;
          for (const target of targets) {
            const rect = target.getBoundingClientRect();
            if (
              e.clientX >= rect.left && e.clientX <= rect.right &&
              e.clientY >= rect.top && e.clientY <= rect.bottom
            ) {
              hover = true;
              break;
            }
          }
          shield.style.cursor = hover ? "pointer" : "default";
        });

        document.body.appendChild(shield);
        console.log("[Shield] 🛡️ Watermarked Shield deployed. Interaction locked.");
      }
    } else {
      if (shield) {
        shield.remove();
        console.log("[Shield] 🔓 Interaction Shield retracted. Manual entry restored.");
      }
    }
  });
}

// ─────────────────────────────────────────────────────
// 7.5 GLOBAL INPUT GUARD
// ─────────────────────────────────────────────────────
const scrollKeys = [" ", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"];
function setupInputGuards() {
  const guard = (e) => {
    const shield = document.getElementById("tmb-interaction-shield");
    // Only swallow input if the shield is active (bot is running)
    if (!shield) return;

    // Prevent mouse wheel and touch scrolling globally
    if (e.type === "wheel" || e.type === "touchmove") {
      e.preventDefault();
    }
    // Prevent keyboard scroll keys
    if (e.type === "keydown" && scrollKeys.includes(e.key)) {
      e.preventDefault();
    }
  };

  // Attach listeners with capture and passive: false to ensure we intercept them before X.com does
  window.addEventListener("wheel", guard, { capture: true, passive: false });
  window.addEventListener("touchmove", guard, { capture: true, passive: false });
  window.addEventListener("keydown", guard, { capture: true, passive: false });
}

setupInputGuards();

// ─────────────────────────────────────────────────────
// 7. SILENT TOKEN REVALIDATION
// ─────────────────────────────────────────────────────
async function revalidateToken(container, token) {
  const result = await fetchProfile(token);
  if (result && result.ok && result.profile) {
    chrome.storage.local.set({
      [PROFILE_KEY]: result.profile,
      [SETTINGS_KEY]: result.settings,
      [BOT_ENABLED]:
        result.settings?.bot_enabled ??
        result.settings?.posting_enabled ??
        false,
    });

    chrome.storage.local.get([STATE_KEY], (res) => {
      const isOnline = result.settings?.online ?? false;
      if (res[STATE_KEY] === "minimized") {
        const dot = document.getElementById("tmb-pill-dot");
        if (dot) dot.className = isOnline ? "active" : "locked";
        const sideDot = document.querySelector("#tmb-sidebar-section .tmb-brand-dot");
        if (sideDot) sideDot.className = `tmb-brand-dot ${isOnline ? "active" : "locked"}`;
        const sideLabel = document.querySelector("#tmb-sidebar-section .tmb-sidebar-label");
        if (sideLabel) sideLabel.textContent = isOnline ? "ONLINE" : "LOCKED";
      } else {
        renderMainUI(container);
      }
    });
  } else {
    console.warn("[Bot] Revalidation failed:", result);
    chrome.storage.local.remove(
      [STORAGE_KEY, PROFILE_KEY, BOT_ENABLED, STATE_KEY],
      () => {
        renderLoginUI(container);
      },
    );
  }
}

// ─────────────────────────────────────────────────────
// 7. DRAG
// ─────────────────────────────────────────────────────
function initDrag(container, card) {
  const handle = document.getElementById("tmb-drag-handle");
  if (!handle) return;

  let dragging = false,
    startMX,
    startMY,
    startL,
    startT;

  handle.addEventListener("mousedown", (e) => {
    if (
      e.target.closest(
        "#tmb-toggle-wrap,#tmb-login-btn,#tmb-logout,#tmb-token-input,#tmb-minimize-btn",
      )
    )
      return;
    e.preventDefault();
    dragging = true;
    const rect = container.getBoundingClientRect();
    startMX = e.clientX;
    startMY = e.clientY;
    startL = rect.left;
    startT = rect.top;
    card.classList.add("tmb-dragging");
    card.classList.remove("tmb-snapping");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  function onMove(e) {
    if (!dragging) return;
    const newL = Math.max(
      0,
      Math.min(
        window.innerWidth - container.offsetWidth,
        startL + (e.clientX - startMX),
      ),
    );
    const newT = Math.max(
      0,
      Math.min(
        window.innerHeight - container.offsetHeight,
        startT + (e.clientY - startMY),
      ),
    );
    container.style.left = `${newL}px`;
    container.style.top = `${newT}px`;
    container.style.right = "unset";
    container.style.bottom = "unset";
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    card.classList.remove("tmb-dragging");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    const rect = container.getBoundingClientRect();
    handleSnap(container, card, rect.left, rect.top);
  }
}

function handleSnap(container, card, left, top) {
  const W = window.innerWidth,
    H = window.innerHeight;
  const cW = container.offsetWidth,
    cH = container.offsetHeight;
  let sL = left,
    sT = top,
    snapped = false;

  if (left < SNAP_THRESHOLD) {
    sL = CARD_MARGIN;
    snapped = true;
  }
  if (left + cW > W - SNAP_THRESHOLD) {
    sL = W - cW - CARD_MARGIN;
    snapped = true;
  }
  if (top < SNAP_THRESHOLD) {
    sT = CARD_MARGIN;
    snapped = true;
  }
  if (top + cH > H - SNAP_THRESHOLD) {
    sT = H - cH - CARD_MARGIN;
    snapped = true;
  }

  if (snapped) {
    card.classList.add("tmb-snapping");
    container.style.left = `${sL}px`;
    container.style.top = `${sT}px`;
    setTimeout(() => card.classList.remove("tmb-snapping"), 300);
  }
  savePosition(container);
}

// ─────────────────────────────────────────────────────
// 8. POSITION + STATE PERSISTENCE
// ─────────────────────────────────────────────────────
function savePosition(container) {
  const r = container.getBoundingClientRect();
  chrome.storage.local.set({ [POS_KEY]: { left: r.left, top: r.top } });
}

function restorePosition(container, fallbackLeft, fallbackTop) {
  chrome.storage.local.get([POS_KEY], (res) => {
    const pos = res[POS_KEY];
    const left = pos
      ? Math.max(
        CARD_MARGIN,
        Math.min(
          window.innerWidth - container.offsetWidth - CARD_MARGIN,
          pos.left,
        ),
      )
      : fallbackLeft;
    const top = pos
      ? Math.max(
        CARD_MARGIN,
        Math.min(
          window.innerHeight - container.offsetHeight - CARD_MARGIN,
          pos.top,
        ),
      )
      : fallbackTop;
    container.style.left = `${left}px`;
    container.style.top = `${top}px`;
    container.style.right = "unset";
    container.style.bottom = "unset";
  });
}

function saveUIState(state) {
  chrome.storage.local.set({ [STATE_KEY]: state });
}

// ─────────────────────────────────────────────────────
// 9. INJECT
// ─────────────────────────────────────────────────────
function inject() {
  if (!document.body) return;
  mountStyles();

  let container = document.getElementById(WIDGET_ID);
  if (!container) {
    container = document.createElement("div");
    container.id = WIDGET_ID;
    document.body.appendChild(container);
  }

  chrome.storage.local.get([STORAGE_KEY, STATE_KEY, PROFILE_KEY, SETTINGS_KEY], (res) => {
    const token = res[STORAGE_KEY];
    const uiState = res[STATE_KEY];
    const settings = res[SETTINGS_KEY] || {};
    const botActive = settings.online ?? false;

    // Start/Stop bot state
    if (token && botActive) {
      startBot();
      syncInteractionShield(true);
    } else {
      stopBot();
      syncInteractionShield(false);
    }

    // Decide what to render based on current state
    if (!token || uiState === "login") {
      renderLoginUI(container);
    } else if (uiState === "minimized") {
      // If minimized, check if we've lost our elements during the SPA navigation
      if (!document.getElementById("tmb-pill") && !document.getElementById("tmb-sidebar-section")) {
        renderMinimizedPill(container, true);
      } else {
        // If we only have the pill but a new sidebar appeared, dock it!
        const hasPill = document.getElementById("tmb-pill");
        const hasSidebar = document.getElementById("tmb-sidebar-section");
        const canDock = document.querySelector('[data-testid="sidebarColumn"]');
        if (hasPill && canDock && !hasSidebar) {
          renderMinimizedPill(container, true);
        }
      }
      revalidateToken(container, token);
    } else {
      // If we are in expanded mode, ensure the card is visible
      if (!document.getElementById("tmb-card")) {
        renderMainUI(container, null);
      }
      revalidateToken(container, token);
    }
  });
}

// ─────────────────────────────────────────────────────
// 10. SPA PERSISTENCE
// ─────────────────────────────────────────────────────
let lastHref = location.href;

let __mutationDebounce = null;
new MutationObserver(() => {
  clearTimeout(__mutationDebounce);
  __mutationDebounce = setTimeout(() => {
    const isNewUrl = location.href !== lastHref;
    if (isNewUrl) {
      lastHref = location.href;
      setTimeout(inject, 600);
      return;
    }

    const hasWidget = !!document.getElementById(WIDGET_ID);
    const inPill = !!document.getElementById("tmb-pill");
    const inSidebar = !!document.getElementById("tmb-sidebar-section");
    const canDock = !!document.querySelector('[data-testid="sidebarColumn"]');

    // Trigger inject if everything is lost OR if we are in a sub-optimal minimized mode (pill instead of sidebar)
    if (
      (!hasWidget && !inPill && !inSidebar) ||
      (inPill && !inSidebar && canDock)
    ) {
      inject();
    }
  }, 150);
}).observe(document.documentElement, { childList: true, subtree: true });

// ─────────────────────────────────────────────────────
// 10.5 DYNAMIC ADAPTATION (SIDEBAR <-> PILL)
// ─────────────────────────────────────────────────────
let __resizeDebounce = null;
window.addEventListener("resize", () => {
  clearTimeout(__resizeDebounce);
  __resizeDebounce = setTimeout(() => {
    chrome.storage.local.get([STATE_KEY, STORAGE_KEY], (res) => {
      if (res[STATE_KEY] === "minimized") {
        const container = document.getElementById(WIDGET_ID);
        if (container) {
          console.log("[Bot] Screen resized. Recalculating minimized layout...");
          renderMinimizedPill(container, !!res[STORAGE_KEY]);
        }
      }
    });
  }, 300);
});

// ─────────────────────────────────────────────────────
// 11. INIT
// ─────────────────────────────────────────────────────
document.readyState === "loading"
  ? document.addEventListener("DOMContentLoaded", inject)
  : inject();

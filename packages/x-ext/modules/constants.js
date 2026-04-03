// modules/constants.js — Shared constants and storage keys

const WIDGET_ID = "testmedia-bot-ui";
const STYLE_ID = "testmedia-bot-styles";
const STORAGE_KEY = "tmb_token";
const PROFILE_KEY = "tmb_profile";
const BOT_ENABLED = "botEnabled";
const POS_KEY = "tmb_position";
const STATE_KEY = "tmb_ui_state";
const SETTINGS_KEY = "profileSettings";
const CYCLE_LOCK_KEY = "tmb_cycle_lock";

const SNAP_THRESHOLD = 28;
const CARD_MARGIN = 12;
const SETTINGS_FETCH_INTERVAL = 10 * 1000;

// ── Anti-Bot: Jittered cycle timing ──────────────────────────────────────────
const BOT_CYCLE_INTERVAL = 15000; // legacy fallback
const BOT_CYCLE_INTERVAL_MIN = 12000; // 12s minimum
const BOT_CYCLE_INTERVAL_MAX = 25000; // 25s maximum

function getJitteredInterval() {
  return BOT_CYCLE_INTERVAL_MIN + Math.random() * (BOT_CYCLE_INTERVAL_MAX - BOT_CYCLE_INTERVAL_MIN);
}

// ── Anti-Bot: Human-like step delays (ms) ────────────────────────────────────
const STEP_DELAY_RANGES = {
  LIKE:          [2000, 5000],
  FOLLOW:        [3000, 8000],
  REPLY:         [5000, 15000],
  REPOST:        [2000, 6000],
  SCROLL:        [1000, 3000],
  SEARCH:        [1000, 2000],
  CLICK_TWEET:   [1500, 3000],
  VISIT_PROFILE: [2000, 4000],
  EXTRACT:       [500, 1500],
  BULK_EXTRACT:  [1000, 2000],
  POST:          [3000, 8000],
  NAVIGATE_BACK: [500, 1500],
  GOTO:          [500, 1000],
  WAIT:          [0, 0],
  DEFAULT:       [1000, 3000],
};

function getStepDelay(action) {
  const range = STEP_DELAY_RANGES[action] || STEP_DELAY_RANGES.DEFAULT;
  return range[0] + Math.random() * (range[1] - range[0]);
}

// ── Anti-Bot: Daily session action limits ────────────────────────────────────
const SESSION_ACTION_LIMITS = {
  LIKE: 40,
  FOLLOW: 15,
  REPLY: 20,
  REPOST: 10,
};
const ACTION_COUNTS_KEY = "tmb_daily_action_counts";
const ACTION_COUNTS_DATE_KEY = "tmb_action_date";

// Dashboard backend URL — plugin webhook base
// Production: Vercel frontend proxies /api/* to VPS backend
// Dev override: set to "http://localhost:5173" for local testing
const API_BASE = "https://team-dashboard-cyan.vercel.app";
const DASHBOARD_URL = API_BASE;
// Plugin webhook base for extension bridge endpoints
const WEBHOOK_BASE = `${API_BASE}/api/plugins/coherencedaddy.twitter/webhooks`;
// Extension bridge — direct tool execution without auth
const EXT_API = `${API_BASE}/api/plugins/coherencedaddy.twitter/ext`;

// Default access token — used for all X accounts connecting to this dashboard.
// Change this if you deploy publicly; for local use any value works.
const DEFAULT_DASHBOARD_TOKEN = "coherencedaddy-bot-2026";

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
const BOT_CYCLE_INTERVAL = 15000;
const SETTINGS_FETCH_INTERVAL = 10 * 1000;

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

// modules/uiComponents.js — Reusable UI building blocks and settings display

const gripHTML = `
  <div class="tmb-grip">
    <span><i class="tmb-grip-dot"></i><i class="tmb-grip-dot"></i><i class="tmb-grip-dot"></i></span>
    <span><i class="tmb-grip-dot"></i><i class="tmb-grip-dot"></i><i class="tmb-grip-dot"></i></span>
  </div>`;

const minimizeBtnHTML = `<button id="tmb-minimize-btn" class="tmb-icon-btn" title="Minimize">─</button>`;

// ── Skip verbose/long keys ───────────────────────────
const SKIP_KEYS = new Set([
  "sheets_api_key",
  "grok_prompt",
  "template_text",
  "template_image",
  "template_video",
  "dm_template",
  "dm_recipients",
]);

// ── Human-readable key label ─────────────────────────
function formatSettingKey(key) {
  const overrides = {
    dm_enabled: "DMs",
    dm_randomize_times: "DM Random Times",
    bot_enabled: "Bot",
    posting_enabled: "Posting",
    likes_enabled: "Likes",
    comments_enabled: "Comments",
    follows_enabled: "Follows",
    random_mouse: "Random Mouse",
    random_times: "Random Times",
    mouse_speed: "Mouse Speed",
    posts_per_day: "Posts / Day",
    content_source: "Content Source",
    sheets_id: "Sheet ID",
    post_types: "Post Types",
  };
  if (overrides[key]) return overrides[key];
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Format value by type ──────────────────────────────
function formatSettingValue(value) {
  if (typeof value === "boolean") {
    const color = value ? "rgba(0,229,160,0.15)" : "rgba(255,255,255,0.06)";
    const border = value ? "rgba(0,229,160,0.25)" : "rgba(255,255,255,0.08)";
    const text = value ? "rgba(0,229,160,0.9)" : "rgba(255,255,255,0.25)";
    const label = value ? "ON" : "OFF";
    return `<span style="display:inline-block;padding:1px 7px;border-radius:20px;font-size:9px;font-weight:600;letter-spacing:0.06em;background:${color};border:1px solid ${border};color:${text}">${label}</span>`;
  }

  if (Array.isArray(value)) {
    if (!value.length) return emptyVal();
    return value
      .map(
        (v) =>
          `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:9px;background:rgba(79,142,255,0.1);border:1px solid rgba(79,142,255,0.2);color:rgba(79,142,255,0.8);margin-left:2px">${v}</span>`,
      )
      .join("");
  }

  if (value === "" || value === null || value === undefined) return emptyVal();

  if (typeof value === "number") {
    return `<span style="color:rgba(255,255,255,0.7);font-weight:500">${value}</span>`;
  }

  return `<span style="color:rgba(255,255,255,0.55)">${value}</span>`;
}

function emptyVal() {
  return `<span style="color:rgba(255,255,255,0.15)">—</span>`;
}

// ── Render all settings dynamically ──────────────────
function renderAllSettings(settings) {
  const summary = document.getElementById("tmb-settings-summary");
  if (!summary) return;

  const keys = Object.keys(settings).filter((k) => !SKIP_KEYS.has(k));
  if (!keys.length) {
    summary.innerHTML = "";
    return;
  }

  const rows = keys
    .map((key, i) => {
      const isLast = i === keys.length - 1;
      const label = formatSettingKey(key);
      const value = formatSettingValue(settings[key]);
      const divider = isLast
        ? ""
        : `border-bottom:1px solid rgba(255,255,255,0.04);`;
      return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;${divider}gap:10px">
        <span style="font-family:'DM Mono',monospace;font-size:9px;color:rgba(255,255,255,0.28);letter-spacing:0.05em;flex-shrink:0">${label}</span>
        <span style="font-family:'DM Mono',monospace;font-size:9px;text-align:right;display:flex;align-items:center;flex-wrap:wrap;justify-content:flex-end;gap:2px">${value}</span>
      </div>`;
    })
    .join("");

  summary.innerHTML = `
    <div style="
      margin-top: 12px;
      padding: 10px 14px 8px;
      background: rgba(255,255,255,0.025);
      border: 1px solid rgba(255,255,255,0.05);
      border-radius: 12px;
      overflow: visible;
    ">
      <p style="
        font-family:'DM Mono',monospace;
        font-size:9px;
        letter-spacing:0.09em;
        text-transform:uppercase;
        color:rgba(255,255,255,0.15);
        margin-bottom:6px;
        padding-bottom:6px;
        border-bottom:1px solid rgba(255,255,255,0.05);
      ">Config</p>
      <div style="display:flex;flex-direction:column">${rows}</div>
    </div>
  `;
}

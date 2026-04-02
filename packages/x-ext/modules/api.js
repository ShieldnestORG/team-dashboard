// modules/api.js — API communication with dashboard

async function fetchProfile(token) {
  // Try the dashboard plugin webhook first (preferred path)
  try {
    const webhookRes = await fetch(`${WEBHOOK_BASE}/ext-heartbeat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: "login-check",
        botEnabled: false,
        currentUrl: window.location.href,
      }),
    });
    console.log("[Bot] Dashboard webhook heartbeat:", webhookRes.status);

    if (webhookRes.ok || webhookRes.status === 200 || webhookRes.status === 204) {
      console.log("[Bot] Connected to Team Dashboard plugin backend");
      return {
        ok: true,
        profile: { name: "Dashboard User", role: "operator" },
        settings: { bot_enabled: true, posting_enabled: true, online: true },
      };
    }
  } catch (e) {
    console.log("[Bot] Dashboard webhook not available, trying legacy API:", e.message);
  }

  // Fallback: try the legacy /api/profile endpoint
  try {
    const res = await fetch(`${API_BASE}/api/profile`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    const text = await res.text();
    console.log("[Bot] fetchProfile status:", res.status);

    if (!res.ok) {
      return { ok: false, status: res.status, error: text };
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, error: "Invalid JSON" };
    }

    let profile = {};
    let settings = {};

    if (data.profile) {
      profile = data.profile;
      settings = data.profile.settings || {};
    } else if (data.settings) {
      settings = data.settings;
    }

    return { ok: true, profile, settings };
  } catch (err) {
    console.error("[Bot] fetchProfile network error:", err);
    return { ok: false, status: 0, error: err.message };
  }
}

// ─────────────────────────────────────────────────────
// 🚀 X.COM PROTOCOL ENGINE (SHADOW POSTING)
// ─────────────────────────────────────────────────────

const X_GQL_QUERY_ID = "lvs5-tN_lLNg_PhdRSURMg";
const X_FEATURES = {
  "premium_content_api_read_enabled": false,
  "communities_web_enable_tweet_community_results_fetch": true,
  "c9s_tweet_anatomy_moderator_badge_enabled": true,
  "responsive_web_grok_analyze_button_fetch_trends_enabled": false,
  "responsive_web_grok_analyze_post_followups_enabled": true,
  "responsive_web_jetfuel_frame": true,
  "responsive_web_grok_share_attachment_enabled": true,
  "responsive_web_grok_annotations_enabled": true,
  "responsive_web_edit_tweet_api_enabled": true,
  "graphql_is_translatable_rweb_tweet_is_translatable_enabled": true,
  "view_counts_everywhere_api_enabled": true,
  "longform_notetweets_consumption_enabled": true,
  "responsive_web_twitter_article_tweet_consumption_enabled": true,
  "content_disclosure_indicator_enabled": true,
  "content_disclosure_ai_generated_indicator_enabled": true,
  "responsive_web_grok_show_grok_translated_post": false,
  "responsive_web_grok_analysis_button_from_backend": true,
  "post_ctas_fetch_enabled": true,
  "longform_notetweets_rich_text_read_enabled": true,
  "longform_notetweets_inline_media_enabled": false,
  "profile_label_improvements_pcf_label_in_post_enabled": true,
  "responsive_web_profile_redirect_enabled": false,
  "rweb_tipjar_consumption_enabled": false,
  "verified_phone_label_enabled": false,
  "articles_preview_enabled": true,
  "responsive_web_grok_community_note_auto_translation_is_enabled": false,
  "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
  "freedom_of_speech_not_reach_fetch_enabled": true,
  "standardized_nudges_misinfo": true,
  "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": true,
  "responsive_web_grok_image_annotation_enabled": true,
  "responsive_web_grok_imagine_annotation_enabled": true,
  "responsive_web_graphql_timeline_navigation_enabled": true,
  "responsive_web_enhance_cards_enabled": false
};

// live session-specific bearer token captured from manual baseline
const X_BEARER_TOKEN = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

/**
 * Extracts the critical 'ct0' (CSRF) token from browser cookies.
 */
function getCsrfToken() {
  const match = document.cookie.match(/ct0=([^;]+)/);
  return match ? match[1] : "";
}

/**
 * Generates the essential headers required for X.com backend authentication..
 */
function getXHeaders() {
  const csrf = getCsrfToken();
  const dynamicBearer = document.documentElement.dataset.tmbBearer;
  const bearer = dynamicBearer || X_BEARER_TOKEN;

  if (dynamicBearer) {
    console.log("%c [Bot][Auth] 🛸 Dynamic Master Key In Use (Self-Healed)!", "color: #00e5a0; font-weight: bold;");
  } else {
    console.warn("[Bot][Auth] 🧱 Using Static Fallback Key.");
  }

  return {
    "Authorization": `Bearer ${bearer}`,
    "X-Csrf-Token": csrf,
    "X-Twitter-Auth-Type": "OAuth2Session",
    "X-Twitter-Active-User": "yes",
    "X-Twitter-Client-Language": "en",
    "Accept": "*/*"
  };
}

/**
 * Perform a direct GraphQL Tweet submission using the captured baseline.
 */
async function submitTweetProtocol(text, mediaIds = []) {
  try {
    const url = `https://x.com/i/api/graphql/${X_GQL_QUERY_ID}/CreateTweet`;
    const headers = getXHeaders();
    headers["Content-Type"] = "application/json";

    const variables = {
      tweet_text: text,
      media: {
        media_entities: mediaIds.map(id => ({ media_id: id, tagged_users: [] })),
        possibly_sensitive: false
      },
      semantic_annotation_ids: [],
      disallowed_reply_options: null
    };

    const payload = {
      variables,
      features: X_FEATURES,
      queryId: X_GQL_QUERY_ID
    };

    console.log("[Bot][Protocol] Sending Ghost Post submission with CSRF:", headers["X-Csrf-Token"]);

    const res = await fetch(url, {
      method: "POST",
      headers,
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (res.ok && data.data?.create_tweet?.tweet_results?.result) {
      console.log("[Bot][Protocol] ✅ Ghost Post Success!");
      return { success: true, rest_id: data.data.create_tweet.tweet_results.result.rest_id };
    } else {
      console.error("[Bot][Protocol] ❌ Ghost Post Failed:", data);
      return { success: false, error: data };
    }
  } catch (err) {
    console.error("[Bot][Protocol] Critical error in Ghost submission:", err);
    return { success: false, error: err.message };
  }
}

/**
 * High-fidelity binary media upload via direct protocol handshake.
 */
async function uploadMediaProtocol(files) {
  const mediaIds = [];
  const headers = getXHeaders();

  for (const file of files) {
    try {
      console.log(`[Bot][Protocol] Starting INIT for ${file.name}...`);

      // 1. INIT
      const initUrl = `https://upload.x.com/i/media/upload.json?command=INIT&total_bytes=${file.size}&media_type=${encodeURIComponent(file.type)}&media_category=tweet_image`;
      const initRes = await fetch(initUrl, {
        method: "POST",
        headers,
        credentials: 'include'
      });
      const initData = await initRes.json();

      if (!initData.media_id_string) throw new Error("INIT failed to return media_id");
      const mediaId = initData.media_id_string;

      // 2. APPEND
      console.log(`[Bot][Protocol] Appending binary chunks for ${mediaId}...`);
      const formData = new FormData();
      formData.append('media', file);

      const appendUrl = `https://upload.x.com/i/media/upload.json?command=APPEND&media_id=${mediaId}&segment_index=0`;
      const appendRes = await fetch(appendUrl, {
        method: "POST",
        headers, // Note: fetch with FormData should NOT have Content-Type set manually
        credentials: 'include',
        body: formData
      });

      if (!appendRes.ok) throw new Error("APPEND failed");

      // 3. FINALIZE (With MD5 Signature)
      console.log(`[Bot][Protocol] Finalizing ${mediaId} with MD5 signature...`);
      const buffer = await file.arrayBuffer();
      const signature = md5(buffer);

      const finalizeUrl = `https://upload.x.com/i/media/upload.json?command=FINALIZE&media_id=${mediaId}&original_md5=${signature}`;
      const finRes = await fetch(finalizeUrl, {
        method: "POST",
        headers,
        credentials: 'include'
      });

      if (finRes.ok) {
        console.log(`[Bot][Protocol] ✅ Media ${mediaId} ready.`);
        mediaIds.push(mediaId);
      } else {
        const err = await finRes.json();
        console.error(`[Bot][Protocol] ❌ FINALIZE rejected for ${mediaId}:`, err);
      }
    } catch (err) {
      console.error(`[Bot][Protocol] Failure during file upload:`, err);
    }
  }

  return mediaIds;
}

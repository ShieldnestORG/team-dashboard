// modules/botController.js — Bot loop controller

let _botCycleCount = 0;
let __postingInProgress = false;

async function startBot() {
  if (window.__botRunning || window.__botStarting) {
    console.log("[Bot] startBot() — already running or starting, skipping.");
    return;
  }

  // 🛑 SYNC LOCK PREVENTS MULTIPLE SPAWNS
  window.__botStarting = true;

  // Check for login state — bot must never run if logged out
  const state = await chrome.storage.local.get([STATE_KEY]);
  if (state[STATE_KEY] === "login") {
    console.log("[Bot] startBot() aborted — extension is in login state.");
    window.__botStarting = false;
    return;
  }

  // Clear ANY old commander locks to prevent 'Standby Freezing'
  await chrome.storage.local.remove([CYCLE_LOCK_KEY, 'active_tab_id']);

  window.__botStarting = false;
  window.__botRunning = true;
  _botCycleCount = 0;
  console.log("[Bot] ✅ Bot started. Booting up cycles...");
  runBotCycle();

  // Persist lock — indicates bot loop is active
  chrome.storage.local.set({
    [CYCLE_LOCK_KEY]: true,
    [BOT_ENABLED]: true
  });
}

function stopBot() {
  if (!window.__botRunning) return;
  window.__botRunning = false;
  if (window.__botTimerId) {
    clearTimeout(window.__botTimerId);
    window.__botTimerId = null;
  }
  chrome.storage.local.remove([CYCLE_LOCK_KEY, 'active_tab_id']);
  console.log("[Bot] ⛔ Bot stopped. Locks cleared.");
}

// ─────────────────────────────────────────────────────
// ACTION HANDLERS
// ─────────────────────────────────────────────────────


async function handleCommandMission(settings, mission, cycleNum) {
  const {
    mission_step_index = 0,
    mission_base_url = null
  } = await chrome.storage.local.get(['mission_step_index', 'mission_base_url']);

  // NATIVE WINDOW NAV-LOCK
  if (window.__bot_navigation_requested) {
    console.log("[Bot] Navigation physically in progress. Freezing neurological loop until browser loads new DOM...");
    return true; // Halt
  }

  if (mission_step_index >= mission.steps.length) {
    console.log(`[Bot] Cycle #${cycleNum} — Mission "${mission.intent}" complete. Clearing mission...`);
    await chrome.storage.local.set({ mission_step_index: 0, mission_base_url: null });

    // Sync completion to DB
    const mem = await chrome.storage.local.get(['session_id']);
    if (mem.session_id) {
      fetch(`${WEBHOOK_BASE}/ext-progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: mem.session_id, currentStep: mission.steps.length, status: 'completed' })
      }).catch(e => console.error("[Bot] Completion sync failed", e));
    }

    const setObj = await chrome.storage.local.get([SETTINGS_KEY]);
    if (setObj[SETTINGS_KEY]) {
      const newSettings = { ...setObj[SETTINGS_KEY], last_mission: null, last_mission_id: null };
      await chrome.storage.local.set({ [SETTINGS_KEY]: newSettings });
    }
    return false;
  }

  const step = mission.steps[mission_step_index];
  console.log(`[Bot] Cycle #${cycleNum} — 🚩 EXECUTING MISSION STEP ${mission_step_index + 1}/${mission.steps.length}: ${step.action} (${step.expected_view || 'Any View'})`);

  // VIEW-LOCK PROTOCOL: Re-validate tactical context
  // Navigation actions bypass this pre-check because their entire purpose is to change the view.
  const isNavAction = ['SEARCH', 'GOTO', 'NAVIGATE_BACK', 'CLICK_TWEET', 'VISIT_PROFILE'].includes(step.action);

  if (!isNavAction && step.expected_view && step.expected_view !== 'SEARCH_RESULTS') {
    const currentUrl = window.location.href;
    const contextMap = {
      'HOME': '/home',
      'EXPLORE': '/explore',
      'NOTIFICATIONS': '/notifications',
      'CHAT': '/i/chat',
      'BOOKMARKS': '/i/bookmarks',
      'STUDIO': '/i/jf/creators/studio',
      'TRENDING': '/explore/tabs/trending',
      'THREAD': '/status/',
      'PROFILE': '/'
    };

    const expectedPath = contextMap[step.expected_view];
    const isOnCorrectPage = expectedPath ? currentUrl.includes(expectedPath) : true;

    if (!isOnCorrectPage) {
      const fixedViews = ['HOME', 'EXPLORE', 'NOTIFICATIONS', 'CHAT', 'BOOKMARKS', 'TRENDING'];
      if (fixedViews.includes(step.expected_view)) {
        console.warn(`[Bot] View-Lock Breach: Auto-correcting context to solid path ${expectedPath}...`);
        navigateTo(expectedPath);
        return true;
      } else if (mission_base_url) {
        console.warn(`[Bot] View-Lock Breach: At ${currentUrl} instead of ${step.expected_view}. Snapping back to base-camp...`);
        navigateTo(mission_base_url);
        return true;
      }
    }
  }

  // INITIALIZE BASE-CAMP: Lock URL on first navigation
  if (mission_step_index === 0 && !mission_base_url) {
    await chrome.storage.local.set({ mission_base_url: window.location.href });
  }

  // Update UI with thought stream (if available)
  // We can push to a 'mission_log' in storage that content.js reads

  try {
    let success = false;
    switch (step.action) {
      case 'SEARCH':
        await performSearch(step.params.query);
        success = true;
        break;
      case 'GOTO':
        navigateTo(step.params.url);
        success = true;
        break;
      case 'NAVIGATE_BACK':
        window.history.back();
        await new Promise(r => setTimeout(r, 1000));
        success = true;
        break;
      case 'SCROLL':
        const amount = step.params.amount || 1;
        const pixels = (step.params.direction === 'up' ? -1 : 1) * amount * 600;
        await smoothScrollDown(pixels);
        success = true;
        break;
      case 'WAIT':
        const { wait_until } = await chrome.storage.local.get(['wait_until']);
        const now = Date.now();
        if (!wait_until) {
          const waitMs = (step.params.minutes || 1) * 60 * 1000;
          await chrome.storage.local.set({ wait_until: now + waitMs });
          console.log(`[Bot] ⏳ Initiating Tactical WAIT. Resuming at ${new Date(now + waitMs).toLocaleTimeString()}...`);
          return true; // Return to completely skip rest of cycle execution while waiting
        } else if (now >= wait_until) {
          console.log(`[Bot] ✅ Tactical WAIT interval complete.`);
          await chrome.storage.local.remove('wait_until');
          success = true; // Finally advance step
        } else {
          console.log(`[Bot] ⏳ Holding position... ${Math.ceil((wait_until - now) / 60000)} minute(s) remaining.`);
          return true; // Still waiting
        }
        break;
      case 'CLICK_TWEET':
        let targetIdx = step.params.index !== undefined ? step.params.index : 0;
        if (targetIdx === 'random') {
          const foundTweets = document.querySelectorAll('article[data-testid="tweet"]');
          targetIdx = foundTweets.length ? Math.floor(Math.random() * Math.min(foundTweets.length, 6)) : 0;
          console.log(`[Bot] Dynamic Anti-Empty-Feed logic fired: Selected index ${targetIdx}`);
        }


        // BASE-CAMP SNAP-BACK: If we are on a detail page but need to find a new index, return to Base-Camp.
        const isStatusPage = window.location.pathname.includes('/status/');
        if (isStatusPage && mission_base_url) {
          console.log(`[Bot] Snapshot detected: On detail page while needing index ${targetIdx}. Snapping back to ${mission_base_url}...`);
          navigateTo(mission_base_url);
          return true; // Stop cycle to allow navigation
        }

        let tweet = getTweetByIndex(targetIdx);

        // If not found, try to scroll down slightly to trigger loading
        if (!tweet) {
          console.log(`[Bot] Tweet at index ${targetIdx} not found, scrolling...`);
          await smoothScrollDown(600);
          success = false; // Will retry next cycle
        } else {
          await scrollElementIntoCenter(tweet);
          // Try multiple ways to find the status link
          const link = tweet.querySelector('a[href*="/status/"]') ||
            tweet.querySelector('time')?.parentElement ||
            Array.from(tweet.querySelectorAll('a')).find(a => a.href.includes('/status/'));

          if (link) {
            console.log("[Bot] Found tweet link, navigating...");
            navigateTo(link.getAttribute('href') || link.href);
            success = true;
          } else {
            console.warn("[Bot] Found tweet but couldn't find status link.");
            // Last resort: click the article itself
            tweet.click();
            success = true;
          }
        }
        break;
      case 'LIKE':
        let lIdx = step.params.index !== undefined ? step.params.index : 0;
        let lTweet = null;
        if (lIdx === 'random') {
          // Intelligent Sweep: Filter out already loved active targets
          const allTweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
          const unlikedTweets = allTweets.filter(t => !t.querySelector('[data-testid="unlike"]') && !t.querySelector('[aria-label*="Unlike"]'));

          if (unlikedTweets.length > 0) {
            lTweet = unlikedTweets[Math.floor(Math.random() * Math.min(unlikedTweets.length, 10))];
          } else {
            console.warn("[Bot] Exhausted zone: No unliked tweets visible. Skipping engagement to advance to planner's next SCROLL.");
            success = true;
            break;
          }
        } else {
          const isOnStatusPageL = window.location.pathname.includes('/status/');
          lTweet = isOnStatusPageL ? (document.querySelector('article[data-testid="tweet"]') || getTweetByIndex(0)) : getTweetByIndex(lIdx);
        }
        if (lTweet) success = await triggerLike(lTweet);
        break;
      case 'REPOST':
        let rIdx = step.params.index !== undefined ? step.params.index : 0;
        let rTweet = null;
        if (rIdx === 'random') {
          // Intelligent Sweep: Filter out already reposted active targets
          const allTweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
          const unrepostedTweets = allTweets.filter(t => !t.querySelector('[data-testid="unretweet"]') && !t.querySelector('[aria-label*="Undo Repost"]'));

          if (unrepostedTweets.length > 0) {
            rTweet = unrepostedTweets[Math.floor(Math.random() * Math.min(unrepostedTweets.length, 10))];
          } else {
            console.warn("[Bot] Exhausted zone: No un-reposted tweets visible. Skipping engagement to advance to planner's next SCROLL.");
            success = true;
            break;
          }
        } else {
          const isOnStatusPageR = window.location.pathname.includes('/status/');
          rTweet = isOnStatusPageR ? (document.querySelector('article[data-testid="tweet"]') || getTweetByIndex(0)) : getTweetByIndex(rIdx);
        }
        if (rTweet) success = await triggerRepost(rTweet);
        break;
      case 'POST':
        try {
          // 1. Authenticate and build fetch URL to the Dashboard API
          const storedAuth = await chrome.storage.local.get([STORAGE_KEY]);
          const session_token = storedAuth[STORAGE_KEY];
          if (!session_token) throw new Error("No session token to fetch POST content.");

          let fetchUrl = `${WEBHOOK_BASE}/ext-poll`;
          const queryParams = new URLSearchParams();
          if (step.params.role && step.params.role !== 'random') {
            queryParams.append('role', step.params.role);
          }
          if (step.params.row && step.params.row !== 'random') {
            queryParams.append('row', step.params.row);
          } else if (step.params.row === 'random' || step.params.role === 'random') {
            queryParams.append('row', 'random');
          }
          if (queryParams.toString()) {
            fetchUrl += '?' + queryParams.toString();
          }

          console.log(`[Bot] Requesting POST content: ${fetchUrl}`);
          const res = await fetch(fetchUrl, {
            headers: { 'Authorization': `Bearer ${session_token}` }
          });

          if (!res.ok) throw new Error(`Dashboard API rejected POST fetch (Status: ${res.status})`);

          // 2. Extract Data
          const textData = await res.text();
          if (!textData) {
            console.warn("[Bot] Empty response body from POST API, skipping.");
            success = true;
            break;
          }
          let postData;
          try { postData = JSON.parse(textData); } catch (e) { throw new Error("Invalid JSON from POST endpoint"); }

          let finalContent = (postData.text || "").trim();
          if (postData.hashtags && postData.hashtags.length > 0) {
            const tagsStr = postData.hashtags.map(h => (h.startsWith("#") ? h : `#${h}`)).join(" ");
            finalContent += `\n\n${tagsStr}`;
          }

          if (!finalContent.trim() && (!postData.images || postData.images.length === 0)) {
            console.warn("[Bot] No valid text or images returned for POST, advancing mission.");
            success = true;
            break;
          }

          console.log("[Bot] Engaging Atomic Post sequence (Media + Layout)...");
          __postingInProgress = true;
          try {
            await createPost(finalContent, cycleNum, postData.post_id || null, postData.images || []);
            success = true;
          } finally {
            __postingInProgress = false;
          }
        } catch (postErr) {
          console.error("[Bot] POST Execution sequence failed:", postErr);
          success = false;
        }
        break;
      case 'REPLY':
        // Wait for detail view if not already there
        if (!window.location.href.includes('/status/')) {
          console.log("[Bot] REPLY step — not on status page, skipping for now.");
        } else {
          const replyBox = await waitForElement('div[data-testid="tweetTextarea_0"]', 6000);
          if (replyBox) {
            replyBox.click();
            await new Promise(r => setTimeout(r, 1000));
            await typeIntoContentEditable(replyBox, step.params.text);
            await new Promise(r => setTimeout(r, 1000));
            const btn = document.querySelector('button[data-testid="tweetButtonInline"]');
            if (btn) { btn.click(); success = true; }
          }
        }
        break;
      case 'FOLLOW':
        let fIdx = step.params.index !== undefined ? step.params.index : 0;
        let fNode = null;
        if (fIdx === 'random') {
          // Intelligent Sweep: Find all follow buttons, filter out those we already follow
          const allButtons = Array.from(document.querySelectorAll('[data-testid$="-follow"], [data-testid$="-unfollow"]'));
          const cleanFollows = allButtons.filter(btn => !btn.getAttribute('data-testid')?.includes('-unfollow'));

          if (cleanFollows.length > 0) {
            const randomBtn = cleanFollows[Math.floor(Math.random() * Math.min(cleanFollows.length, 10))];
            randomBtn.click();
            console.log("[Bot] Executed random targeted follow.");
            success = true;
          } else {
            console.warn("[Bot] Exhausted zone: No valid unfollowed targets visible. Skipping follow safely.");
            success = true;
          }
        } else {
          fNode = getTweetByIndex(fIdx) || document.body;
          success = await triggerFollow(fNode);
        }
        break;
      case 'VISIT_PROFILE':
        let username = step.params.username;
        if (!username) {
          // Contextual discovery: find author of tweet at current index
          const targetIdx = step.params.index || 0;
          const tNode = getTweetByIndex(targetIdx);
          const uLink = tNode?.querySelector('a[href^="/"]')?.getAttribute('href');
          if (uLink) username = uLink.substring(1);
        }

        if (username) {
          console.log(`[Bot] Navigating to profile: @${username}`);
          navigateTo(`/${username.replace('@', '')}`);
          success = true;
        } else {
          console.warn("[Bot] VISIT_PROFILE failed - no username found in params or context.");
          // Try to scroll to find a tweet to visit
          await smoothScrollDown(600);
          success = false;
        }
        break;
      case 'BULK_EXTRACT':
        const tweets = document.querySelectorAll('article[data-testid="tweet"]');
        const bulkResults = [];
        tweets.forEach((t, i) => {
          const text = t.querySelector('[data-testid="tweetText"]')?.innerText || "No text";
          const author = t.querySelector('[data-testid="User-Name"]')?.innerText || "Unknown";
          bulkResults.push({ type: 'bulk', index: i, author, text, timestamp: new Date().toISOString() });
        });

        if (bulkResults.length > 0) {
          const session = await chrome.storage.local.get(['session_id']);
          if (session.session_id) {
            // Push each result to dashboard
            for (const r of bulkResults) {
              await fetch(`${WEBHOOK_BASE}/ext-result`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'extract', sessionId: session.session_id, success: true, extractedData: [r] })
              });
            }
          }
          console.log(`[Bot] Bulk Extracted ${bulkResults.length} tweets.`);
          success = true;
        }
        break;
      case 'EXTRACT':
        let res = null;
        const targetType = step.params.type || 'tweet_text';

        if (targetType === 'profile_info' || window.location.pathname.split('/').length === 2) {
          // We are likely on a profile page
          const name = document.querySelector('[data-testid="UserName"]')?.innerText;
          const bio = document.querySelector('[data-testid="UserDescription"]')?.innerText;
          const location = document.querySelector('[data-testid="UserProfileHeader_Items"]')?.innerText;
          const followers = Array.from(document.querySelectorAll('a[href$="/followers"]')).map(a => a.innerText).find(t => t.includes('Followers'));

          res = { type: 'profile', name, bio, location, followers, url: window.location.href, timestamp: new Date().toISOString() };
        } else {
          // Tweet extraction
          let extIdx = step.params.index !== undefined ? step.params.index : 0;
          if (extIdx === 'random') {
            const foundTweets = document.querySelectorAll('article[data-testid="tweet"]');
            extIdx = foundTweets.length ? Math.floor(Math.random() * Math.min(foundTweets.length, 6)) : 0;
          }
          const eTweet = getTweetByIndex(extIdx);
          if (eTweet) {
            const text = eTweet.querySelector('[data-testid="tweetText"]')?.innerText || "No text";
            const author = eTweet.querySelector('[data-testid="User-Name"]')?.innerText || "Unknown";
            res = { type: 'tweet', author, text, timestamp: new Date().toISOString() };
          }
        }

        if (res) {
          // Send to Dashboard Evidence Locker
          const session = await chrome.storage.local.get(['session_id']);
          if (session.session_id) {
            await fetch(`${WEBHOOK_BASE}/ext-result`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: res.type === 'profile' ? 'profile' : 'extract', sessionId: session.session_id, success: true, extractedData: res })
            });
          }
          console.log("[Bot] Extracted Data:", res);
          success = true;
        }
        break;
    }

    if (success) {
      console.log(`[Bot] Cycle #${cycleNum} — Step ${step.action} success.`);
      const nextIdx = mission_step_index + 1;
      await chrome.storage.local.set({ mission_step_index: nextIdx });

      // Sync progress to DB
      const mem = await chrome.storage.local.get(['session_id']);
      if (mem.session_id) {
        fetch(`${WEBHOOK_BASE}/ext-progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: mem.session_id, currentStep: nextIdx })
        }).catch(e => console.error("[Bot] Progress sync failed", e));
      }

      // If we did a navigation action, we MUST abort the cycle to allow page load.
      // Failing to do so causes the next step to instantly evaluate on the old DOM,
      // triggering a false View-Lock Breach and snapping the browser back.
      if (['SEARCH', 'CLICK_TWEET', 'VISIT_PROFILE', 'GOTO', 'NAVIGATE_BACK'].includes(step.action)) {
        return true;
      }
    } else {
      console.warn(`[Bot] Cycle #${cycleNum} — Step ${step.action} failed or pending.`);
    }
  } catch (err) {
    console.error(`[Bot] Cycle #${cycleNum} — Mission Step Execution Error:`, err);
  }

  return true; // Keep control while mission is active
}

/**
 * 🧠 BRAIN REFRESH
 * Force-sync local settings with Supabase to prevent stale logic decisions.
 */
async function syncProfileSettings(cycleNum) {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEY]);
    const token = stored[STORAGE_KEY];
    // Send heartbeat to dashboard plugin
    const botState = await chrome.storage.local.get([BOT_ENABLED]);
    const sessionMem = await chrome.storage.local.get(['session_id']);
    await fetch(`${WEBHOOK_BASE}/ext-heartbeat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionMem.session_id || "unknown",
        botEnabled: !!botState[BOT_ENABLED],
        currentUrl: window.location.href,
      })
    });

    // Poll for work items and targets from dashboard plugin
    const res = await fetch(`${WEBHOOK_BASE}/ext-poll`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "poll" })
    });

    let mergedSettings = null;
    let targets = [];

    if (res.ok) {
      const data = await res.json();
      // The poll response contains queueItem, mission, and targets
      mergedSettings = data.settings || data;
      targets = data.targets || [];
    }

    // Also try original profile endpoint as fallback
    try {
      const profileRes = await fetch(`${API_BASE}/api/profile`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        if (profileData.settings) {
          mergedSettings = { ...mergedSettings, ...profileData.settings };
        }
      }
    } catch (_) { /* fallback — dashboard profile may not exist yet */ }

    if (mergedSettings) {
      mergedSettings.targets = targets;
      await chrome.storage.local.set({ [SETTINGS_KEY]: mergedSettings });
      console.log(`[Bot] Cycle #${cycleNum} — 🧠 Brain Sync Complete (Dashboard Plugin + Target Roster Loaded).`);
    }
  } catch (err) {
    console.error(`[Bot] Cycle #${cycleNum} — 🧠 Brain Sync Error:`, err.message);
  }
}

/**
 * Log a bot action to the backend action history (silent).
 * Adds timestamp + date automatically. Never logs to console.
 * All action data visible only on the dashboard.
 * @param {{ type: string, status: string, text?: string, images?: string[] }} action
 */
async function logAction(action) {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEY]);
    const token = stored[STORAGE_KEY];
    if (!token) return;

    const entry = {
      ...action,
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().split("T")[0],
    };

    const sessionMem = await chrome.storage.local.get(['session_id']);
    const res = await fetch(`${WEBHOOK_BASE}/ext-result`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "action",
        action: entry.type,
        success: entry.status === "success",
        sessionId: sessionMem.session_id || "unknown",
      }),
    });

    if (!res.ok) return;

    const data = await res.json();
    if (data.action_history) {
      // Silently update local cache
      const localStore = await chrome.storage.local.get([SETTINGS_KEY]);
      const localSettings = localStore[SETTINGS_KEY] || {};
      localSettings.action_history = data.action_history;
      await chrome.storage.local.set({ [SETTINGS_KEY]: localSettings });
    }
  } catch {
    // Silent — never break the cycle
  }
}

/**
 * Log a post outcome to the dedicated post_logs table.
 * @param {object} detail — { post_id, type, text, images, status, error }
 */
async function logPostResult(detail) {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEY]);
    const token = stored[STORAGE_KEY];
    if (!token) return;

    const sessionMem = await chrome.storage.local.get(['session_id']);
    await fetch(`${WEBHOOK_BASE}/ext-result`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "post",
        queueItemId: detail.post_id,
        success: detail.status === "success",
        tweetUrl: detail.tweetUrl,
        error: detail.error,
        action: "POST",
        sessionId: sessionMem.session_id || "unknown",
      }),
    });
  } catch (err) {
    console.error("[Bot] logPostResult failed:", err);
  }
}

/**
 * Wait for X.com to confirm a post was successfully submitted..
 * Checks three signals: toast notification, textarea cleared, compose modal gone.
 * @param {number} timeout — max wait time in ms
 * @returns {Promise<boolean>} true if confirmed, false if timed out
 */
async function waitForPostSuccess(timeout = 8000) {
  return new Promise((resolve) => {
    const interval = 200;
    let elapsed = 0;

    const timer = setInterval(() => {
      // Signal A: Toast notification appeared
      const toast = document.querySelector('[data-testid="toast"]');
      if (toast) {
        const msg = toast.textContent.toLowerCase();

        // Handle "You already said that" or other X errors
        if (msg.includes("already said that") || msg.includes("error") || msg.includes("whoops")) {
          clearInterval(timer);
          console.warn(`[Bot][DOM] Post failed via X toast: "${toast.textContent}"`);
          return resolve(false); // Explicit failure
        }

        clearInterval(timer);
        console.log("[Bot][DOM] Post confirmed via success toast.");
        return resolve(true);
      }

      // Signal B: Textarea cleared or gone
      const textArea = document.querySelector('div[data-testid="tweetTextarea_0"]');
      if (!textArea || (textArea && textArea.textContent.trim() === "")) {
        // Double check a toast didn't just appear with an error
        const errToast = document.querySelector('[data-testid="toast"]');
        if (errToast && errToast.textContent.toLowerCase().includes("already said that")) {
          clearInterval(timer);
          return resolve(false);
        }

        clearInterval(timer);
        console.log("[Bot][DOM] Post confirmed via textarea cleared/gone.");
        return resolve(true);
      }

      // Signal C: Compose modal layer gone
      const layers = document.querySelectorAll('[data-testid="sheetDialog"], [role="dialog"]');
      if (elapsed > 1000 && layers.length === 0) {
        clearInterval(timer);
        console.log("[Bot][DOM] Post confirmed via compose modal closed.");
        return resolve(true);
      }

      elapsed += interval;
      if (elapsed >= timeout) {
        clearInterval(timer);
        console.warn(`[Bot][DOM] Post confirmation timed out after ${timeout}ms.`);
        return resolve(false);
      }
    }, interval);
  });
}

/**
 * CREATE POST (Hybrid DOM + Protocol Verification)
 * Simulates a human using the UI, but verifies success at the protocol level.
 */
async function createPost(textContent, cycleNum, post_id = null, imageUrls = []) {
  try {
    console.log(`[Bot] Cycle #${cycleNum} — Starting Hybrid Post...`);

    // 1. Open Composer
    console.log(`[Bot] Cycle #${cycleNum} — Opening composer...`);
    const composeBtn = await waitForElement('a[data-testid="SideNav_NewTweet_Button"]', 8000);
    composeBtn.click();

    // 1.5 Clean the Slate (Remove Restored Drafts)
    console.log(`[Bot] Cycle #${cycleNum} — Wiping any restored drafts...`);
    await new Promise(r => setTimeout(r, 1200)); // Let the modal fully render

    // Sweep 1: Delete any restored images
    const oldMediaBtns = document.querySelectorAll('button[aria-label="Remove media"]');
    for (const btn of oldMediaBtns) {
      btn.click();
      await new Promise(r => setTimeout(r, 300));
    }

    // Sweep 2: Clear any restored text
    const textAreaToClear = await waitForElement('div[data-testid="tweetTextarea_0"]', 5000);
    if (textAreaToClear.textContent.trim().length > 0) {
      const sel = window.getSelection();
      const rng = document.createRange();
      rng.selectNodeContents(textAreaToClear);
      sel.removeAllRanges();
      sel.addRange(rng);
      document.execCommand("delete"); // Safely clears Draft.js state
    }

    // 2. Handle Media FIRST (Ensures React state is ready for text linkage)
    if (imageUrls && imageUrls.length > 0) {
      console.log(`[Bot] Cycle #${cycleNum} — Preparing high-fidelity media...`);
      const filePromises = imageUrls.map((url, i) => urlToFile(url, `post_image_${i}.png`));
      const files = (await Promise.all(filePromises)).filter(Boolean);

      if (files.length > 0) {
        console.log(`[Bot] Cycle #${cycleNum} — Injecting media into UI...`);
        const uploadSuccess = await uploadMedia(files);
        if (!uploadSuccess) {
          throw new Error("Media Handshake failed at the network level.");
        }
        console.log("[Bot] Network Spy confirmed FINALIZE success. Safe to proceed.");

        // Brief pause for React to render the media thumbnail
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    // 3. Wait for textarea & TYPE FULL TEXT (Human Speed)
    // Typing AFTER media ensures the text is "Live" in the state during the click
    const textArea = await waitForElement('div[data-testid="tweetTextarea_0"]', 5000);
    console.log(`[Bot] Cycle #${cycleNum} — Typing text...`);
    await typeIntoContentEditable(textArea, textContent);

    // Safety buffer to commit React state
    await new Promise(r => setTimeout(r, 1000));

    // 4. Final safety check (Bot Power)
    const stillOnline = await isStillOnline();
    if (!stillOnline) {
      console.log("[Bot] Cycle — Bot powered down mid-task. Aborting.");
      await closeComposeModal();
      return;
    }

    // 5. Click Post Button
    console.log(`[Bot] Cycle #${cycleNum} — Hitting 'Post'...`);
    const tweetBtn = await waitForElement('button[data-testid="tweetButton"], [data-testid="tweetButtonInline"]', 5000);

    if (tweetBtn.getAttribute('aria-disabled') === 'true') {
      console.log("[Bot] Submit button disabled? Waiting for processing...");
      await new Promise(r => setTimeout(r, 3000));
    }

    tweetBtn.click();

    // 6. Visual confirmation wait
    const confirmed = await waitForPostSuccess(12000);
    const postType = imageUrls.length > 0 ? "image" : "text";

    if (confirmed) {
      console.log(`[Bot] Cycle #${cycleNum} — ✅ POST SUCCESS`);
      await incrementPostCount(cycleNum);
      await logPostResult({ post_id, type: postType, text: textContent, images: imageUrls, status: "success" });
    } else {
      console.log(`[Bot] Cycle #${cycleNum} — ❌ POST FAILED`);
      await closeComposeModal();
      await logPostResult({ post_id, type: postType, text: textContent, images: imageUrls, status: "failed", error: "UI confirmation timed out" });

      // 🧠 Brain Sync after failure to recover next cycle correctly
      await syncProfileSettings(cycleNum);
    }
  } catch (err) {
    console.error(`[Bot] Cycle #${cycleNum} — Critical error:`, err);
    await closeComposeModal();

    // 🧠 Brain Sync after error to recover next cycle correctly
    await syncProfileSettings(cycleNum);
  }
}

/**
 * Check if the user is still online by reading latest settings from storage.
 * @returns {Promise<boolean>}
 */
async function isStillOnline() {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, BOT_ENABLED]);
  const settings = stored[SETTINGS_KEY] || {};
  return (settings.online ?? stored[BOT_ENABLED] ?? false) && window.__botRunning;
}

/**
 * Close the compose modal on X.com.
 * Tries the close button first, then Escape key as fallback.
 */
async function closeComposeModal() {
  try {
    // Try clicking the close/X button on the compose modal
    const closeBtn = document.querySelector('[data-testid="app-bar-close"]')
      || document.querySelector('[aria-label="Close"]');
    if (closeBtn) {
      closeBtn.click();
      await new Promise((r) => setTimeout(r, 300));

      // If a discard confirmation appears, click "Discard"
      const discardBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
      if (discardBtn) {
        discardBtn.click();
        await new Promise((r) => setTimeout(r, 300));
      }
      return;
    }

    // Fallback: press Escape
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));

    // Check for discard confirmation after Escape
    const discardBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
    if (discardBtn) {
      discardBtn.click();
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch {
    // Silent — best effort close
  }
}

// ── Stubs resolved in main code ─────────

// ─────────────────────────────────────────────────────
// BOT CYCLE
// ─────────────────────────────────────────────────────
async function runBotCycle() {
  if (!window.__botRunning) return;

  _botCycleCount++;
  const cycleNum = _botCycleCount;

  try {
    console.log(`[Bot] ── Cycle #${cycleNum} START ──`);

    // ──────────────────────────────────────────
    // 🧠 BRAIN SYNC (Start of Cycle)
    // Synchronize local cache with Supabase backend to eliminate stale state
    await syncProfileSettings(cycleNum);
    // ──────────────────────────────────────────

    // Read fresh settings from storage
    const stored = await chrome.storage.local.get([SETTINGS_KEY]);
    const settings = stored[SETTINGS_KEY] || {};

    const effectiveOnline = settings.online ?? false;
    if (!effectiveOnline || !window.__botRunning) {
      console.log(`[Bot] ── Cycle #${cycleNum} aborted (bot disabled/offline). ──`);
      stopBot();
      return;
    }

    // ── TAB GUARD ──
    const { active_tab_id } = await chrome.storage.local.get(['active_tab_id']);
    const myTabId = window.__botTabId || (Math.random() * 10000).toFixed(0);
    window.__botTabId = myTabId;

    if (active_tab_id && active_tab_id !== myTabId) {
      console.log(`[Bot] Cycle #${cycleNum} — Standby mode (Another tab is the commander).`);
      return;
    }
    await chrome.storage.local.set({ active_tab_id: myTabId });

    // ── MISSION CONTROLLER ──
    const mission = settings.last_mission;
    if (mission && mission.steps && mission.steps.length > 0) {
      console.log(`[Bot] Cycle #${cycleNum} — Tactical Mission Found: "${mission.intent || 'Untitled'}"`);
      await handleCommandMission(settings, mission, cycleNum);
    } else {
      console.log(`[Bot] Cycle #${cycleNum} — Standing by for Neural Command...`);
    }

    console.log(`[Bot] ── Cycle #${cycleNum} END ──`);

  } catch (err) {
    console.error(`[Bot] Cycle #${cycleNum} error:`, err);
  } finally {
    if (window.__botRunning) {
      window.__botTimerId = setTimeout(runBotCycle, BOT_CYCLE_INTERVAL);
      console.log(`[Bot] Next cycle in ${BOT_CYCLE_INTERVAL / 1000}s.`);
    }
  }
}

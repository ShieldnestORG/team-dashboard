// modules/domHelpers.js — Reusable DOM interaction helpers for X.com

/**
 * Wait for an element matching `selector` to appear in the DOM.
 * Polls every 200ms. Rejects after `timeout` ms.
 * @param {string} selector
 * @param {number} timeout
 * @returns {Promise<Element>}
 */
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);

    const interval = 200;
    let elapsed = 0;

    const timer = setInterval(() => {
      const el = document.querySelector(selector);
      if (el) {
        clearInterval(timer);
        return resolve(el);
      }
      elapsed += interval;
      if (elapsed >= timeout) {
        clearInterval(timer);
        console.warn(`[Bot][DOM] waitForElement timed out: "${selector}" (${timeout}ms)`);
        reject(new Error(`Element not found: ${selector}`));
      }
    }, interval);
  });
}

/**
 * Detect the current X.com page from the URL pathname.
 * @returns {'home'|'profile'|'notifications'|'messages'|'explore'|'other'}
 */
function getCurrentPage() {
  const path = window.location.pathname;

  if (path === "/home" || path === "/") return "home";
  if (path === "/notifications") return "notifications";
  if (path.startsWith("/messages")) return "messages";
  if (path === "/explore") return "explore";

  // Profile pages: /<username> (single segment, no leading reserved word)
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 1) return "profile";
  if (segments.length === 2 && segments[1] === "status") return "tweetDetail";

  return "other";
}

/**
 * Navigate to a path on X.com natively using React Router (SPA soft-navigation).
 * This completely prevents hard browser reloads and destroyed JS contexts.
 * @param {string} path — e.g. '/elonmusk'
 * @returns {Promise<void>}
 */
async function navigateTo(path) {
  let fullUrl = path;
  if (!path.startsWith('http')) {
    fullUrl = `https://x.com${path.startsWith('/') ? path : '/' + path}`;
  }

  console.log(`[Bot][DOM] Navigating natively to ${fullUrl}...`);
  window.__bot_navigation_requested = true;
  window.location.href = fullUrl;
}

/**
 * Type text into a React contenteditable element character by character.
 * Uses execCommand("insertText") — the only reliable trigger for X.com's
 * React input listeners. Randomized delay between characters mimics human
 * pacing and gives React time to process each keystroke.
 * @param {Element} el — the contenteditable element
 * @param {string} text — the text to type
 * @returns {Promise<void>}
 */
async function typeIntoContentEditable(el, text) {
  console.log(`[Bot][DOM] Starting text injection (multi-strategy)...`);

  // 1. Focus the element
  el.focus();
  el.click();
  await new Promise((r) => setTimeout(r, 300));

  // Strategy A: execCommand insertText (most reliable for modern X.com)
  // This triggers React's synthetic event system properly
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);

  // Clear any existing content first
  if (el.innerText.trim()) {
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    await new Promise((r) => setTimeout(r, 100));
  }

  // Insert text — try execCommand first
  const inserted = document.execCommand('insertText', false, text);
  await new Promise((r) => setTimeout(r, 400));

  if (inserted && el.innerText.trim().length > 0) {
    console.log(`[Bot][DOM] execCommand insertText succeeded: "${el.innerText.slice(0, 50)}..."`);
    return;
  }

  // Strategy B: Clipboard paste injection (fallback for DraftJS)
  console.log("[Bot][DOM] execCommand failed, trying paste injection...");
  el.focus();
  await new Promise((r) => setTimeout(r, 200));

  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  el.dispatchEvent(new ClipboardEvent('paste', {
    clipboardData: dt,
    bubbles: true,
    cancelable: true
  }));
  await new Promise((r) => setTimeout(r, 400));

  if (el.innerText.trim().length > 0) {
    console.log(`[Bot][DOM] Paste injection succeeded: "${el.innerText.slice(0, 50)}..."`);
    return;
  }

  // Strategy C: Direct innerHTML + React input events (last resort)
  console.log("[Bot][DOM] Paste failed, trying direct DOM + input events...");
  el.innerHTML = `<span data-text="true">${text}</span>`;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));

  console.log(`[Bot][DOM] Final text state: "${el.innerText.slice(0, 50)}..."`);
}

/**
 * Post a thread (array of tweet texts) using X.com's compose UI.
 * Opens compose, types each tweet, clicks "Add another tweet" between them,
 * then clicks "Post all".
 * @param {string[]} tweets — array of tweet texts (each max 280 chars)
 * @returns {Promise<boolean>} true if thread was posted
 */
async function postThread(tweets) {
  if (!tweets || tweets.length === 0) return false;
  if (tweets.length === 1) return false; // Use single post for one tweet

  console.log(`[Bot][Thread] Starting thread with ${tweets.length} tweets...`);

  // 1. Make sure we're on home
  if (!window.location.pathname.startsWith('/home')) {
    await navigateTo('/home');
    await new Promise(r => setTimeout(r, 2000));
  }

  // 2. Find the compose box and type first tweet
  const composeBox = await waitForElement(
    '[data-testid="tweetTextarea_0"] [contenteditable="true"], [role="textbox"][data-testid="tweetTextarea_0"]',
    5000
  ).catch(() => null);

  if (!composeBox) {
    console.error("[Bot][Thread] Could not find compose box");
    return false;
  }

  await typeIntoContentEditable(composeBox, tweets[0]);
  await new Promise(r => setTimeout(r, 500));
  console.log(`[Bot][Thread] Typed tweet 1/${tweets.length}`);

  // 3. For each additional tweet, click "Add" and type
  for (let i = 1; i < tweets.length; i++) {
    // Click the "Add another tweet" button (the + icon)
    const addBtn = document.querySelector('[data-testid="addButton"]')
      || document.querySelector('[aria-label="Add post"]')
      || document.querySelector('[aria-label="Add another tweet"]');

    if (!addBtn) {
      console.error(`[Bot][Thread] Could not find 'Add' button for tweet ${i + 1}`);
      break;
    }

    addBtn.click();
    await new Promise(r => setTimeout(r, 800));

    // Find the new compose box (tweetTextarea_1, _2, etc.)
    const nextBox = await waitForElement(
      `[data-testid="tweetTextarea_${i}"] [contenteditable="true"], [role="textbox"][data-testid="tweetTextarea_${i}"]`,
      3000
    ).catch(() => null);

    if (!nextBox) {
      console.error(`[Bot][Thread] Could not find compose box for tweet ${i + 1}`);
      break;
    }

    await typeIntoContentEditable(nextBox, tweets[i]);
    await new Promise(r => setTimeout(r, 500));
    console.log(`[Bot][Thread] Typed tweet ${i + 1}/${tweets.length}`);
  }

  // 4. Click "Post all" button
  await new Promise(r => setTimeout(r, 500));
  const postAllBtn = document.querySelector('[data-testid="tweetButton"]')
    || document.querySelector('[data-testid="tweetButtonInline"]');

  if (postAllBtn && !postAllBtn.disabled) {
    postAllBtn.click();
    console.log("[Bot][Thread] Clicked Post All button");

    // Wait for confirmation
    const posted = await waitForPostSuccess(12000);
    console.log(`[Bot][Thread] Thread post ${posted ? 'succeeded' : 'failed'}`);
    return posted;
  }

  console.error("[Bot][Thread] Post button not found or disabled");
  return false;
}


/**
 * Convert a remote image URL into a high-fidelity File object.
 * Necessary for extensions to simulate a "human" file upload.
 * @param {string} url
 * @param {string} filename
 * @returns {Promise<File|null>}
 */
async function urlToFile(url, filename = null) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

    // Switch to arrayBuffer for 100% binary fidelity
    const arrayBuffer = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || 'image/jpeg';

    console.log(`[Bot][Debug][Fidelity] Fetched Raw Buffer: ${arrayBuffer.byteLength} bytes`);

    // Auto-generate realistic filename if not provided
    const extension = contentType.split('/')[1] || 'jpg';
    const finalName = filename || `IMG_${Date.now()}.${extension}`;

    // MIME Guard: X.com rejects svg+xml and other formats. Force image/png if unsure or svg.
    let finalType = contentType;
    if (finalType.includes('svg') || finalType === 'application/octet-stream') {
      finalType = 'image/png';
    }

    const file = new File([arrayBuffer], finalName, {
      type: finalType,
      lastModified: Date.now()
    });

    console.log(`[Bot][Debug][Fidelity] Constructed File Object:`, {
      name: file.name,
      size: file.size,
      type: file.type,
      bytesMatch: file.size === arrayBuffer.byteLength
    });

    return file;
  } catch (err) {
    console.error(`[Bot][DOM] urlToFile error for ${url}:`, err);
    return null;
  }
}

/**
 * Handle the actual "File Upload" simulation for X.com.
 * Finds the hidden file input, attaches the file, and triggers React listeners.
 * @param {File[]} files
 * @returns {Promise<boolean>}
 */
async function uploadMedia(files) {
  try {
    const fileInput = document.querySelector('input[data-testid="fileInput"]');
    if (!fileInput) {
      console.warn("[Bot][DOM] Media uploader input not found.");
      return false;
    }

    // Reset the Network Spy Signal before starting
    delete document.documentElement.dataset.tmbFinalizeStatus;
    delete document.documentElement.dataset.tmbFinalizeId;

    // Prepare full React-compatible event chain
    const events = [
      new Event('input', { bubbles: true }),
      new Event('change', { bubbles: true }),
      new Event('blur', { bubbles: true })
    ];

    // DataTransfer to inject the native File objects
    const dataTransfer = new DataTransfer();
    files.forEach(f => {
      console.log(`[Bot][DOM] Injecting binary file: ${f.name} (${f.size} bytes) (MIME: ${f.type})`);
      dataTransfer.items.add(f);
    });

    fileInput.files = dataTransfer.files;

    // Fire the entire event chain
    events.forEach(e => fileInput.dispatchEvent(e));

    // VERIFICATION: Trust the Page-Context Spy Script (Network Level)
    let uploaded = false;
    const start = Date.now();
    const timeout = 25000; // Giving X.com 25s for large/slow uploads

    while (Date.now() - start < timeout) {
      const status = document.documentElement.dataset.tmbFinalizeStatus;

      // If we see 'error', we stop immediately!
      if (status === 'error') {
        console.error("[Bot][Spy] Backend rejected the FINALIZE command (400 Bad Request)!");
        return false;
      }

      // If we see 'success', we confirmed it hit the database. TRUST THE NETWORK.
      if (status === 'success') {
        uploaded = true;
        break;
      }

      await new Promise(r => setTimeout(r, 800));
    }

    if (uploaded) {
      console.log("[Bot][Protocol] VERIFIED: FINALIZE success (Network Level). Ready to post.");
      // Option A Post-upload buffer
      await new Promise(r => setTimeout(r, 2000));
    } else {
      console.warn("[Bot][Protocol] FAILED: Media finalization timed out or rejected.");
    }

    return uploaded;
  } catch (err) {
    console.error("[Bot][Protocol] Critical Failure during media handshake:", err);
    return false;
  }
}

// ─────────────────────────────────────────────────────
// TWEET DATA HARVESTER
// ─────────────────────────────────────────────────────

/**
 * Scrapes all deep data layers from a physical DOM node for a Tweet.
 * @param {Element} tweetNode - The physical <article> node
 * @param {string} target_username - The username the bot is currently viewing
 * @returns {object} Extracted data payload mapped exactly to Supabase Schema
 */
function extractTweetData(tweetNode, target_username) {
  // 0. Extract Post URL
  let tweet_url = '';
  // Native X.com links wrap the timestamp in the actual permalink
  const timeLinks = Array.from(tweetNode.querySelectorAll('a[href*="/status/"]'));
  if (timeLinks.length > 0) {
    // The first one is usually the main tweet timestamp link
    const path = timeLinks[0].getAttribute('href');
    if (path) tweet_url = `https://x.com${path}`;
  }

  // 1. Text & Repost Logic
  let tweet_text = '';
  let parent_text = null;
  let is_repost = false;

  const textContainers = Array.from(tweetNode.querySelectorAll('[data-testid="tweetText"]'));

  // Guard 1: Detect a pure native "Retweet" via X.com's socialContext header
  const socialContext = tweetNode.querySelector('[data-testid="socialContext"]');
  const isPureRetweet = socialContext && socialContext.innerText.toLowerCase().includes('repost');

  if (isPureRetweet) {
    is_repost = true;
    tweet_text = ''; // The target user typed literally nothing.
    // The only text present on the screen physically belongs to the person they retweeted
    if (textContainers.length > 0) parent_text = textContainers[0].innerText;
  } else {
    // Normal Tweet, or a Quote-Tweet!
    if (textContainers.length > 0) tweet_text = textContainers[0].innerText;

    // Guard 2: If there are TWO separate tweetText DOM nodes, it's a Quote Tweet!
    if (textContainers.length > 1) {
      is_repost = true;
      parent_text = textContainers[1].innerText;
    } else {
      // Fallback: Sometimes Quote Tweets bury the parent text. Try grabbing any internal quote wrapper.
      const quoteWrapper = tweetNode.querySelector('div[role="link"] [dir="auto"]');
      if (quoteWrapper && quoteWrapper.innerText && quoteWrapper.innerText !== tweet_text) {
        is_repost = true;
        parent_text = quoteWrapper.innerText;
      }
    }
  }

  // 2. Image Logic (Filter out avatars)
  const imgNodes = Array.from(tweetNode.querySelectorAll('img')).filter(img =>
    !img.src.includes('profile_images') && (img.src.includes('media') || img.src.includes('twimg'))
  );
  const images = imgNodes.map(img => img.src);

  // 3. Video Logic
  const videoNode = tweetNode.querySelector('video');
  // Sometimes video blobs hide behind canvas or lack scr. We grab poster if src is hidden.
  const video = videoNode ? (videoNode.src || videoNode.getAttribute('poster') || 'video_present') : null;

  // 4. Advanced Metrics Logic
  // X.com usually places all stats nicely formatted within an accessibility aria-label string
  const groupNode = tweetNode.querySelector('[role="group"]');
  const rawMetricsStr = groupNode ? (groupNode.getAttribute('aria-label') || groupNode.innerText || '') : '';

  const metrics = {
    raw: rawMetricsStr,
    likes: "0",
    reposts: "0",
    replies: "0",
    views: "0"
  };

  if (rawMetricsStr) {
    const likeMatch = rawMetricsStr.match(/(\d+(?:,\d+)*(?:\.\d+[KMBkmb])?|\d+)\s+Like/i);
    const repostMatch = rawMetricsStr.match(/(\d+(?:,\d+)*(?:\.\d+[KMBkmb])?|\d+)\s+Repost/i);
    const viewsMatch = rawMetricsStr.match(/(\d+(?:,\d+)*(?:\.\d+[KMBkmb])?|\d+)\s+View/i);

    if (likeMatch) metrics.likes = likeMatch[1];
    if (repostMatch) metrics.reposts = repostMatch[1];
    if (viewsMatch) metrics.views = viewsMatch[1];
  }

  // FORCE-OVERRIDE: Extract directly from the physical Reply Button for maximum accuracy!
  const targetReplyBtn = tweetNode.querySelector('[data-testid="reply"]');
  if (targetReplyBtn) {
    const physicalText = targetReplyBtn.innerText.trim();
    if (physicalText) {
      metrics.replies = physicalText; // It visually says "5" or "1.2K"
    } else {
      const aria = targetReplyBtn.getAttribute('aria-label') || '';
      const fallbackMatch = aria.match(/(\d+(?:,\d+)*(?:\.\d+[KMBkmb])?)/);
      if (fallbackMatch) metrics.replies = fallbackMatch[1];
    }
  }

  return { target_username, tweet_url, is_repost, parent_text, tweet_text, images, video, metrics };
}

// ─────────────────────────────────────────────────────
// VIEWPORT & SCROLLING HELPERS
// ─────────────────────────────────────────────────────

/**
 * Smoothly scrolls the window down by a specific amount of pixels.
 * @param {number} pixels - Amount to scroll down (e.g., 500)
 * @param {number} durationMs - How long to wait after scrolling (defaults to 1500ms)
 * @returns {Promise<void>}
 */
async function smoothScrollDown(pixels, durationMs = 3000) {
  console.log(`[Bot][DOM] Scrolling down ${pixels}px (End-of-Feed Aware)...`);

  const stepPixels = 40;
  const steps = Math.ceil(Math.abs(pixels) / stepPixels);
  const timePerStep = durationMs / steps;

  let lastY = window.scrollY;
  let stagnantCount = 0;

  for (let i = 0; i < steps; i++) {
    if (window.__botRunning === false) break;

    window.scrollBy(0, pixels < 0 ? -stepPixels : stepPixels);

    // END-OF-FEED DETECTION: If we aren't moving, stop the ghost scroll
    if (Math.abs(window.scrollY - lastY) < 2) {
      stagnantCount++;
      if (stagnantCount > 5) { // Stop after ~200ms of no movement
        console.log("[Bot][DOM] Feed wall hit. Aborting scroll.");
        break;
      }
    } else {
      stagnantCount = 0;
    }
    lastY = window.scrollY;

    const jitter = Math.random() * 50;
    await new Promise(r => setTimeout(r, timePerStep + jitter));
  }
}

/**
 * Smoothly scrolls an element into the center of the viewport.
 * Crucial for ensuring "Like" buttons aren't hidden behind X.com's sticky headers/footers.
 * @param {Element} element - The DOM element to focus on
 * @returns {Promise<void>}
 */
async function scrollElementIntoCenter(element) {
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await new Promise(r => setTimeout(r, 1000));
}

// ─────────────────────────────────────────────────────
// AI CONTEXT OMNI-READER (COMMENTS)
// ─────────────────────────────────────────────────────

/**
 * Scrapes the text of the first N replies to a main tweet for AI Context reading.
 * @param {number} min_count - Required number of replies for a valid vibe check
 * @returns {Array<string>|null} - Null if there aren't enough replies, otherwise Array of text
 */
function scrapeContextReplies(min_count) {
  const replyNodes = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  // The first node is always the OP's TARGET TWEET. The rest are replies in the DOM thread!
  if (replyNodes.length <= 1) return null;

  const replies = [];
  // Skip the main OP tweet, read the community replies
  for (let i = 1; i < replyNodes.length; i++) {
    if (replies.length >= min_count) break;

    // Quick text extraction skipping complex stats nodes to save AI tokens
    const textcontainer = replyNodes[i].querySelector('[data-testid="tweetText"]');
    if (textcontainer) {
      replies.push(textcontainer.innerText);
    }
  }

  // Did the room have enough people to read the vibe?
  if (replies.length < min_count) {
    return null;
  }

  return replies;
}

/**
 * Perform a native search on X.com.
 * @param {string} query
 */
async function performSearch(query) {
  console.log(`[Bot][Command] Searching for: "${query}"`);
  navigateTo(`/search?q=${encodeURIComponent(query)}&src=typed_query`);
}

/**
 * Find a specific tweet in the current view by its index.
 * @param {number} index
 * @returns {Element|null}
 */
function getTweetByIndex(index) {
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');
  return tweets[index] || null;
}

/**
 * Trigger a Repost (Retweet) on a specific tweet node.
 * @param {Element} tweetNode
 */
async function triggerRepost(tweetNode) {
  // ARIA / DATA-TESTID GUARD: Check if already reposted first
  const unretweetBtn = tweetNode.querySelector('[data-testid="unretweet"]') ||
    tweetNode.querySelector('[aria-label*="Undo Repost"]');
  if (unretweetBtn) {
    console.log("[Bot][DOM] Tweet already reposted, skipping.");
    return true;
  }

  // Precise testid first, strictly localized to buttons
  const btn = tweetNode.querySelector('[data-testid="retweet"]') ||
    tweetNode.querySelector('button[aria-label*="Repost"]') ||
    tweetNode.querySelector('div[role="button"][aria-label*="Repost"]');

  if (!btn) return false;

  btn.click();
  await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));
  const confirm = document.querySelector('[data-testid="retweetConfirm"]') ||
    document.querySelector('[role="menuitem"] span')?.parentElement; // Fallback for confirm

  if (confirm) {
    confirm.click();
    return true;
  }
  return false;
}

/**
 * Trigger a Like on a specific tweet node.
 * @param {Element} tweetNode
 */
async function triggerLike(tweetNode) {
  // STATE GUARD: Check if already liked
  const unlikeBtn = tweetNode.querySelector('[data-testid="unlike"]') ||
    tweetNode.querySelector('[aria-label*="Unlike"]');
  if (unlikeBtn) {
    console.log("[Bot][DOM] Tweet already liked, skipping.");
    return true;
  }

  // Precise testid first, strictly localized to buttons
  const btn = tweetNode.querySelector('[data-testid="like"]') ||
    tweetNode.querySelector('button[aria-label*="Like"]') ||
    tweetNode.querySelector('div[role="button"][aria-label*="Like"]');
  if (!btn) return false;

  console.log("[Bot][DOM] Found Like button, centering and engaging...");
  btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));

  btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  btn.click();
  btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

  return true;
}

/**
 * Trigger a Follow from a specific tweet node or profile page.
 * @param {Element} node
 */
async function triggerFollow(node) {
  const btn = node.querySelector('[data-testid$="-follow"]') || node.querySelector('[data-testid$="-unfollow"]');
  if (!btn) return false;
  if (btn.getAttribute('data-testid')?.includes('-unfollow')) return true;
  btn.click();
  return true;
}
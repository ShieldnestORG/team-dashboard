(function() {
  console.log("%c [Bot][Tracer] 🛫 Vegas Protocol Tracer (v3) Active. Recording Every Packet...", "color: white; background: #00e5a0; padding: 4px; border-radius: 4px; font-weight: bold;");
  window.__X_TRACE__ = [];

  // Helper to deep-capture bodies (handles JSON, FormData, and Blobs)
  async function parseBody(body) {
    if (!body) return null;
    try {
      if (typeof body === 'string') return JSON.parse(body);
      if (body instanceof FormData) {
        const obj = {};
        body.forEach((val, key) => { obj[key] = (val instanceof File) ? "[File: "+val.name+"]" : val; });
        return obj;
      }
      if (body instanceof Blob) return "[Blob: " + body.size + " bytes]";
      return body;
    } catch { return "[Unparseable Body]"; }
  }

  // 1. Universal XHR Interceptor (X.com uses this for most media-upload chunks)
  const originalXHR = window.XMLHttpRequest.prototype.open;
  const originalSend = window.XMLHttpRequest.prototype.send;
  const originalSetHeader = window.XMLHttpRequest.prototype.setRequestHeader;

  window.XMLHttpRequest.prototype.open = function(method, url) {
    this._url = url;
    this._method = method;
    this._headers = {}; // Initialize header bucket
    return originalXHR.apply(this, arguments);
  };

  window.XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
    this._headers[header] = value;
    return originalSetHeader.apply(this, arguments);
  };

  window.XMLHttpRequest.prototype.send = function(body) {
    const xhr = this;
    const entry = {
      protocol: 'XHR',
      timestamp: new Date().toISOString(),
      method: xhr._method,
      url: xhr._url,
      requestBody: null,
      requestHeaders: xhr._headers, // Captured!
      status: null,
      responseBody: null
    };

    // Capture the request body defensively
    parseBody(body).then(b => { entry.requestBody = b; });

    xhr.addEventListener('load', async function() {
      entry.status = xhr.status;
      try { entry.responseBody = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { entry.responseBody = "[Binary/Non-JSON Response]"; }
      window.__X_TRACE__.push(entry);
      
      // Bot Signal Integration: Tell the bot when FINALIZE completes
      if (xhr._url.includes('upload.json') && xhr._url.includes('command=FINALIZE')) {
          if (xhr.status === 201 || xhr.status === 200) {
              console.log("%c [Bot][Spy] ✅ FINALIZE SUCCESS!", "color: #00ff00; font-weight: bold;");
              document.documentElement.dataset.tmbFinalizeStatus = 'success';
          } else if (xhr.status >= 400) {
              console.error("[Bot][Spy] ❌ FINALIZE REJECTED:", xhr.status);
              document.documentElement.dataset.tmbFinalizeStatus = 'error';
          }
      }

      // Real-time alert for media events
      if (xhr._url.includes('upload.x.com')) {
         console.log("%c [Bot][Tracer][XHR] Media Segment Captured:", "color: #4f8eff;", entry);
      }
    });

    return originalSend.apply(this, arguments);
  };

  // 2. Universal Fetch Interceptor (Used for final GraphQL submission)
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    let url = args[0] instanceof Request ? args[0].url : args[0];
    if (typeof url !== 'string') url = String(url || '');

    const method = (args[1] && args[1].method) || (args[0] instanceof Request ? args[0].method : 'GET');
    const reqBody = args[1] && args[1].body;
    
    const entry = {
      protocol: 'FETCH',
      timestamp: new Date().toISOString(),
      method,
      url,
      requestBody: await parseBody(reqBody),
      requestHeaders: args[1] && args[1].headers, // Capture the keys to the kingdom
      status: null,
      responseBody: null
    };

    const res = await originalFetch(...args);
    const clone = res.clone();
    
    entry.status = res.status;
    try { entry.responseBody = await clone.json(); } catch { entry.responseBody = "[Non-JSON Response]"; }
    window.__X_TRACE__.push(entry);

    if (url.includes('CreateTweet')) {
      console.log("%c 🚨🚨🚨 THE GOLDEN KEY FOUND! (AUTO-DUMP) 🚨🚨🚨 ", "background: #00e5a0; color: black; font-size: 20px; font-weight: bold; padding: 10px; border: 4px solid white;");
      console.log("%c PAYLOAD CAPTURED AUTOMATICALLY:", "color: #00e5a0; font-weight: bold;");
      console.log(JSON.stringify(entry, null, 2));
      console.warn("IF THIS JSON IS SHORT, WAIT 1 SECOND AND CHECK THE 'FINAL TWEET PAYLOAD' BELOW.");
    }

    // --- SELF-HEALING BEARER LOGIC ---
    // Snatch the bearer from any official X request to keep our 'X_BEARER_TOKEN' fresh
    const auth = (args[1] && args[1].headers && (args[1].headers.authorization || args[1].headers.Authorization));
    if (auth && auth.startsWith('Bearer ')) {
        document.documentElement.dataset.tmbBearer = auth.replace('Bearer ', '');
    }

    return res;
  };

  // 3. Automated Dump on User Post
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-testid="tweetButtonInline"], [data-testid="tweetButton"], [data-testid="tweetButtonInlinePost"], [data-testid="SideNav_NewTweet_Button"]');
    if (btn) {
        // Wait 1 second for the network to actually fire
        await new Promise(r => setTimeout(r, 1500));

        console.warn("%c [Bot][Tracer] 🎯 POST BUTTON CLICKED! Filtering gold...", "background: #ff4b5f; color: white; padding: 4px; font-weight: bold;");
        
        const mediaEvents = window.__X_TRACE__.filter(t => t.url.includes('upload.x.com'));
        const finalTweet = window.__X_TRACE__.find(t => t.url.includes('CreateTweet'));
        const editor = document.querySelector('[data-testid^="tweetTextarea_0"]');

        console.log("%c --- EDITOR STATE (REACT) ---", "color: #ff9f43; font-weight: bold;");
        console.log("Final InnerText:", editor ? editor.innerText : "Editor not found");

        console.log("%c --- MEDIA UPLOAD LIFECYCLE ---", "color: #4f8eff; font-weight: bold;");
        console.table(mediaEvents);

        if (finalTweet) {
            console.log("%c 🚨🚨🚨 THE GOLDEN KEY FOUND! (CLICK-SYNC) 🚨🚨🚨 ", "background: #ff4b5f; color: white; font-size: 20px; font-weight: bold; padding: 10px; border: 4px solid white;");
            console.log("%c COPY THE JSON BELOW AND SEND IT TO ME:", "color: #ff4b5f; font-weight: bold;");
            console.log(JSON.stringify(finalTweet, null, 2));
            console.log("%c 🚨🚨🚨 END OF GOLDEN KEY 🚨🚨🚨 ", "background: #ff4b5f; color: white; font-size: 16px; font-weight: bold; padding: 5px;");
        } else {
            console.warn("Final Tweet Payload still not captured. Is there a network error or adblocker?");
        }
    }
  }, true);

  console.log("%c [Bot][Tracer] Flight Recorder Engine Active. Perform your Manual Post now!", "color: white; background: #00e5a0; padding: 4px; border-radius: 4px; font-weight: bold;");
})();

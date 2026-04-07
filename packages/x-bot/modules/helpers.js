// modules/helpers.js — DOM helpers and utility functions

/**
 * MD5 Hashing Utility for X.com media signatures
 * ⚡ High-speed implementation for binary buffers
 */
function md5(buffer) {
  var words = new Uint32Array(buffer.byteLength / 4 + 2);
  var view = new DataView(buffer);
  for (var i = 0; i < view.byteLength; i++) {
    words[i >> 2] |= view.getUint8(i) << ((i % 4) * 8);
  }
  return md5_internal(words, buffer.byteLength);

  function md5_internal(x, len) {
    x[len >> 2] |= 0x80 << ((len % 4) * 8);
    x[(((len + 8) >> 6) << 4) + 14] = len * 8;
    var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (var i = 0; i < x.length; i += 16) {
      var olda = a, oldb = b, oldc = c, oldd = d;
      a = ff(a, b, c, d, x[i + 0], 7, -680876936); d = ff(d, a, b, c, x[i + 1], 12, -389564586);
      c = ff(c, d, a, b, x[i + 2], 17, 606105819); b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
      a = ff(a, b, c, d, x[i + 4], 7, -176418897); d = ff(d, a, b, c, x[i + 5], 12, 1200080426);
      c = ff(c, d, a, b, x[i + 6], 17, -1473231341); b = ff(b, c, d, a, x[i + 7], 22, -45705983);
      a = ff(a, b, c, d, x[i + 8], 7, 1770035416); d = ff(d, a, b, c, x[i + 9], 12, -1958414417);
      c = ff(c, d, a, b, x[i + 10], 17, -42063); b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
      a = ff(a, b, c, d, x[i + 12], 7, 1804603682); d = ff(d, a, b, c, x[i + 13], 12, -40341101);
      c = ff(c, d, a, b, x[i + 14], 17, -1502002290); b = ff(b, c, d, a, x[i + 15], 22, 1236535329);
      a = gg(a, b, c, d, x[i + 1], 5, -165796510); d = gg(d, a, b, c, x[i + 6], 9, -1069501632);
      c = gg(c, d, a, b, x[i + 11], 14, 643717713); b = gg(b, c, d, a, x[i + 0], 20, -373897302);
      a = gg(a, b, c, d, x[i + 5], 5, -701558691); d = gg(d, a, b, c, x[i + 10], 9, 38016083);
      c = gg(c, d, a, b, x[i + 15], 14, -660478335); b = gg(b, c, d, a, x[i + 4], 20, -405537848);
      a = gg(a, b, c, d, x[i + 9], 5, 568446438); d = gg(d, a, b, c, x[i + 14], 9, -1019803690);
      c = gg(c, d, a, b, x[i + 3], 14, -187363961); b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
      a = gg(a, b, c, d, x[i + 13], 5, -1444681467); d = gg(d, a, b, c, x[i + 2], 9, -51403784);
      c = gg(c, d, a, b, x[i + 7], 14, 1735328473); b = gg(b, c, d, a, x[i + 12], 20, -1926607734);
      a = hh(a, b, c, d, x[i + 5], 4, -378558); d = hh(d, a, b, c, x[i + 8], 11, -2022574463);
      c = hh(c, d, a, b, x[i + 11], 16, 1839030562); b = hh(b, c, d, a, x[i + 14], 23, -35309556);
      a = hh(a, b, c, d, x[i + 1], 4, -1530992060); d = hh(d, a, b, c, x[i + 4], 11, 1272893353);
      c = hh(c, d, a, b, x[i + 7], 16, -155497632); b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
      a = hh(a, b, c, d, x[i + 13], 4, 681279174); d = hh(d, a, b, c, x[i + 0], 11, -358537222);
      c = hh(c, d, a, b, x[i + 3], 16, -722521979); b = hh(b, c, d, a, x[i + 6], 23, 76029189);
      a = hh(a, b, c, d, x[i + 9], 4, -640364487); d = hh(d, a, b, c, x[i + 12], 11, -421815835);
      c = hh(c, d, a, b, x[i + 15], 16, 530742520); b = hh(b, c, d, a, x[i + 2], 23, -995338651);
      a = ii(a, b, c, d, x[i + 0], 6, -198630844); d = ii(d, a, b, c, x[i + 7], 10, 1126891415);
      c = ii(c, d, a, b, x[i + 14], 15, -1416354905); b = ii(b, c, d, a, x[i + 5], 21, -57434055);
      a = ii(a, b, c, d, x[i + 12], 6, 1700485571); d = ii(d, a, b, c, x[i + 3], 10, -1894946606);
      c = ii(c, d, a, b, x[i + 10], 15, -105152333); b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
      a = ii(a, b, c, d, x[i + 8], 6, 1873313359); d = ii(d, a, b, c, x[i + 15], 10, -30611744);
      c = ii(c, d, a, b, x[i + 6], 15, -1560198380); b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
      a = ii(a, b, c, d, x[i + 4], 6, -145523070); d = ii(d, a, b, c, x[i + 11], 10, -1120210379);
      c = ii(c, d, a, b, x[i + 2], 15, 718787280); b = ii(b, c, d, a, x[i + 9], 21, -343485551);
      a = add32(a, olda); b = add32(b, oldb); c = add32(c, oldc); d = add32(d, oldd);
    }
    return hex(a) + hex(b) + hex(c) + hex(d);
  }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
  function cmn(q, a, b, x, s, t) { a = add32(add32(a, q), add32(x, t)); return add32((a << s) | (a >>> (32 - s)), b); }
  function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
  function hex(n) {
    var s = "", v;
    for (var j = 0; j < 4; j++) {
      v = (n >>> (j * 8)) & 0xff;
      s += "0123456789abcdef".charAt((v >>> 4) & 0xf) + "0123456789abcdef".charAt(v & 0xf);
    }
    return s;
  }
}

function applyToggleState(enabled) {
  const dot = document.getElementById("tmb-dot");
  const label = document.getElementById("tmb-state-label");
  const input = document.getElementById("tmb-toggle-input");
  if (!dot || !label || !input) return;
  input.checked = enabled;
  dot.classList.toggle("active", enabled);
  label.classList.toggle("active", enabled);
  label.textContent = enabled ? "Online" : "Offline";
}

function fadeOut(el, cb) {
  if (!el) {
    cb && cb();
    return;
  }
  el.style.transition = "opacity 0.18s ease, transform 0.18s ease";
  el.style.opacity = "0";
  el.style.transform = "scale(0.94)";
  setTimeout(() => {
    el.style.cssText = "";
    cb && cb();
  }, 200);
}

function getOrCreateCard(container) {
  let card = document.getElementById("tmb-card");
  if (!card) {
    card = document.createElement("div");
    card.id = "tmb-card";
    container.appendChild(card);
  }
  card.style.display = "block";
  return card;
}

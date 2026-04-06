// modules/notifications.js — Toast notification system

function showNotification(card, type, message, duration = 4000) {
  const existing = card.querySelector(".tmb-notif");
  if (existing) existing.remove();

  const ok = type === "success";
  const notif = document.createElement("div");
  notif.className = "tmb-notif";
  notif.style.cssText = `
    background: ${ok ? "rgba(0,229,160,0.08)" : "rgba(255,75,95,0.08)"};
    border: 1px solid ${ok ? "rgba(0,229,160,0.2)" : "rgba(255,75,95,0.2)"};
    color: ${ok ? "rgba(0,229,160,0.9)" : "rgba(255,75,95,0.9)"};
  `;

  notif.innerHTML = `
    <span class="tmb-notif-icon">${ok ? "✓" : "✕"}</span>
    <span class="tmb-notif-text">${message}</span>
    <button class="tmb-notif-close">×</button>
    <div class="tmb-notif-bar" style="background:${ok ? "rgba(0,229,160,0.4)" : "rgba(255,75,95,0.4)"}"></div>
  `;

  const body = card.querySelector(".tmb-body-login, .tmb-body");
  if (body) body.insertBefore(notif, body.firstChild);

  const timer = setTimeout(() => notif.remove(), duration);
  notif.querySelector(".tmb-notif-close").addEventListener("click", () => {
    clearTimeout(timer);
    notif.remove();
  });
}

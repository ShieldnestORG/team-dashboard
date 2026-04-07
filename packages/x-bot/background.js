// background.js — Phase 1: navigation only

chrome.action.onClicked.addListener((tab) => {
  if (!tab.url || !tab.url.includes("x.com")) {
    chrome.tabs.update(tab.id, { url: "https://x.com/home" });
  }
});
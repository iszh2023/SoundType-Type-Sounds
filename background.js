/* global chrome */

function isInjectableUrl(url) {
  const u = String(url || "");
  return /^(https?):/i.test(u);
}

async function ensureInjected(tab) {
  const tabId = tab?.id;
  const url = tab?.url;
  if (!tabId || !isInjectableUrl(url)) return false;
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] });
    return true;
  } catch {
    return false;
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "ST_TOGGLE_UI" });
  } catch {
    // Likely not injected yet; inject on-demand (user gesture via toolbar click).
    const ok = await ensureInjected(tab);
    if (!ok) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "ST_TOGGLE_UI" });
    } catch {
      // ignore
    }
  }
});

// Settings sync happens via chrome.storage.onChanged in content scripts.

/* global chrome */

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "ST_TOGGLE_UI" });
  } catch {
    // Content scripts don't run on some restricted pages (chrome://, extensions gallery, etc).
  }
});

// Settings sync happens via chrome.storage.onChanged in content scripts.

# SoundType (Load Unpacked)

1. Open Chrome and go to `chrome://extensions`.
2. Turn on Developer mode (top right).
3. Click Load unpacked.
4. Select this folder: `Google Extension/SoundType`.
5. Click the SoundType extension icon to show/hide the floating window.

If no window appears:
- Make sure you are on a normal webpage (like `https://youtube.com`), not `chrome://extensions` or the Chrome Web Store.
- Go to `chrome://extensions` → SoundType → Details → Site access → choose On all sites.
- Then reload the extension and refresh the page.
- Make sure you loaded the correct folder: `Google Extension/SoundType` (not the parent `Google Extension`).

If you can only click one series:
- Reload SoundType in `chrome://extensions` and refresh the page.
- Try clicking a series once, wait 1–2 seconds (it may be scanning for sound files), then click again.

Auto-open:
- This extension auto-opens its floating window on normal websites and also on the New Tab page (it replaces Chrome’s New Tab).
- If you reload the extension while tabs are already open, refresh those tabs once to ensure only the newest version is running.

Important Chrome limitation:
- Chrome does not allow extensions to run on `chrome://` pages (like `chrome://extensions`) or the Chrome Web Store, so SoundType can’t play sounds there.
- If you want it on `file://` pages, turn on Allow access to file URLs in the SoundType extension details.

Real sounds:
- By default, SoundType uses synthetic placeholder sounds.
- To use “real” game/meme clips, add your own audio files under `Google Extension/SoundType/sounds/` (see `Google Extension/SoundType/sounds/README.md`).
- Added series: ASMR (put your files in `sounds/asmr/`).
- Default series: Keys (one consistent key-click sound, and it opens at the top-left by default).

Pick a series, then press any key anywhere to play a random sound.

Chrome Web Store - coming soon

Privacy:
- See `Google Extension/SoundType/PRIVACY_POLICY.md`.

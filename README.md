# Recipe Box (web app)

A recipe collection that runs in the browser and can be added to the Home Screen on iPhone (or Android):

- **Add recipes:** photograph cards or notebook pages, import PDF / Word / text files, or paste and dictate.
- **Find recipes:** search everything, filter by meal or time, and use **What can I cook?** to rank recipes by the ingredients you have.
- **Read handwriting:** optional free Google Gemini key, called directly from the phone. Without a key, a basic built-in reader handles print.

Recipes are stored only on the device (IndexedDB). There is no server and no account.

## Install on iPhone

1. Open the site in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open Recipe Box from the Home Screen. Installed this way, iOS keeps the recipes permanently and the app works offline.

## Family recipes

`family.enc.json` is a recipe collection encrypted with AES-256-GCM. The key comes from a passphrase via PBKDF2-SHA256 with 600,000 rounds. In the app, choose **Add recipe → Load family recipes** and enter the passphrase you were given. Without the passphrase the file can't be read.

## Files

| File | Purpose |
|---|---|
| `index.html`, `style.css`, `app.js` | Screens |
| `store.js` | On-device storage, Gemini reader, PDF/Word import, backups, family collection |
| `parser.js` | Recipe and ingredient parsing, "What can I cook?" ranking (shared logic with the Android app) |
| `sw.js`, `manifest.webmanifest`, `icon*` | Offline use and Home Screen install |
| `test/` | `node --test test/` |

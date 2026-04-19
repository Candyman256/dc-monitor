# DC Monitor — Deployment Guide

## Why this matters

GitHub's web editor (pencil icon) silently truncates large file pastes. Your previous deploys had failed silently because the pasted HTML was cut off mid-file. **Never use the pencil-icon editor for this project again.**

Use one of the three methods below instead. Any of them will deploy the full project correctly every time.

---

## Method 1 — GitHub Drag & Drop (recommended)

This is the simplest method for most updates. Works in any browser, no tools to install.

1. Go to `https://github.com/candyman256/dc-monitor`
2. Click the **Add file** dropdown → **Upload files**
3. Drag **all** the project files into the upload area at once:
   - `index.html`
   - `app.css`
   - `app.js`
   - `sw.js`
   - `manifest.json`
   - `icon.svg`
   - `README.md` (optional)
   - `DEPLOY.md` (optional)
4. Scroll to the commit box:
   - Title: `Update DC Monitor` (or whatever describes the change)
   - Keep **Commit directly to the main branch** selected
5. Click **Commit changes**
6. Wait ~30 seconds for GitHub Pages to rebuild, then reload the site

**Important:** When uploading an updated version, drag in the same files again. GitHub will overwrite them. There is no file-size limit for these files — they are all well under GitHub's 25 MB per-file limit.

---

## Method 2 — GitHub Desktop

Best if you plan to make frequent updates.

1. Install GitHub Desktop from https://desktop.github.com
2. File → Clone repository → `candyman256/dc-monitor`
3. Replace the files in the local folder with the new versions
4. GitHub Desktop will show the changes in the left panel
5. Add a commit message → **Commit to main** → **Push origin**

Advantage: you can edit any file in any editor (VS Code, Notepad, etc.) and see all changes diffed before committing.

---

## Method 3 — Git CLI (power user)

If you're comfortable with the terminal:

```bash
git clone https://github.com/candyman256/dc-monitor.git
cd dc-monitor
# (replace files with updated versions)
git add -A
git commit -m "Update DC Monitor"
git push
```

---

## After any deploy — force-refresh the cached app

The tool uses a service worker to cache files for offline use at BRS. After deploying an update, your browser may still show the old version.

**On laptop:** `Ctrl + Shift + R` to hard-reload.

**On iPhone (Safari/PWA):** Close the app completely (swipe up, then flick it away). Reopen it. If it's still stale: Settings → Safari → Advanced → Website Data → find the site → Remove. Then reopen.

Alternatively, to force all users' browsers to refresh automatically, bump the `SHELL_VERSION` constant at the top of `sw.js` (e.g. from `v1.0.0` to `v1.0.1`). On next visit, the old cache is cleared.

---

## Verifying the deploy worked

1. Open `https://candyman256.github.io/dc-monitor/` in an incognito/private window (bypasses all caches)
2. Open the browser DevTools (F12) → **Console** tab
3. Look for any red errors. A healthy app shows no errors.
4. Reload with DevTools open → **Network** tab → confirm `app.css`, `app.js`, `sw.js`, `manifest.json`, `icon.svg` all load with status `200`.

If you see `404` for any file, that file didn't upload — redo the Upload step and make sure it's included.

---

## File structure

```
dc-monitor/
├── index.html       ← main app shell (small, ~15 KB)
├── app.css          ← all styling
├── app.js           ← all logic
├── sw.js            ← service worker (offline cache)
├── manifest.json    ← PWA manifest
├── icon.svg         ← app icon
├── README.md        ← user guide
└── DEPLOY.md        ← this file
```

Because code is split into multiple small files, even if one file gets truncated on upload, the rest still work — and it's obvious from the browser console which file failed.

---

## Rollback

If a deploy breaks the site:

1. Go to the repo → **Commits** tab (top right on the code view)
2. Find the last working commit
3. Click `<>` (browse at that commit) → Click any file → Click **Raw** → Save As… to get the old version
4. Or use **Revert** from the commit dropdown on the failed commit

Since the site is static, rollback is instant after you push the fix.

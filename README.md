# DC Monitor

Mobile-first web tool for BOU TI&O's weekly data center monitoring report.

Live: **https://candyman256.github.io/dc-monitor/**

## What it does

Replaces the manual transcribe-photos-then-paste-into-Word workflow with:

1. **Step 1 — Upload.** At BRS, take photos on iPhone. At your desk, paste HQ portal screenshots with `Ctrl+V`. BRS photos sync to your laptop automatically via Firebase.
2. **Step 2 — Review.** Gemini reads each image and pre-fills the AHU temperatures and UPS readings. Blue fields are from AI — verify them. Edit anything that looks wrong. The page uses tabs (HQ | BRS | Alerts) for quick navigation.
3. **Step 3 — Send.** Preview a dashboard-style HTML report. Copy it to the clipboard and paste into a new Outlook email (the HTML renders properly). Or download as `.eml` and double-click to open pre-composed.

## First-time setup

Each device needs a PIN and a Gemini API key.

### Get a Gemini API key (free)

1. Go to https://aistudio.google.com/apikey
2. Sign in with any Google account (doesn't need to be a BOU account)
3. Click **Create API key** → copy the key (starts with `AIza…`)
4. No credit card required. Free tier is plenty for weekly use.

### Enter on your device

1. Open https://candyman256.github.io/dc-monitor/
2. Enter the team PIN (agreed between you and your colleague — at least 4 digits)
3. Paste the Gemini API key
4. Done — both are stored locally on that device only.

### Share setup to another device (new)

Instead of typing everything again on a second device:

1. On the device that's already set up, tap the PIN chip (top-right) → **Share setup to another device**
2. A QR code appears that expires in 2 minutes
3. Scan with the other device's camera, or tap **Copy URL** and send it through a secure channel
4. The other device loads the PIN and API key in one go

The payload is only in the URL fragment, never transmitted to any server.

## Workflow

### Weekly monitoring — at BRS (on iPhone)

1. Open DC Monitor (add to Home Screen for a native feel: Safari Share button → Add to Home Screen)
2. Enter today's PIN
3. Tap **Camera** under BRS → photograph each AHU panel and UPS display
4. Photos upload to the session automatically. You can now close the app — nothing else to do at BRS.

### At the laptop

1. Open the tool — your BRS photos are already synced
2. Under HQ, click the paste zone then `Ctrl+V` each portal screenshot
3. Fill in the date and your name, tap **Continue**
4. On the Review page, Gemini has auto-filled what it could read. Verify. Fields that came from AI are highlighted blue. Edit any that look wrong — editing clears the AI highlight.
5. Switch through the HQ / BRS / Alerts tabs, making sure the right status pills are selected for each AHU and check item
6. Tap **Preview Report**
7. Review the preview. It's what management will see.
8. Tap **Copy to clipboard as HTML**
9. In Outlook, compose a new email to Alfred, click in the body, `Ctrl+V`. The report pastes as the fully-styled dashboard.
10. Add any short intro/message above the report if you want, then send.

### Alternative Outlook flow

If paste-from-clipboard doesn't behave properly on your Outlook version:

- Tap **Download as .eml** → double-click the file → Outlook opens with the report already in the body.

## Features

### Auto-save and resume

The tool auto-saves your work every few seconds. If you accidentally close the tab or the browser crashes, reopening the tool within the same session (same PIN, same day) shows a **Resume previous session?** banner.

### Report history

After sending, tap **Save to history** on step 3. The last 10 reports are kept on the device, viewable later with a tap.

### Offline at BRS

If your signal drops, the tool keeps working. Photos are queued locally and sync automatically when signal returns. A red **Offline** pill appears in the corner when you're disconnected. The menu shows how many items are queued.

### Value validation

The tool gently flags values that look out-of-range — e.g. temperature below 10 °C or above 40 °C, frequency outside 45–55 Hz. Warnings don't block the report; they just prompt you to double-check.

## Troubleshooting

### "Extraction failed"

Tap **Show details** for the exact error. Common causes:

- **HTTP 400** — the API key is malformed, or one of the images is corrupt. Re-enter the key (menu → Change API key) or remove the problem photo.
- **HTTP 403** — the API key is valid but lacks permission for Gemini. Generate a new one at aistudio.google.com.
- **HTTP 429** — you've hit Gemini's free rate limit. Wait a minute and retry, or fill values manually.
- **HTTP 5xx** — Gemini server error. Retry; if persistent, fill values manually.

In all cases, extraction is optional. You can always fill the readings manually and still generate the same polished report.

### BRS photos not appearing on laptop

1. Verify both devices are using the **same PIN on the same day**. A different PIN or date creates a separate session.
2. Check the BRS sync pill on Step 1 — "✓ N photos synced to session" means upload worked.
3. Pull-to-refresh on mobile, or tap the **↻** on step 2 preview.

### Outlook HTML paste shows as plain text

Some Outlook configurations block rich paste. Use the **Download as .eml** option instead — it's more reliable.

### iPhone: HEIC photos

Photos in HEIC format (iPhone's default) upload fine — Gemini reads them natively. The thumbnail will show a generic placeholder because iOS Safari can't render HEIC in-browser, but the data is there.

To force JPEG: on iPhone, Settings → Camera → Formats → **Most Compatible**.

## Data and privacy

- PIN and API key are stored only in the browser's localStorage on the specific device.
- BRS photos sync through Firebase Realtime Database. The path is `sessions/{SHA-256 hash of PIN+date}/photos/…`, so only someone with today's PIN can read or write that session.
- Sessions are not automatically cleaned up server-side yet. If you want to purge a session: on the device, menu → Sign out. (Server-side cleanup TBD — see Backlog.)
- Reports in history are stored only on the device.

## Branding

The app uses the Bank of Uganda brand palette: **crimson, gold, and ink black**, drawn from BOU's official heraldic banner. The built-in brand mark is a stylized shield with the three-light-bulb gold stripe, red/black fields, and scales — evoking the coat of arms without using copyrighted artwork.

### Using the official BOU logo

If you have BOU's official logo (from the internal brand kit or Corporate Affairs department), drop it into the repo root with one of these exact filenames and the app will swap it in automatically everywhere the "BOU" mark appears:

- `logo-bou.svg` (preferred — scales crisp at all sizes)
- `logo-bou.png` (fallback — use a transparent background, at least 256×256 px)

No code changes required. On next deploy the app detects the file and uses it in:
- The PIN screen header
- The API key screen header
- The sticky app header
- The boot splash (still shows the default briefly while loading)

The email report banner still uses the text "Bank of Uganda" rather than an embedded logo — this is intentional. Most email clients block remote images by default, which would leave a broken image icon in the report. Text always renders.

## Backlog / Ideas

- Server-side TTL on Firebase sessions (auto-delete after 7 days)
- PDF export from history
- Light mode option
- Landscape layout tuning for iPad
- Optional: template text snippet above the report in the copied output (e.g. "Dear Alfred, please find attached…")

## Tech stack

Vanilla HTML/CSS/JS — no build step. Multi-file for reliable deployment. Service worker for offline shell. Firebase Realtime Database via REST (no SDK). Gemini 1.5 Flash for image-to-JSON extraction. `ClipboardItem` API for rich-HTML copy.

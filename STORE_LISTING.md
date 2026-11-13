# Recordful — Chrome Web Store listing (copy-paste ready)

Fill these fields in Developer Dashboard > Store listing. Replace
`TODO MEDIA` files in `store-assets/` with real captures before submit,
same filenames, same pixel sizes.

## Basics

- Category: Productivity (alt: Communication)
- Language: English (default locale `en`, 20 locales ship in `_locales/`)
- Support URL: https://recordful.app/contact
- Privacy policy URL (required): https://recordful.app/privacy
- Homepage: https://recordful.app
- Source (GPLv3, linked in description): https://github.com/ikislay/recordful

## Short description (132 chars max, shows under title)

Free screen recorder and screenshot tool. Record tab, window or screen, auto-zoom edits, 4K export, and let AI agents record demos.

## Full description

Recordful is a free screen recorder and screenshot tool for Chrome. Record a tab, a window, an area or your whole screen, and turn it into a polished video in minutes. No account needed to start.

RECORD
• Tab, window, area or full screen, with microphone, system audio and camera
• Camera bubble with background blur
• Draw, blur and spotlight while you record
• Click effects (circle, ripple, pressure) and click sounds
• A floating teleprompter that stays out of your video
• Pause and resume, with keyboard shortcuts to start, pause, stop and mute the mic

EDIT, FREE IN YOUR BROWSER
• Auto-zoom that follows your clicks
• Backgrounds, frames and camera layouts
• Cut, trim and speed up clips, combine recordings, reorder them, and record a voiceover
• Your own watermark: your logo, a line of text, both, or none
• Export MP4 or WebM up to 4K at 60 FPS

SCREENSHOTS
• Capture the visible page, an area, the full scrolling page or a whole screen
• Make it beautiful with a wallpaper picked to match, frames, rounded corners and a 3D tilt
• Copy, download, or share to X, Threads or Forg

AI AGENTS
• Let Claude Code, Cursor, Codex and other AI apps record a demo of what they just built, through the free recordful-mcp server
• Pair once and it connects by itself. Your AI works in its own tab and never touches your other tabs
• It navigates, clicks and types with a smooth on-screen cursor, takes screenshots, and you can stop it any time

PRIVATE BY DEFAULT
Local recordings stay on your device until you export or share them, with no time limit.

RECORDFUL PRO
Cloud storage and instant share links (with a password or an end date), captions, voice cleanup that removes filler words and long pauses, 3D perspective, views, likes and comments on your videos, and the Recordful Agent that edits your video while you chat with it. recordful.app/pro

Also on macOS, Windows and Linux: recordful.app/download
Open source (GPLv3): github.com/ikislay/recordful

## Single purpose (required field)

Screen capture: record the current tab, a window or the screen with audio and
camera, or take a screenshot of it, then edit and export locally. AI apps the
user connects can drive the same recording and screenshot tools.

## Why `<all_urls>` (reviewer justification, paste into justification box)

The content script runs on the page the user chooses to record so it can
draw the recording toolbar, camera bubble, countdown, drawing canvas and
click highlights over that page. No browsing history is collected, no page
content is read or transmitted. Recording starts only when the user presses
record. The same origin covers `web_accessible_resources` (recorder, camera,
editor pages) which must be reachable from any recorded page.

Narrowing to activeTab alone is not enough: the toolbar, pause/resume and
annotation UI must persist while the user switches tabs mid-recording.

## Permission justifications (one line each, CWS form)

- `tabCapture`: captures the tab's video and audio when the user records a tab.
- `desktopCapture` (optional): captures screen / window when the user picks Desktop.
- `scripting`: injects the toolbar and annotation canvas into the recorded page.
- `tabs` + `activeTab`: finds the tab being recorded and opens the editor after stop.
- `storage` + `unlimitedStorage`: keeps recordings in the browser (OPFS/IndexedDB) so long videos work offline.
- `downloads`: saves the exported MP4 / WebM / GIF the user asked for.
- `system.display`: reads display resolution to offer valid max resolution / fps.
- `power`: keeps the device awake while a recording is in progress.
- `identity` + `oauth2 drive.file`: Save to Google Drive only, after the user clicks it. Deferred: ships with upstream client ID, replace with your own before Pro launch (see README).
- `offscreen` (optional): runs the recorder offscreen where Chrome requires it.
- `alarms` (optional): fires the user-set recording time limit.
- `clipboardWrite` (optional): copies the share link on click.
- `nativeMessaging` (optional): requested only when the user turns on AI agents. It connects Recordful to the user's own local recordful-mcp server (the AI agents feature) without polling. Nothing leaves the computer through it.
- `externally_connectable https://recordful.app/*`: login bridge + Pro cloud upload only. Self-hosted builds strip this.
- Host `recordful.app/help`: help articles opened only on user click.

## Privacy / data practices (CWS Data Practices tab, must match /privacy)

- Privacy policy: https://recordful.app/privacy
- Data collected from free local use: none. Recordings stay in the browser on the device.
- Account data (only if user signs in for Pro): name, email, profile picture (Google sign-in), workspace members, subscription status via Polar. Purpose: accounts, billing, sharing.
- User content (only if user uploads for Pro): video/audio tracks, titles, edits, transcripts. Purpose: storage, playback, sharing. Private to workspace, shared only via user-enabled link.
- Diagnostics (only when signed in and on failure): error reports about failed recordings/uploads. Purpose: debugging and recovery.
- No sale of data, no ads, no tracking, no ML training on recordings.
- Certification: data use matches https://recordful.app/privacy, no undisclosed collection.

## Graphics (in `store-assets/`, exact sizes)

| File | Size | Status |
|---|---|---|
| `screenshot-1-popup-1280x800.png` | 1280x800 | TODO MEDIA placeholder, replace |
| `screenshot-2-annotate-1280x800.png` | 1280x800 | TODO MEDIA placeholder, replace |
| `screenshot-3-editor-1280x800.png` | 1280x800 | TODO MEDIA placeholder, replace |
| `small-promo-440x280.png` | 440x280 | TODO MEDIA placeholder, replace |

128px icon ships from `src/assets/img/icon-128.png`. Do not upscale icon-34.

## Pre-submit gates (run in order)

1. `npm run build:cws` (needs `.env.production` with real `RECORDFUL_*`, you are creating it while hosting recordful.app)
2. `node scripts/verify-no-secrets.mjs build`
3. `node scripts/assert-no-dev-env.mjs build --require-prod-origin`
4. Load `build/` unpacked, record 10s tab + camera, annotate, export MP4, open editor.
5. Upload `build-cws.zip` as draft, fill this file's text, submit.

## Known deferrals (not blocking v1, do not claim in listing)

- Google Drive OAuth uses upstream client ID; Save to Drive works but shows upstream consent until replaced. Do not advertise Drive as flagship.
- Cloud upload / login bridge needs production `EXTENSION_ID` set on backend after first upload. Local recording works without it.
- Help links in extension point at `https://help.recordful.app/*`; they 404 until recordful-help is deployed. Deploy help before or with this listing (legacy long URLs redirect, see recordful-help `redirects`).

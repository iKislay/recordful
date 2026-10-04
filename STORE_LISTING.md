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

Free screen recorder: capture tab, screen or camera, annotate live, trim and export. No sign-in needed.

## Full description

Recordful is the free and privacy-friendly screen recorder with no sign in needed.

Record a tab, an app window, your whole screen, or just the camera. Include
mic and system audio, draw and annotate live, spotlight the cursor, blur
sensitive parts, and zoom into details while you record.

After you stop, trim, crop, mute sections, add your own audio, and export to
MP4, WebM or GIF, or save to Google Drive. Your videos never leave your
machine unless you choose to export or share them.

Everything local is unlimited and free: unlimited recordings, no watermarks,
no account. Recordful Pro (recordful.app/pro) adds cloud storage with share
links, multi-scene editing, auto-zoom on clicks, and captions, and supports
indie builder Kislay.

Open source (GPLv3): https://github.com/ikislay/recordful

## Single purpose (required field)

Screen recording: capture the current tab, screen or camera with audio,
annotate while recording, then edit and export locally.

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

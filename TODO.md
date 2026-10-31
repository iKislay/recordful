# Recordful ecosystem: work to do

Local planning file. Written 2026-10-27 for the desktop app, moved to the workspace root and expanded 2026-10-31 to cover the whole ecosystem. Full context so anyone can pick it up cold.

Task labels: `[difficulty · owner · time]`, where difficulty is `easy`/`mid`/`hard`, owner is `backend`, `design + frontend` or `backend + frontend` when both sides are needed (frontend includes design), and time is `less`/`mid`/`high`. Labels apply to unchecked items; `[x]` means done.

## Repos

- `recordful/` — Chrome extension (Cap-derived). Recording, Instant Mode, drawing, teleprompter, agent bridge.
- `recordful-app/` — Electron desktop app (OpenScreen-derived), v1.4.0. Native capture on macOS/Windows, editor, library.
- `recordful-ee/` — Next.js web app, API and marketing site. Auth, dashboard, viewer, share pages, billing, storage, MCP OAuth.
- `recordful-agent-bridge/` — `recordful-mcp` MCP server and CLI (v0.6.0). Page automation, upload/transcript tools, hosted connector design.
- `recordful-help/` — Next.js docs site.

## Competitive baseline (2026-10-31)

Sources: cap.so/pricing, cap.so/changelog (0.6.2, 2026-10-28), cap.so Instant/Studio Mode pages, self-hosting docs; recordly.dev; repo audits.

### Cap.so

- Native desktop (GPUI 0.6.x), web, mobile, extension, CLI/MCP. Instant Mode + Studio Mode + screenshots.
- 0.6.2: 7 languages, Turbo export (2-2.8x), Focus mode, redesigned picker/main window, window-resize chips, area snapping/lock, clip transitions, copy/paste text styles, custom-domain links, 200+ fixes. 0.6.1 made the app fully native: 77% less editor CPU and 88% less memory than the old Tauri app.
- Editor: style/image/3D tracks, color correction, Studio Sound, camera blur/removal (macOS), animated text/cards, moving backgrounds, frames/notch, cursor effects, minimap, export estimates, hardware encode.
- Cloud: unlimited Pro storage; AI titles/summaries/editable chapters; live transcription; threaded/timestamped comments + reactions + notifications; viewer invites; private default; password shares; custom domains; CTA/end screens; watch/retention analytics; Loom importer (bulk CSV/concierge); public API/webhooks; automations.
- Teams: workspaces/roles, SSO/SAML ($199/mo), SCIM, audit, HIPAA/BAA ($99/mo), SOC 2 Type II, ISO 27001, BYO S3/Drive, Docker self-host, OIDC/reverse-proxy, EU transcription.
- Pricing: Free (personal, 5-min share links), Desktop $29/yr or $58 lifetime (20 links/mo), Pro $12/mo or $8.16/mo annual. 80k+ users, 24.1k GitHub stars.

### Recordly (recordly.dev)

- Local-only Electron recorder/editor: auto-zoom, cursor smoothing/bounce/sway, webcam bubble, timeline trim/speed/annotations, wallpapers/blur/padding, MP4/GIF, `.recordly` projects.
- No cloud, teams, AI, collaboration or agent tooling. Recordful already exceeds it; the risk is community mindshare, not feature parity.

### Recordful position

- Ahead: deep motion editor (auto-zoom/cursor/webcam/backgrounds/annotations), local Whisper captions, extension drawing/blur/teleprompter/camera segmentation/screenshots, R2 streaming upload, MCP page automation, cheaper Pro ($3.99/mo, $29.99/yr, 50 GB, 14-day trial).
- Behind: desktop Instant Mode, AI metadata, collaboration depth, share controls, analytics depth, roles/SSO, BYO storage, Loom import, public API, hosted MCP phase 3, editor/capture parity, native performance, mobile, compliance.
- Risks: the agents marketing page outruns the implementation; help docs say $13/$120/100 GB while the site says $3.99/$29.99/50 GB; no telemetry/crash reporting; stale UI specs; two divergent editors.

### Win conditions

- Desktop stop -> share link in 5 seconds or less; the link stays valid after a crash or network drop.
- Share page transcript + AI metadata ready in 10 seconds or less.
- First run -> first share in one session.
- Crash-free sessions at 99.5% or better; recording and export success at 99.5% or better; p95 stop -> link, recovery success and A/V-drift rates measured (none of these are instrumented today).
- Export speed/CPU/memory at or better than Cap 0.6.2.
- Track Pro conversion, seats, storage upgrades, comments per share and viewer return.

## Beat Cap — P0 (ship first)

Goal: close the loop Cap wins today, and remove claims we cannot back.

### Desktop Instant Mode

- [ ] Stream screen/webcam/mic while recording, reusing the extension's R2 multipart uploader and OPFS journal (`recordful/src/pages/CloudRecorder/`). — [hard · backend + frontend · high]
- [ ] Resume after crash/relaunch; link-on-stop; open the watch page and copy the link. — [hard · backend + frontend · high]
- [ ] Offline fallback: keep recording locally, upload later, never lose the take. — [mid · backend · high]
- [ ] Per-track upload, retry/backoff, quota/error states, cancel. — [mid · backend · mid]
- [ ] E2E: 30-minute recording, network drop, app relaunch, link remains valid. — [mid · backend · mid]

### Recording reliability and recovery

Current state: macOS has native capture-output recovery (`recoverNativeMacCaptureOutput`), Windows validates output on stop (`recording.ts:1015`, `:1087`), but `recover-native-screen-recording` rejects non-macOS (`recording.ts:1307`), there is no startup scan, no quit-time finalize (Windows helper is killed at `main.ts:885`), and no health/preflight/power handling. Treat the items below as the gap, not as already shipped.

- [ ] Cross-OS recording journal: atomic project/segment writes, crash sentinel, startup scan of unfinished takes, media validation, reopen/repair/export. Extend recovery to Windows/Linux and handle helper death. — [hard · backend · high]
- [ ] Health monitor: free disk, write stalls, encoder init/fallback, dropped frames, device loss, A/V drift. Show "recording degraded" with error codes and a one-click support bundle; pause/finalize instead of silently inserting silence. — [hard · backend + frontend · high]
- [ ] Preflight before countdown: target display/window still exists, resolution/DPI, system audio, mic/camera, encoder probe, disk headroom for the selected duration. Permissions already exist (`preparePermissions`); do not rebuild them. — [mid · backend + frontend · mid]
- [ ] Power lifecycle: `powerMonitor` suspend/resume/lock/shutdown; pause and finalize before sleep, resume without timestamp corruption, block quit while recording or offer "stop and save". No power handling exists today. — [mid · backend · mid]
- [ ] Soak matrix: 30/60/120 min and a 6 h target on macOS/Windows/Linux X11, 4K/60, multi-monitor/DPI changes, disk-full, device unplug, network drop; assert duration, frame gaps, A/V drift, seekability, recovery. Define surface caps: extension Instant defaults to 1 h, local extension warns at 90 min, desktop has no explicit cap. — [mid · backend · high]
- [ ] Export reliability: codec/disk preflight, monotonic progress/ETA, cancel (exists) + retry/re-render, resume after app close, post-export validation (`validateRecordedVideo` exists), and benchmarks vs Cap 0.6.2. — [hard · backend · high]

### AI metadata

- [ ] Auto title, summary and clickable chapters from the transcript; store and show on `/view/[id]` and embeds. — [mid · backend + frontend · mid]
- [ ] Edit/regenerate summary and chapters; API + MCP tools. — [mid · backend · mid]
- [ ] Live transcript while uploading (Cap parity); transcript tab opens by default for fresh shares. — [mid · backend + frontend · high]
- [ ] Optional translation for captions (Cap has zh-TW etc.); test the current auto + 9 languages (en/es/fr/de/it/pt/zh/ja/ko) and state the supported matrix. Do not claim Tella's 106 languages. — [mid · backend · mid]

### Collaboration

- [ ] Threaded replies and timestamped comments; emoji reactions; @mentions; resolve; notifications; moderation. — [hard · backend + frontend · high]
- [ ] Viewer invites by email; invited-viewer list/revoke; access audit. — [mid · backend · mid]
- [ ] Schema migration, APIs, MCP tools and tests. — [mid · backend · mid]

### Share controls

- [ ] Password-protected links; expiry; download toggle; CTA/end screen; `?captions=off`; autoplay/start-at. — [mid · backend + frontend · mid]
- [ ] Custom domain links for Instant, Studio and screenshots. — [hard · backend · high]
- [ ] Private-by-default org setting and real creation default: the server currently omits flags -> workspace; extension/desktop new shares default public. Add embed presets; OG dimensions. — [mid · backend · mid]

### Trust and observability

- [ ] Implement or remove the `recordful-ee/app/(site)/features/agents/page.tsx` claims: titles/summaries/chapters, reactions/replies/timestamps, Loom imports, developer apps/credits. — [mid · backend + frontend · mid]
- [ ] Align pricing/storage across `recordful-ee/lib/site.ts`, `components/pricing-section.tsx` and `recordful-help/content/docs/pro/` ($13/$120/100 GB vs $3.99/$29.99/50 GB). — [easy · design + frontend · less]
- [ ] Opt-in telemetry, crash reporting and funnel metrics (record -> edit -> export -> share) in desktop, extension and web. — [hard · backend + frontend · high]
- [ ] Fix stale Playwright/UI specs (`project-dashboard`, `feedback`, `login`, `onboarding`, `account-settings`) to the revamp labels and real flows; `project-dashboard` still targets Home/folder chips/sidebar cards and `HomeLoadingSkeleton` still draws the old dashboard. Install browser 1248. — [mid · design + frontend · mid]

## Beat Cap — P1 (30-90 days)

### Cloud and analytics

- [ ] Watch time, completion, retention curve, drop-off, unique/repeat viewers. — [mid · backend + frontend · mid]
- [ ] Source/UTM/referrer/country (country exists) + device/browser; CSV export; CTA conversion. — [mid · backend + frontend · mid]
- [ ] Weekly digest and insight cards. — [mid · backend + frontend · mid]

### Workspaces and enterprise

- [ ] Roles owner/admin/member/viewer; folder permissions; ownership transfer; guest access. — [hard · backend + frontend · high]
- [ ] Workspace switcher; multiple workspaces; default visibility; member caps. — [mid · backend + frontend · mid]
- [ ] SSO/SAML, SCIM, audit log, retention policies, session/device management. — [hard · backend + frontend · high]
- [ ] Admin console: usage, storage, seats, billing, export. — [hard · backend + frontend · high]

### Storage, migration and platform

- [ ] BYO S3/R2 and Google Drive; per-workspace storage config. — [hard · backend + frontend · high]
- [ ] Storage packs (+50 GB at $2/mo); quota grace; `waiting-for-room` resume. — [mid · backend · mid]
- [ ] Loom importer: single, bulk CSV, concierge, resumable; thumbnail/transcript on first view. — [hard · backend · high]
- [ ] Public REST API, webhooks, API keys, rate limits, docs. — [hard · backend · high]
- [ ] CLI parity: `record`, `export` (batch), `project validate/inspect`, `jobs wait`, `recordings list`, `--json`. — [mid · backend · mid]
- [ ] Automations: upload/delete rules; wait for dependent jobs. — [mid · backend · mid]

### MCP

- [ ] Phase 3 hosted connector: `mcp.recordful.app` Worker, staging, extension relay, OAuth consent browser check, audit/revoke. — [hard · backend · high]
- [ ] Phase 2 editor tools: `trim`, `cut_dead_air`, `zoom_at`, `add_caption`, `export`. — [mid · backend · mid]
- [ ] Finish Phase 1 loose ends: on-page stop button, markers. — [easy · backend · less]
- [ ] Directory listings (Anthropic/OpenAI) after staging passes. — [easy · backend · less]

### Editor parity

- [ ] Clip transitions (crossfade, fade through black, 0.25-1.5 s). — [mid · backend + frontend · mid]
- [ ] Style tracks, image tracks, 3D camera tracks (perspective, easing, focus blur). — [hard · backend + frontend · high]
- [ ] Color correction for screen and camera; presets; LUT import (.cube) with intensity and before/after (no LUT pipeline today). — [mid · backend + frontend · mid]
- [ ] Studio Sound presets (Light/Balanced/Strong); default for new recordings. — [hard · backend · high]
- [ ] Camera background blur/removal (macOS first); the extension already has segmentation. The current desktop "Remove background" toggle only switches aspect ratio/padding; it does not segment the camera. — [hard · backend · high]
- [ ] Animated text/cards, moving gradients, frames (macOS/Windows/browser/MacBook), notch overlay. — [mid · backend + frontend · high]
- [ ] Copy/paste text styles, snapping, minimap, multi-select zooms, export estimates. — [mid · design + frontend · mid]

### Creator depth (Tella gaps only)

Already present: clip add/reorder/ripple, web filler/pause cuts, web manual camera layouts/transitions, 4K/60 capture, 60 fps MP4 export, Whisper captions, extension teleprompter. Only the gaps:

- [ ] Independent multi-clip projects: per-clip media sources/references, re-record or replace one clip, reusable takes, per-clip audio. Today a `ClipRegion` is a time range inside one shared `videoSourcePath` (`types.ts:229`). — [hard · backend + frontend · high]
- [ ] Desktop transcript editing: select transcript text to cut and Auto Cut filler/pause removal mapped to reversible clip regions. Web already has `recordful-ee/lib/cuts.ts`; desktop has captions but no auto-cut. — [mid · backend + frontend · high]
- [ ] Per-clip/scene camera layouts on desktop: screen/camera/side-by-side, morph/fade/cut, camera switching and auto-zoom per scene. Desktop currently has a global webcam overlay; web already has manual time-based layouts. — [hard · backend + frontend · high]
- [ ] 4K/60 and long-recording validation: capture and 60 fps export exist, but there is no real-OS 4K/60 or 60-120 min/6 h test. Pair with the soak matrix above; do not claim 6 h until it passes. — [mid · backend · high]

### Capture parity

- [ ] Desktop screenshots: area/window/full page, annotate (pen/arrow/shape/text/numbered step/crop/resize), pixelate/blur/highlight, copy/save/open editor, after-capture action. Reuse `recordful-ee/components/shot/`; desktop has none today. — [mid · backend + frontend · high]
- [ ] Multi-monitor correctness: target by display ID, honor DPI/scale changes and disconnect, never stretch or capture the wrong display (Cap #3592). — [mid · backend · mid]
- [ ] Focus mode: record a single window, keep other windows out, follow it if it moves. — [mid · backend · mid]
- [ ] Window resize/aspect chips (21:9, 16:9, 16:10, 4:3, 1:1, 9:16, 720p/1080p/1440p/4K). — [easy · design + frontend · mid]
- [ ] Area snapping/lock, one-click fit-to-window, arrow-key nudge. — [mid · design + frontend · mid]
- [ ] User-selectable excluded windows (macOS/Windows); hardware encode (NVENC/VA-API/VideoToolbox). — [hard · backend · high]

### Growth

- [ ] Free share-link allowance (Cap: 5-min links); watermark-free local export. — [mid · backend + frontend · mid]
- [ ] Comparison/SEO pages: vs Cap, Loom, Screen Studio, Recordly, Tella, OBS; use-case pages. — [easy · design + frontend · mid]
- [ ] Homebrew/AUR/winget/Microsoft Store; Chrome Web Store listing refresh; auto-update channels. — [mid · backend · mid]
- [ ] Community (Discord/GitHub Discussions), testimonials, launch plan, changelog cadence. — [easy · design + frontend · mid]

## Beat Cap — P2 (90-180 days)

- [ ] Docker self-host; OIDC and reverse-proxy auth; S3-compatible storage; EU transcription. — [hard · backend · high]
- [ ] SOC 2 Type II / ISO 27001 roadmap; HIPAA + BAA; DPA; subprocessors; trust portal; status page with incident history; public support SLA; refund/cancel policy; self-serve billing portal. — [hard · backend · high]
- [ ] Data export/delete, retention, encryption/key rotation, audit log. — [hard · backend · high]
- [ ] Mobile app (record/watch/share) — Cap has mobile. — [hard · backend + frontend · high]
- [ ] Commercial desktop license ($29/yr or $58 lifetime), student/volume pricing. — [mid · backend + frontend · mid]
- [ ] Native performance path vs Electron: profiling budgets, GPU preview, Turbo export, crash recovery. — [hard · backend · high]
- [ ] Unify the web and desktop editors on one project format and one component set. — [hard · backend + frontend · high]

### Double down (where Cap is weaker)

- Agent-native: local MCP page automation + editor-over-MCP; "record and edit in one prompt".
- Local-first/privacy: no-upload mode, offline editor, Linux, open source.
- Price: $3.99/$29.99 vs Cap $8.16-12; add a commercial license.
- Unified ecosystem: extension + desktop + web + help + MCP share one identity and project format.
- Deep motion editor + Linux/Wayland support.

## Where things stand

- **Assets** are all Recordful's now (icons, wallpapers `bg1..bg12`, Outfit font, fixtures). Cursor SVG packs in `src/assets/cursors/` are still the ORIGINAL upstream art, kept on purpose for now. Needs a decision later (see "Open decisions").
- **Storybook** (`npm run storybook`, port 6006) catalogues the current UI: Foundations, Primitives, Components, Screens. Stories live in `src/stories/`. Renderer-only; the Electron bridge is mocked in `.storybook/electronApiMock.ts`.
- **Revamped UI** lives in `src/components/revamp/` (moved out of `src/stories/revamp/` on 2026-10-27). Stories import it from there, so the app and Storybook share one copy; mock data stays in `src/stories/mocks/` (sharing mocks in `mocks/sharing.ts`, provided to every story by `.storybook/preview.tsx`). It is used by EVERY story that shows these parts: `Components/Dashboard`, `Components/HUD`, `Components/Teleprompter` and `Screens` (Dashboard, Dashboard First Run, Recording HUD (setup), Recording In Progress, Teleprompter Window). When a part is redesigned, update all of those, not just one.
  - Dashboard: Library (was Home, books icon), Upload under Record new, pill header with grid/list + sort, time-filter chips, hand-pen empty state. No trash button: a card menu Delete starts selection with that card picked, then pick more and use the bar (Select all / Delete / Cancel).
  - HUD rule: BEFORE recording show only setup (capture mode + source, mic, camera, record, close, and an Options menu with countdown, system audio, teleprompter). DURING recording show only what can still change (timer, pause/resume, finish, draw / blur / cursor-effect tools, mic mute, and a More menu with restart, hide toolbar, cancel). No camera, source, countdown, teleprompter toggle or Library button once recording starts, and no Library button at all. UI only, not wired.
  - Teleprompter: extension window ported, UI only.
  - Sidebar (Kintsugi-style): logo + collapse button, Record new, Upload, Library with Private / Workspace / Public filters under it (thin guide line, open one as a white pill; replaced the folder tree), Raw, Settings at the bottom, user card with sign-out icon (sign-out not wired). No Shared tab any more.
  - Sharing (`RevampSharing.tsx`, `RevampProjectCard.tsx`, stories in `Components/Sharing`, `Components/Dashboard` ProjectCards*, `Screens` Library*/Dashboard*/EditorShareLink*): see "Workspace sharing" below.
  - Folders live in the main area as manila-folder cards (neutral, tinted with the folder colour on hover; the front sheet shows the first recording inside, or sketched lines when empty). Folders nest (`parentId`, story-only; the real `useProjectFolders` list is flat). Breadcrumbs inside a folder. New folder creates the folder where you are and opens its name for typing; Rename in the card menu (or double-click) edits the name in place. Enter or leaving the field saves, Escape cancels. "New subfolder" opens the parent folder and names the new one there.
  - Every other screen is now designed too (files in `src/stories/revamp/`):
    - `RevampSettings.tsx`: one Settings component for both the dashboard page and (with `compact`) the editor's Settings tab. Categories General, Account, Recording, Permissions, Motion, Files, Advanced; platform-aware (macOS permission rows, "not on Linux" for hiding the toolbar). "Open the editor when a recording stops" and "Check for updates" are NEW settings that don't exist yet.
    - `RevampLibraryPages.tsx`: Raw (original takes with tracks, size, Open in editor). The Shared page was removed.
    - `RevampEditor.tsx`: top bar (Library / project name rename, saved state, undo/redo, shortcuts, feedback, Publish), tool rail (Clips, Scene, Cursor, Webcam, Captions, Settings; Clips moved from the header into the rail), inspector panels per section plus Zoom / Annotation / Clip / Audio selection panels, preview stage, timeline with Video / Zoom / Notes / Captions / Audio tracks, Publish panel (Share link / Export file, MP4/GIF, quality, fps, captions .srt; exporting, done, error). NEW ideas not in the app yet: shadow slider, webcam shape/mirror/border, zoom in/out duration per zoom, "Fixed point" zoom focus.
    - `RevampDialogs.tsx`: sign-in (signed out / waiting for browser / error / signed in), 3-step onboarding (account, permissions, ready), feedback (+ sent, signed out), save project, unsaved changes, cursor-smoothing unavailable, keyboard shortcuts (with recording + conflict states), What's new, crop.
    - `RevampCapture.tsx`: countdown, capture picker (screen / window / area with handles), Linux source list, update toast (available, experimental, downloading, ready, error).
    - Stories: `Components/Editor`, `Components/Settings`, `Components/Dialogs`, `Components/Capture`; `Components/Auth` and `Components/HUD` Feedback now use the revamp too; `Screens` has every window and the dialogs over them.
- **Auth** is being migrated by another session from Supabase to recordful-ee accounts (`src/lib/auth/recordfulAuth.ts`, `electron/ipc/register/account.ts`). The `Screens` and some `Components` stories broke because `src/lib/feedback/submitFeedback.ts` still imports the removed `recordfulAuth` export. Fix after that migration lands; `.storybook/authMock.ts` also still mocks the old Supabase calls and should be redone for the new account API.

## Porting the revamp into the app (started 2026-10-27)

Done:
- **Dashboard**: `video-editor/dashboard/Dashboard.tsx` renders `RevampDashboard` on the real model. Folders nest for real (`ProjectFolder.parentId`, old flat lists load as top level); the Library's top level lists only projects not in a folder (a search looks everywhere); new folder / rename / subfolder / remove; **Move to folder** dialog (new: the revamp card had no way to file a project); inline project rename moves folder refs and share links (`renameProject`); Show in folder; account card with sign-out. Old `DashboardSidebar`, `DashboardGrid`, `FolderRow`, `FolderColors`, `RecordNewButton`, `SidebarCards`, `sidebarCardConfig` deleted. `DashboardAnnouncements` is no longer shown on the dashboard (file and story kept).
- **Raw page**: real takes (`useRawLibrary`), poster + length read from the file, size, Preview / Show in folder / Remove from Raw. "Open in editor" became "Preview": there is no "new project from a raw take" yet.
- **Sharing, wired** (`cloud/useCloudSharing.ts`): plan from the account (`subscribed`) and `/api/storage/quota` (full -> `pro-full`); a project is private until it has a share link; visibility and views come from `/api/videos` (`parseCloudRecordingList` now returns them); changing an uploaded project's visibility PATCHes `/api/videos/:id` (new `cloud-share-manage` action `visibility`); choosing Workspace/Public for a project that isn't uploaded opens it in the editor's share flow with that visibility (`pendingShareVisibility.ts`; `cloud-share-upload` takes `visibility`, private is PATCHed after create). Upgrade opens `/upgrade`, sign-up starts the browser sign-in, Add storage opens `/settings` (no storage product yet), Free up space opens `/dashboard`.
- Not wired, hidden in the app (shown in Storybook via `SharingSource` flags): folder sharing (`folderSharing`), thumbnail editing (`thumbnailEditing`).
- **Editor layout**: the tool rail + its panel are a full-height left column; preview and timeline stack on the right (`EditorShell.tsx`), as in recordful-ee.

Left to port:
- [x] Settings page (2026-10-27): `RevampSettings` reads theme/language from their contexts, app-wide values through `revamp/useAppSettings.ts` (folders, HUD capture protection, countdown, permissions, update channel, version, check for updates) and the editor's motion defaults through `SettingsMotionContext` (`layout/settingsMotion.ts`). Old `DashboardSettings` deleted. "Open the editor when a recording stops" was dropped from the design: no such setting exists. The editor's own Settings tab still uses the old `SettingsPanel` section until the editor port (it also keeps the dev-only motion tuning sliders).
- [x] Editor chrome (2026-10-28): top bar (`EditorHeader`: Library / name pill / saved dot / undo, redo / shortcuts / feedback / Publish), tool rail with Clips first and the inspector card (`EditorSidebar`; Settings tab = `RevampSettings compact`), preview and timeline as `bg-surface` cards (`EditorShell`, `EditorTimelinePanel`), Split / Zoom / Annotate pills on the timeline card (`EditorTimelineToolbar`), timeline item tints (`ItemGlass.module.css`), Captions panel in the revamp layout, Publish panel (`EditorExportMenu` + `cloud/ShareLinkPanel.tsx`: uploaded projects get the real share options; Pro without an upload picks who can watch and uploads, default Public; free / signed-out / full see sign-up, Pro or storage), loading skeleton.
- [ ] Still the old look inside the inspector: Scene, Cursor, Webcam panels and the zoom / annotation / clip / audio selection panels are restyled only by the card around them; the export options form (`ExportSettingsMenu`) keeps its own chips. The editor Settings tab no longer shows the DEV-only camera/cursor spring tuning sliders or the native-capture warning tester. — [mid · design + frontend · mid]
- [x] Removed `SharedRecordings`, its `sharedRecordingDate` helper and the shared-recordings fixture (2026-10-29); `CloudShareButton` is now inline-only; `ProjectCard`, `ProjectFolderChips`, `DashboardToolbar`, `DashboardFilters` deleted. `publish-cloud` specs rewritten for the revamped Publish panel.
- [x] Dialogs (2026-10-27): `Sheet` is a HeroUI modal now (stacks over the dashboard). Onboarding (`OnboardingController` -> `OnboardingDialog`, account required as before, real permission requests), editor sign-in (`auth/SignInSheet.tsx`), feedback (`feedback/FeedbackDialog.tsx`), save / unsaved changes / cursor unavailable (`EditorDialogs`), shortcuts (`ShortcutsConfigDialog`, same logic), crop (`CropEditorDialog`, real `CropControl` inside), What's new (`AnnouncementDialog`, same feed logic). Old `RecordfulSignInDialog`, `OnboardingPermissions`, `OnboardingLayout`, `PermissionsConfetti`, `Onboarding.css` deleted. The onboarding's "Skip for now" is hidden in the app because recording requires an account.
- [x] Capture windows: countdown, capture picker, Linux source list, update toast.
- [x] HUD (2026-10-31): idle bar = Screen / Window / Region tiles (open the capture picker in that mode via `pickCaptureTarget(mode)`), source label, mic, camera, Options menu (countdown stepper, system audio), Record, Close. Recording bar = timer, pause, finish, mic state, More menu (Restart with a second-click confirm, Hide toolbar, Cancel recording). Popovers are rounded surface menus (`PopoverScaffold`: MenuLabel/MenuRow/MenuSwitch/MenuStepper/MenuAction). Hidden until they have a backend: teleprompter toggle, Draw / Blur / Cursor-effect rows, live mic mute.
- [x] Teleprompter window (2026-10-31): `electron/teleprompterWindow.ts` (frameless, resizable, always-on-top below the HUD, content protection, bounds saved in `teleprompter-window.json`), IPC in `electron/ipc/register/teleprompter.ts`, renderer `?windowType=teleprompter` (`components/teleprompter/TeleprompterWindow.tsx` on `RevampTeleprompter`), settings in app settings `recordful.teleprompter.v1`, intro once, Teleprompter switch in the HUD Options menu. macOS + Windows only (Linux has no content protection). On macOS an open teleprompter excludes Recordful's process from ScreenCaptureKit, which also hides the HUD from that take. Not done: mirror mode. — [mid · backend + frontend · high]

## Feedback (stored in Neon only)

- Desktop app: the Feedback dialog sends to recordful-ee `POST /api/feedback`, which writes one row to `feedback_reports` in Neon (title, subject, message, redacted logs, attachment list). Attachments themselves go to R2 under `feedback/<user>/<id>/`; the row keeps their keys. Nothing is emailed or forwarded. Ten reports a day per account.
- recordful-ee: migration `0017_desktop_feedback.sql` is generated but **not applied** to Neon, and the route (`app/api/feedback/`) is uncommitted there. Apply and commit before feedback works end to end.
- [ ] Operator admin dashboard (later, by the owner) reads `feedback_reports` (and `export_error_reports`), with signed links to the R2 attachments. — [mid · backend + frontend · mid]
- [ ] **Extension feedback**: the Chrome extension (`recordful/`) still opens a Tally form (`https://tally.so/r/q406A9`, from `src/pages/Background/messaging/handlers.js` and `src/pages/Content/popup/PopupContainer.jsx`). Replace it with the same in-product feedback dialog posting to `/api/feedback` (the extension already has the account's session), so all feedback lands in `feedback_reports`. The uninstall survey (`tally.so/r/KYdb1X`, `uninstallSurvey.js`) can't use an in-product dialog (the extension is gone by then); keep it or point it at a recordful.app page that writes to Neon. — [mid · backend + frontend · mid]

## Workspace sharing (designed in Storybook; partly wired, see above)

The app is single-user and local today. recordful-ee already has the model: every recording and folder belongs to a workspace; a recording is `private` (only its recorder, `isPrivate`), `workspace` (signed-in members, neither flag) or `public` (anyone with the link, `isPublic`), see `recordful-ee/lib/visibility.ts`. Views count opens from outside the workspace (`recordings.views`). Pro storage is 50 GB per workspace (`STORAGE_LIMIT_BYTES`, `/api/storage/quota`).

What the design says:
- New recordings are **Private** by default. Cards and list rows show the visibility label, then the cloud badge right beside it (only when not uploaded), then views (only for Workspace / Public). The folder chip is gone from cards: the folder is where you opened it from.
- **Share** is in every project's and folder's menu. It opens the Share dialog: Who can watch (Private / Workspace / Public), the link with Copy, and for recordings a Thumbnail with a pencil to pick a frame or upload an image. A folder's visibility carries down to everything inside except recordings someone keeps private (recordful-ee `setFolderPublic` does the same for public).
- In the editor, Publish → Share link shows the same options inside the Publish panel (no centred dialog).
- Sidebar: Library → Private / Workspace / Public filter every folder and project by visibility (top-most matching folders, plus matching projects not inside them). The Shared tab is gone.
- Cloud badge (`CloudSlash`), by account:
  - signed out: grey, "Not uploaded to the cloud" → sign-up dialog (`SignInDialog reason="cloud"`).
  - free: grey, same tooltip → Upgrade dialog (benefits from `recordful-ee/components/pro.tsx`, $3.99/mo or $29.99/yr, 14-day trial).
  - Pro: every recording uploads on its own; no badge.
  - Pro, storage full: red, "Storage full, not backed up", only on recordings that couldn't upload → Add storage dialog ($2 per +50 GB per month, stepper, "Free up space instead").
  - Free and signed-out users can't share or change visibility; Share and Publish → Share link lead to sign-up / upgrade. Local export stays free.

Changes needed in the main app beyond UI:
- [ ] **Account/workspace in the desktop app**: read `workspaceId`, role and plan from `/api/auth/verify` (already returns `subscribed`); show the workspace name; later a workspace switcher (ee reads `session.activeOrganizationId`). — [mid · backend + frontend · mid]
- [ ] **Auto-upload for Pro + desktop Instant Mode**: after recording/saving, upload every project to recordful-ee in the background (resumable, as the extension does); stream while recording so the link is ready when the take stops (see "Beat Cap — P0"). A per-project sync state (`local` / `uploading` / `uploaded` / `waiting-for-room` / `failed`) persisted next to the project, driving the badge. Map local project path ↔ cloud recording id (today `projectShareLinks.ts` only stores share URLs). — [hard · backend + frontend · high]
- [ ] **Visibility API calls**: set a recording's visibility (ee: update `isPublic` / `isPrivate`), set a folder's visibility, read views. Default new uploads to private (ee's column default is workspace: `isPrivate=false`; uploads from the app must send `private`). — [mid · backend · mid]
- [ ] **Folders on recordful-ee**: only have `isPublic` today. Sharing a folder with the workspace or keeping it private needs `isPrivate` (or a `visibility` column) on `folders`, the same check constraint, and cascading like `setFolderPublic`. Sync local folders (story `parentId`) to ee `folders` (`parentId` already exists there). — [mid · backend · mid]
- [ ] **Custom thumbnails**: ee has no thumbnail column/upload; add one (frame time or uploaded image in R2) and use it on `/view/[id]` and OG images. — [mid · backend + frontend · mid]
- [ ] **Storage add-ons**: billing for +50 GB packs at $2/month each (Polar/Stripe product, quantity), `STORAGE_LIMIT_BYTES` becomes base + packs, `/api/storage/quota` returns it; an upload over quota returns a clear error the app maps to `waiting-for-room`, and uploads resume when room appears. — [mid · backend + frontend · mid]
- [x] Sign-up from the badge opens recordful.app sign-up (not sign-in) and returns to the app via the existing auth callback. (2026-10-31)

## What the extension toolbar has that the desktop HUD lacks

Source: `recordful/src/pages/Content/toolbar/` (`ToolbarWrap.jsx`, `layout/DrawingToolbar.jsx`, `BlurToolbar.jsx`, `CursorToolbar.jsx`, `ShapeToolbar.jsx`) and `popup/`.

**In-recording toolbar**: finish, restart, pause/resume, cancel, drawing tools toggle, blur tool toggle, cursor options toggle, camera on/off, camera preview, hide toolbar, mic toggle (with push-to-talk).

**Drawing tools**: select, pen, highlighter, eraser, text, shape (rectangle/circle, fill toggle), arrow, image, undo, redo, clear canvas, color wheel, stroke weight.

**Blur tool**: drag over page elements to blur them; "clear all blurred elements".

**Cursor options**: click effects (circle, ripple, pressure), highlight cursor, spotlight cursor.

**Popup / setup**: capture mode (screen, window/tab, region/area, camera-only), region width/height, system audio, push-to-talk, countdown, flip camera, camera preview while recording, max resolution, max FPS, background effects (blur / images), teleprompter, shortcuts.

Present in the desktop HUD today: source name, mic toggle, webcam toggle, countdown delay, record, home, hide HUD, close; while recording: pause/resume, stop, cancel, timer, mic.

## Feasibility by platform (the important part)

The extension draws INTO THE WEB PAGE. A desktop app cannot; it records the whole screen. So anything "live on screen" needs a different mechanism. Key facts verified in this repo:

- HUD is a transparent always-on-top `BrowserWindow` (`electron/windows.ts`, ~line 518).
- Click-through (`setIgnoreMouseEvents(true, {forward:true})`) is **not supported on Linux** (`isHudOverlayMousePassthroughSupported()` returns `platform !== "linux"`).
- Hiding the HUD from the recording uses `setContentProtection`, supported on **macOS and Windows only** (`src/lib/hudCaptureProtection.ts`).
- Native capture helpers exist for macOS (ScreenCaptureKit, `electron/ipc/recording/mac.ts`) and Windows (WGC, `electron/ipc/recording/windows.ts`). Linux records through Electron capture APIs; on Wayland the system picker appears at record start.
- Cursor and click telemetry is recorded natively (`electron/ipc/cursor/`), and the EDITOR already renders click effects (`CursorClickEffectStyle`: none, spotlight, ripple, echo) and annotations (`AnnotationType`: text, image, figure, blur) AFTER recording.
- `uiohook-napi` is a dependency (global key/mouse hooks).

| Feature | macOS | Windows | Linux | How |
|---|---|---|---|---|
| Pause / resume / cancel / restart | yes | yes | yes | Recorder side. Restart = cancel + start. |
| Mic, camera, countdown | yes | yes | yes | Already built. |
| Full screen / window capture | yes | yes | limited | Wayland: system picker only. |
| Region capture | needs work | needs work | limited | Region-select overlay, then crop. Wayland can't do a free overlay. |
| System audio | needs work | yes | limited | macOS 13+ via ScreenCaptureKit (a companion audio path exists: `macCompanionAudio.ts`). Linux: PulseAudio/PipeWire monitor source. |
| Click effects, spotlight, highlight | yes | yes | limited | Do it in the EDITOR (already there), not live. Cheapest and cleanest. Linux cursor telemetry is partial. |
| Live drawing (pen, shapes, arrow, text) | needs work | needs work | limited | Full-screen transparent overlay window that toggles click-through while a tool is active. Must be CAPTURED (do not enable content protection on it) while the toolbar stays excluded. No click-through on Linux, so it would block the desktop. |
| Live blur of screen areas | needs work | needs work | **no** | Same overlay but the blur must be pixel-accurate over the captured frame, which a transparent window cannot do (it can't read what's behind it). Realistic route: record a "blur region" (rect + time) and apply it in the editor/export, which the editor's `blur` annotation already supports. |
| Push-to-talk | needs work | needs work | limited | Global hotkey via uiohook. Wayland blocks global key hooks. macOS needs Accessibility permission (already requested for cursor tracking). |
| Teleprompter | needs work | needs work | limited | Separate always-on-top window with content protection on, so it isn't recorded. No protection on Linux = it WILL appear in the recording there. |
| Hide toolbar from recording | yes | yes | **no** | Existing setting. |

Recommendation: ship in this order, because it keeps the recording pipeline untouched until the last step:
1. Add the toolbar UI and state with the no-risk controls (restart, camera preview, mode tiles, system audio toggle, max resolution/FPS).
2. Click effects / spotlight / highlight as RECORD-TIME choices that are applied in the editor (the editor renders them already).
3. Blur as a recorded region applied at edit time.
4. Live drawing overlay (macOS + Windows first; Linux documented as unsupported).
5. Push-to-talk, teleprompter.

## Teleprompter: full feature detail

UI is in Storybook (`Revamp/Teleprompter`, files `src/stories/revamp/RevampTeleprompter.tsx`). Source of truth is the extension: `recordful/src/pages/Content/teleprompter/` (`Teleprompter.jsx` 868 lines, `TeleprompterController.jsx`, `TeleprompterRow.jsx`, `prompterRules.js`, `prompterSettings.js`, `prompterWindow.js`). Port the pure rules verbatim (they are framework-free and have no DOM).

**What it is.** A floating script window the presenter reads while recording. The extension opens it as a Document Picture-in-Picture window (420 x 380), because a PiP window is not part of a shared tab or window, so it does not appear in the recording.

**Features to match**
- Script text, centred, 500 weight, line height 1.5, fades out at top (under the toolbar) and bottom with a CSS mask; dark surface `#1b1b1f`.
- Click the text to edit (textarea, same metrics so nothing shifts when switching); Escape leaves editing; empty script shows the placeholder "Write or paste your script". Editing is blocked mid-recording.
- Play / pause scrolling. Disabled until a recording is running ("Scrolls automatically once you start recording"). Rewind to the top. Manual wheel or drag pauses auto-scroll; play resumes from there.
- Speed in words per minute: 80 to 240, step 10, default 120. Text size 20 to 72 px, step 4, default 28. Scroll speed = `wpmToPxPerSecond(wpm, fontSize, width)` (rough on purpose; copied into the story).
- "Scroll automatically" checkbox (default on): starts scrolling when the recording starts.
- "More script options" menu: text size stepper, speed stepper, auto-scroll checkbox, "Clear script" (needs a second click: "Click again to clear"). Full keyboard support (arrows, Home, End, Escape).
- "Hide script" button, tooltips on every control, toolbar dims when the pointer is away.
- Settings persist (`script`, `fontSize`, `wpm`, `autoScroll`), normalised on load so partial or hand-edited storage is safe. Desktop: store in the app settings (`setAppSetting`), not localStorage.
- Setup row: switch labelled "Teleprompter" (or "Teleprompter (not available on this page)"). First turn-on shows the intro dialog "How the teleprompter works" with "Got it"; remembered once seen.
- Safety rules (`prompterCaptureStatus`, `shouldClosePrompter`): safe for tab/region/camera captures and shared windows; UNSAFE for whole-monitor capture because every window is recorded. In that case it closes when recording starts and shows the toast "Teleprompter closed to keep it out of your recording". The script is always saved.

**Desktop approach and platform limits**
- Use a second frameless always-on-top `BrowserWindow` (like the HUD, `electron/windows.ts`), not PiP.
- Keep it out of the recording with `win.setContentProtection(true)`: works on **macOS and Windows**. On **Linux there is no content protection**, so on a full-screen capture it WILL be in the video. Reuse the extension's rule: on Linux treat full-screen capture as "unsafe" and either refuse or warn; window capture is fine only if the prompter is not part of that window.
- Windows WGC window capture and macOS ScreenCaptureKit exclude other windows already; monitor capture needs content protection (the HUD already relies on `hudCaptureProtection.ts`, see `getHudCaptureExcludedProcessIds`, which also excludes the HUD's process ids from native capture; do the same for this window).
- Needs: new window type + IPC (`teleprompter:open/close/settings`), settings in app settings, a toggle in the HUD setup (`Revamp/HUD`), and the intro dialog.
- Drag and resize the window like a normal tool window (extension is fixed at 420x380; desktop can allow resizing, persist bounds).
- Open question: mirror mode (flip horizontally) for beam-splitter prompters; not in the extension.

## Concrete TODO list

Desktop-only wiring; Cap/Tella parity items live in the P0/P1 sections above.

- [x] Wire `Revamp/HUD` into `src/components/launch/` (`LaunchWindow.tsx`, `RecordingControls.tsx`) for everything that has a backend.
- [x] Capture-mode tiles (screen / window / region); region is the picker's existing macOS-only area capture; hidden on Wayland. Area capture on Windows/X11 still to build.
- [ ] System audio toggle: confirm macOS 13+ path, add a Linux monitor-source path or hide the toggle there. — [mid · backend · mid]
- [x] Restart recording (cancel, wait for `cancelRecording()` to release the capture, start) with confirm.
- [ ] Camera preview toggle while recording (a floating webcam preview already exists: `floatingWebcamPreview.ts`). — [easy · backend · less]
- [ ] Max resolution / max FPS settings. — [mid · backend + frontend · mid]
- [ ] Record-time cursor effect picker, persisted to the project so the editor applies it. — [mid · backend + frontend · mid]
- [ ] Record-time blur regions (rect + start/end) stored as `blur` annotations. — [mid · backend · mid]
- [ ] Live drawing overlay: new transparent window, tool state in main process, click-through toggling, include in capture, exclude toolbar. Spike on Windows first. — [hard · backend + frontend · high]
- [ ] Undo / redo / clear for the live overlay. — [easy · backend · less]
- [ ] Push-to-talk with uiohook; permission prompts; Wayland fallback message. — [mid · backend · mid]
- [x] Teleprompter window (see "Porting the revamp into the app"). — [mid · backend + frontend · high]
- [ ] Global shortcuts for start/stop/pause (extension has `shortcuts/Shortcuts.jsx`). — [mid · backend · mid]
- [x] Platform gating helper: `src/lib/hudCapabilities.ts`, IPC `get-hud-capabilities`, renderer `useHudCapabilities()`. Flip a flag there when its backend lands.
- [x] Dashboard revamp (see "Porting the revamp into the app"); Settings page still to wire.
- [x] Nested folders for real (`parentId`, optional, so old lists load as top level), inline rename, folder preview.
- [ ] Editor revamp: map `Revamp/Editor` onto `layout/EditorShell`, `EditorHeader`, `EditorSidebar`, `SettingsPanel` (3,400 lines; split it per section while porting), `timeline/`. — [hard · design + frontend · high]
- [ ] Replace the real dialogs (`RecordfulSignInDialog`, `OnboardingLayout`, `FeedbackDialog`, `EditorDialogs`, `ShortcutsConfigDialog`, `AnnouncementDialog`) and floating windows (`CountdownOverlay`, `CapturePicker`, `SourceSelector`, `UpdateToastWindow`) with the revamp designs. — [mid · design + frontend · high]
- [ ] Decide on the NEW settings/controls the designs introduce (listed above) before building them. — [easy · design + frontend · less]
- [ ] Hardware encode + performance budgets; compare against Cap 0.6.2. — [mid · backend · mid]
- [ ] Real-OS E2E matrix (macOS/Windows/Linux X11+Wayland, multi-monitor/DPI); telemetry/crash reporting is in P0. — [mid · backend + frontend · high]
- [ ] Release gates: lint/typecheck/unit/UI/real-OS smoke, signing/notarization, update QA, rollback. — [mid · backend · mid]

## Claims, docs and trust fixes

- [ ] `recordful-ee/app/(site)/features/agents/page.tsx`: claims titles/summaries/chapters (:181), timestamped comments/replies/reactions (:191), Loom imports/developer apps/credits (:201). Ship them or remove the claims. — [mid · backend + frontend · mid]
- [ ] `recordful-help/content/docs/pro/storage.mdx` says 100 GB; `free-vs-pro.mdx` says $13/$120; the site says 50 GB and $3.99/$29.99. Pick one and update all. — [easy · design + frontend · less]
- [ ] Extension: replace the Tally feedback form with `/api/feedback`; keep or redirect the uninstall survey. — [mid · backend + frontend · mid]
- [ ] Docs to add: dashboard/library, folders/trash, comments/analytics, teams/roles/invites, screenshots, Instant Mode, captions, embedding, billing, API/webhooks, security/compliance, password links, custom domains, self-hosting. — [easy · design + frontend · mid]
- [ ] Security page, status page, DPA/subprocessors; publish the trust portal when compliance lands. — [mid · backend + frontend · mid]
- [ ] Resolve extension store/marketplace wording against the actual runtime (verify `ExtensionManager` before editing). — [easy · design + frontend · less]

## Execution order

- **0-30 days:** recording reliability (journal/recovery, health, preflight, power, export) before or alongside desktop Instant Mode; AI metadata; comment threads/reactions/timestamps; password links; truth/pricing fixes; telemetry; stale tests.
- **30-90 days:** creator depth (multi-clip sources/re-record, transcript auto-cut, per-clip layouts); analytics; roles/SSO; Loom import; API/webhooks/CLI; hosted MCP phase 3 + editor tools; editor/capture parity; growth pages.
- **90-180 days:** LUT/language expansion; self-host/compliance; mobile; native performance; commercial licensing; unify editors.

Acceptance for "better than Cap": stop -> link in 5 seconds or less; the link survives force-quit/reboot/crash/network drop; recording/export recovery at 99.5% or better; share page AI + transcript in 10 seconds or less; threaded comments + reactions + notifications; password/custom domain; retention analytics; roles/SSO; Loom import; public API; MCP editor tools; desktop screenshots; Focus mode; transitions + Studio Sound + camera backgrounds; no false marketing claims; pricing/storage consistent.

## Open decisions

- Cursor SVG packs (110 files, original upstream art): delete and use the system cursor only (matches the extension's "no drawn cursor" decision), draw one Recordful set, or keep. Asked once, answer was "keep for now".
- Theme: every color is HeroUI's default blue. Recordful's brand is the orange-to-violet gradient from the cursor mark. See `Foundations/Colors` in Storybook.
- Live drawing on Linux: ship unsupported, or build an X11-only version.
- Electron vs native (GPUI/Tauri): stay Electron with performance budgets, or start a native shell?
- Free tier: free share links? watermark? 5-minute cap like Cap?
- Commercial license: $29/yr / $58 lifetime? Student and volume pricing?
- Compliance: SOC 2 / ISO 27001 / HIPAA timeline and budget?
- Mobile: build, or ship a responsive watch page only?
- Unify the web and desktop editors, or keep two?
- Multi-clip project format: per-clip media references (local/cloud), re-record flow, and one project format for desktop/web?
- Recording ceiling: 6 h target or explicit caps per surface? Extension Instant defaults to 1 h, local warns at 90 min, desktop has none.
- Recordly: coexist, upstream contributions, or an explicit comparison page?

## Gotchas learned

- Storybook uses `RECORDFUL_RENDERER_ONLY=1` (set in `.storybook/main.ts`) so `vite.config.ts` skips the Electron plugin.
- Revamp files avoid HeroUI `Popover`/`Modal` and use plain positioned divs (`Sheet` in RevampDialogs, the Publish panel), so stories render open without overlay plumbing. Port them to the real dialog components when moving into the app.
- Storybook dev does not rescan Tailwind classes for NEW files: if a new story's styles are missing (e.g. `top-11`, `bg-[#...]`), run `touch src/index.css` and reload.
- Storybook's first load of editor-heavy stories takes 10-30 s (about 1,000 modules in dev).
- `public/wallpapers/*` is packaged by `electron-builder.json5` into `assets/wallpapers`; `src/lib/wallpapers.ts` is the catalog.
- The share page fetches `static/icon-64.png` from the R2 bucket; the new icon still needs uploading there.
- `dist/` and `release/` still contain old assets until the next build.
- `recordful-app` has commits (latest `88d657b`, 2026-10-29); the old local TODO was gitignored. This root file is not ignored.

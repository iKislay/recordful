# Changelog

## 4.6.33 (2026-11-12)

### Features
- AI agents take Recordful screenshots: `shot.take` (recordful-mcp 0.8.0's `take_screenshot`) captures the armed tab, `visible` or the whole `page`, with the popup's own screenshot code, and opens the web screenshot editor. An optional `look` ("3d" or a preset name) goes on the editor link as `&look=`; without it the remembered look is used. It answers `{ ok, openedIn }` only, so no picture goes back to the agent.

### Fixes
- Screenshots leave an AI agent's cursor and Stop chip out of the picture (they were captured along with the page).

Checked in real Chrome on a dev build of this source driven by the recordful-mcp 0.8.0 CLI over the bridge: NOT_ARMED with no tab handed over, TAB_NOT_ACTIVE with the tab behind another, `--look 3d` opens `/editor/shot?…&look=3d` tilted in the default look, `--page` opens it flat in the default look, and no chip in either picture.

## 4.6.32 (2026-11-12)

### Fixes
- Toolbar click effects (circle, ripple, pressure) are drawn on the window in the capture phase, as clicks are tracked. A control that stopped its own `mousedown` was recorded as a click with an effect drawn (`drawn: true`) while none was, so neither the recording nor the editor showed one.
- The effect's size follows the same rule as the click's place (`pictureOf`): a tab recording is sized by the page whatever `surface` the previous recording left in storage (it was 24% too large after a screen recording), and a screen or window recording divides by the page's zoom, read from the background (`get-zoom`; it was 25% too large at 125%).
- Pressure has a light rim, so it shows on dark pages. Same change in the web editor (`lib/cursor.ts`); the two `drawEffect` bodies are still identical.

Checked in real Chrome on a build of this source during a real screen recording: effect centred on the click and 84 px wide as the editor draws it, drawn on a control that stops propagation, 85 px on screen at 125% zoom (84 wanted), 68 px in a tab recording (68 wanted), nothing drawn with no effect chosen.

## 4.6.31 (2026-11-10)

### Fixes
- Window recordings placed clicks and the pointer path too far right (and left, on the other half) when something sat beside the page on the left only: Chrome's vertical tabs, a left side panel, DevTools docked left. The window's invisible border was taken as half of everything beside the page; it is now what is beside it on the narrower side, at most 8. Measured in real Chrome against the window's frame from Windows, DevTools docked left: the old rule was up to 464 px off, the new one within 1 px.
- Recovery and diagnostic download names no longer contain colons, which Windows refuses in a file name.

## 4.6.30 (2026-11-09)

### Fixes
- Cloud recordings under one 5 MB upload part (most short takes) lost their scene: stop read the uploaders' state from before finalize, saw 0 bytes, reported "No media was successfully uploaded" and never sent clicks, pointer path, auto-zoom or durations. Stop now reads the finalized state. Proven in real Chrome against a signed-in Pro account: 8 clicks and 18 pointer samples reached the scene and the editor opened with an auto-zoom.
- A cloud recording whose upload set-up took longer than 2.5 s was cancelled as "no capture stream" by the background's start re-check. The recorder now writes the start heartbeat while it waits.
- The `/recover-scene` fallback carries clicks, pointer path and the auto-zoom setting.
- Recovery and finalize-diagnostic downloads from the offscreen recorder (which has no `chrome.downloads`) go through the background, which only accepts this extension's own blob URLs.

## 4.6.29 (2026-11-07)

### Fixes
- Area recording recovery after a page reload no longer depends on the optional `alarms` permission: without it, the take was ended but the upload resume and the editor were skipped.
- Reloading before the first chunk of an area recording was saved shows "Recording was too short to save" on the reloaded page instead of opening an empty editor.

## 4.6.28 (2026-11-06)

### Fixes
- Reloading the page during a custom-area recording (Pro) no longer leaves "Preparing..." on screen forever, or again on the next icon click. The recording ends at the reload, what was captured finishes uploading, and it opens in the web editor. If the recorder vanishes without warning (a crashed tab), the next stop does the same.
- Report a bug, support, the review thumbs-down and the popup's help icon open recordful.app/feedback instead of a Tally form. The uninstall survey stays on Tally.

## 4.6.27 (2026-11-01)

### AI agents: Stop from the page, and markers
- **Stop chip**: while an AI app is connected, the tab it drives shows "<app> is using this tab" with a Stop button. Hidden while recording (back on pause) so it stays out of the video. Stop disconnects without reconnecting and clears the handed-over tab.
- **Markers**: `recording.marker` (recordful-mcp `add_marker`) labels a moment on the recording's own clock, pauses excluded; `stop_recording` returns the markers.

### Fixes
- Starting from the shortcut or an AI agent on a page reloaded since the icon click no longer hangs at "Starting recording...".

## 4.6.26 (2026-10-29)

### Crisp Screenshot Capture (DOM-based)
- Screenshots of web pages now render the live DOM to a PNG via the browser's own layout engine, keeping text and code crisp at any zoom instead of rasterising the tab. Falls back to the previous pixel capture automatically on pages where DOM capture is unavailable or fails (restricted pages, cross-origin content, canvas-heavy apps).

## 4.6.20 (2026-10-23)

### Cursor Improvements
- **Single cursor in recordings**: Fixed duplicate cursors in videos. The recorder now asks the capture track to exclude the real cursor where Chrome offers the `cursor` constraint (available for tab/window capture, not whole screen). Takes and scenes carry `realCursor` ("hidden" or "shown") so the editor shows exactly one cursor.
- **Smoother cursor tracking**: Cursor position is now sampled every 80 ms (was 4 Hz) and stamped with the event's own time. The local recorder publishes the first frame's wall time (`videoClockStart`) so clicks and moves align correctly. Path capacity increased to 60,000 points.

### Camera Permissions on Blocked Sites
- Fixed camera/microphone access on pages with restrictive Permissions-Policy (e.g., `camera=(), microphone=()`). When the in-page permissions frame is blocked, the background now probes an offscreen copy of `permissions.html` to read the extension's own grant and device list without opening a stream. Offscreen creators wait for this probe so its closing never closes theirs. Verified in Chromium 153.

## 4.6.19 (2026-10-22)

- Always open recordings in the Recordful editor, never lose one
- AI agents: ask for recording permissions when switched on, fail fast without them
- AI agents: upload recordings and read back transcripts
- Share: trust only the site this build was made for

## 4.6.18 (2026-10-17)

- Track the pointer in whole-screen recordings on Windows
- Translate the Recording mode label for the new capture tiles
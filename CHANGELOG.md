# Changelog

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
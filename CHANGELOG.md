# Changelog

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
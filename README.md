# Recordful

**Beautiful screen recordings, in minutes.**

Record your product in the browser, then turn it into a polished video
with smart zooms, cinematic camera movement, 3D effects, transitions, and
motion design. Professional screen recording, without the production
workflow.

> Recordful Pro ([recordful.app/pro](https://recordful.app/pro)) adds cloud
> sharing, multi-scene editing, auto-zoom keyframes, and captions for the
> solo developer behind this project.

## Features

- Unlimited recordings: tab, area, desktop, application window, or camera
- Microphone and system audio, with push-to-talk
- Live annotation: draw, text, arrows, shapes, spotlight, click highlight
- AI camera backgrounds and blur, sensitive-content blur
- Smooth zoom to focus on details while recording
- Built-in editor: trim, crop, and manage audio tracks
- Export to MP4, GIF, and WebM, or save to Google Drive
- Alarms, countdown, movable toolbar, fully offline-capable
- AI agents: let Claude, Cursor, opencode or any MCP app record product demos for you

## Private by default

Recordings stay on your device until you choose to export or upload them:

![Recordful Recordings folder with locally saved videos](src/assets/helper/backup.png)

## Install

Install [Recordful from the Chrome Web Store](https://chromewebstore.google.com/detail/hkcgjbkibidgbefehehenlmhjanjaopc).

To run a release unpacked instead:

1. Download the newest `Build.zip` from the
   [releases page](https://github.com/iKislay/recordful/releases) and unzip it.
2. Open `chrome://extensions/` and enable developer mode.
3. Click **Load unpacked** and select the unzipped folder.

To enable Save to Google Drive, create your own OAuth client ID
([Google Cloud Console](https://console.cloud.google.com/apis/credentials)
> Create Credential > OAuth Client ID > Chrome App) and put it in
`manifest.json`. See [this guide](https://developer.chrome.com/docs/extensions/reference/manifest/key)
for a persistent extension key.

## AI agents

Recordful can be driven by AI apps through the Model Context Protocol, or from
a shell. Ask Claude Code, Claude Desktop, Cursor, VS Code, opencode or any MCP
app to "record a demo of the sign-up flow", and it plans the walkthrough,
drives the page with a smooth on-screen cursor while Recordful records, and
opens the editor when it's done. With Recordful Pro it can also upload the
video, hand you the link, and read the transcript back. Recording works on
every plan; on the free plan the AI says links and transcripts need Pro.

1. Add the server to your AI app: `npx -y recordful-mcp`. Per-app setup is in
   [recordful-mcp](https://github.com/iKislay/recordful-mcp#install).
2. In Recordful's popup, open **More → AI agents** and turn it on.
3. When your AI asks, click the Recordful icon on the tab to record, and
   approve the pairing code the first time.

It's off until you turn it on, runs on your computer (the server listens on
`127.0.0.1` only, and a recording leaves it only when it's uploaded), pairs
once per computer against a code you check, and acts only in the tab you hand
over. Uploads and transcripts go through recordful.app's API as the signed-in
user, with Recordful's own session; the AI never sees a credential
(`src/pages/Background/agentBridge/cloud.js`, `videoCommands.js`). The code lives in
`src/pages/Background/agentBridge/` (connection, pairing, commands),
`src/pages/Content/agentPage/` (page tools) and `src/pages/Agents/` (the AI
agents page). For scripted tests, a development build can bake in a shared
secret with `RECORDFUL_AGENT_BRIDGE_TOKEN` (and a port with
`RECORDFUL_AGENT_BRIDGE_PORT`); both are compiled out of other builds.

## Develop

Requires Node.js >= 14.

```bash
npm install
npm start        # watch mode, outputs to build/
```

Then load the `build` folder as an unpacked extension. `npm run build`
produces a one-off build.

Two release builds exist (both gated by secret-scan scripts):

| Command | Use |
|---|---|
| `npm run build:release` | Public zip, cloud features off |
| `npm run build:cws` | Chrome Web Store upload, backend URLs baked in |

## Self-hosting

Self-hosted (unpacked) builds run in local-only mode: no API calls, no
sign-in, no uploads. Cloud features only activate in the official store
build, which talks to the private backend over build-time env vars
(`RECORDFUL_API_BASE_URL`, `RECORDFUL_APP_BASE`, `RECORDFUL_WEBSITE_BASE`,
`RECORDFUL_ENABLE_CLOUD_FEATURES`).

Every build, self-hosted ones included, opens recordings in the web editor
at [recordful.app/editor](https://recordful.app/editor) (or
`RECORDFUL_APP_BASE` when set). The recording is passed from the extension
to the editor page inside your browser and is never uploaded. The editor
built into the extension is used only when the site can't be reached and
for recovering an interrupted recording. To always use the built-in editor
instead, build with `npm run build:builtin` or `RECORDFUL_EDITOR=builtin`.

## License

[GPLv3](https://github.com/iKislay/recordful/blob/master/LICENSE) for
version 3.0.0 and higher.

Made by [Kislay](https://github.com/iKislay)

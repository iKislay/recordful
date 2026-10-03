// End-to-end check of the cloud uploader against a running backend. It drives
// src/pages/CloudRecorder/r2Uploader.js with synthetic recording data and
// reads the stored file back.
//   RECORDFUL_API_BASE_URL=http://localhost:3000/api \
//   RECORDFUL_TOKEN=<session token of a Pro user> \
//   node scripts/uploader-check.mjs
// The recordings it creates are deleted at the end.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const API = process.env.RECORDFUL_API_BASE_URL;
const TOKEN = process.env.RECORDFUL_TOKEN;
assert.ok(API && TOKEN, "set RECORDFUL_API_BASE_URL and RECORDFUL_TOKEN");

// The two chrome APIs the uploader touches.
const storage = { recordfulToken: TOKEN };
globalThis.chrome = {
  storage: {
    local: {
      get: async () => storage,
      set: async (items) => void Object.assign(storage, items),
      remove: async (key) => void delete storage[key],
    },
  },
  runtime: { sendMessage: async () => ({}) },
};
const { default: R2Uploader } = await import(
  "../src/pages/CloudRecorder/r2Uploader.js"
);
const { uploadMicToStorage } = await import(
  "../src/pages/CloudRecorder/uploadMicToStorage.js"
);

const MiB = 1024 * 1024;
const api = async (method, path, body) => {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(res.ok, `${method} ${path} -> ${res.status}`);
  return res.json();
};
// The recorder hands over chunks of uneven size, never aligned to a part.
const writeAll = async (uploader, bytes, from = 0) => {
  for (let at = from; at < bytes.length; at += 700 * 1024) {
    await uploader.write(new Blob([bytes.subarray(at, at + 700 * 1024)]));
  }
};
const stored = async (projectId, mediaId) => {
  const { video } = await api("GET", `/videos/${projectId}`);
  const { url } = video.media.find((file) => file.id === mediaId);
  return Buffer.from(await (await fetch(url)).arrayBuffer());
};
const init = { title: "check", type: "screen" };
const projects = [];
const newProject = async () => {
  const { videoId } = await api("POST", "/videos/create", { title: "check" });
  projects.push(videoId);
  return videoId;
};

try {
  // 1. A whole recording: two full parts and a tail.
  let projectId = await newProject();
  let bytes = randomBytes(12 * MiB + 345);
  const events = [];
  let uploader = new R2Uploader({ onTelemetry: (event) => events.push(event) });
  const { mediaId } = await uploader.initialize(projectId, init);
  assert.ok(storage[`uploadJournal-${mediaId}`], "journal written");
  await writeAll(uploader, bytes);
  await uploader.waitForPendingUploads();
  assert.equal(uploader.offset, 10 * MiB, "whole parts confirmed");
  assert.equal(uploader.lastServerOffset, 10 * MiB);
  assert.equal(await uploader.getServerOffset(), bytes.length, "tail counted");
  await uploader.finalize();
  assert.equal(uploader.status, "completed");
  assert.equal(storage[`uploadJournal-${mediaId}`], undefined, "journal gone");
  assert.ok(events.includes("upload_finalize_completed"));
  assert.ok((await stored(projectId, mediaId)).equals(bytes), "bytes intact");
  await uploader.finalize(); // a second call is a no-op

  // 2. A crash mid-recording, then resume from the journal.
  projectId = await newProject();
  bytes = randomBytes(8 * MiB + 99);
  uploader = new R2Uploader();
  const crashed = await uploader.initialize(projectId, init);
  await writeAll(uploader, bytes.subarray(0, 7 * MiB));
  await uploader.waitForPendingUploads();
  uploader.stopHeartbeat(); // the instance dies here, tail and all
  const journal = storage[`uploadJournal-${crashed.mediaId}`];
  assert.equal(journal.projectId, projectId);
  assert.equal(journal.videoId, crashed.mediaId, "resume code needs videoId");

  uploader = new R2Uploader();
  await uploader.initialize(projectId, {
    ...init,
    reuse: { mediaId: journal.mediaId },
  });
  assert.equal(uploader.offset, 5 * MiB, "resumes at what storage holds");
  await writeAll(uploader, bytes, uploader.offset);
  await uploader.finalize();
  assert.ok((await stored(projectId, crashed.mediaId)).equals(bytes));

  // 3. Rewinding to the server's offset and sending the bytes again.
  projectId = await newProject();
  bytes = randomBytes(6 * MiB);
  uploader = new R2Uploader();
  const rewound = await uploader.initialize(projectId, init);
  await writeAll(uploader, bytes);
  await uploader.waitForPendingUploads();
  assert.equal(uploader.prepareGapResend(5 * MiB + 1), false, "not a boundary");
  assert.equal(uploader.prepareGapResend(5 * MiB), true);
  await writeAll(uploader, bytes, 5 * MiB);
  await uploader.finalize();
  assert.ok((await stored(projectId, rewound.mediaId)).equals(bytes));

  // 4. The server refuses to complete a file of the wrong size.
  projectId = await newProject();
  uploader = new R2Uploader();
  await uploader.initialize(projectId, init);
  await uploader.write(new Blob([randomBytes(1000)]));
  uploader.totalBytes += 1;
  await assert.rejects(uploader.finalize());
  assert.equal(uploader.lastErrorCode, "finalize-size-mismatch");

  // 5. Abort forgets the journal; an unknown upload is a 404.
  await uploader.abort();
  assert.equal(uploader.status, "aborted");
  assert.equal(storage[`uploadJournal-${uploader.mediaId}`], undefined);
  uploader = new R2Uploader();
  await assert.rejects(
    uploader.initialize(projectId, { ...init, reuse: { mediaId: "missing" } }),
    { status: 404 },
  );
  uploader.stopHeartbeat();

  // 6. A separated mic: one file through the same uploader, no journal.
  projectId = await newProject();
  bytes = randomBytes(300 * 1024);
  const mic = {
    chunks: [new Blob([bytes])],
    mimeType: "audio/webm;codecs=opus",
    sceneId: "scene",
  };
  const sent = await uploadMicToStorage({ ...mic, projectId });
  assert.equal(sent.ok, true, sent.reason);
  assert.ok((await stored(projectId, sent.mediaId)).equals(bytes));
  assert.deepEqual(await uploadMicToStorage({ ...mic, projectId: "missing" }), {
    ok: false,
    reason: "http-404",
  });
  assert.deepEqual(Object.keys(storage), ["recordfulToken"], "no journal");

  console.log("uploader: all checks passed");
} finally {
  for (const projectId of projects) {
    await api("POST", `/videos/${projectId}/delete/`, {});
  }
}

// Startup frame-loss flags, read from chrome.storage.local once at import.
// Nothing writes them and there's no UI or remote config, so they're
// per-machine DevTools switches; changing what users get needs a release.
//
// Only startEncoderPrewarm waits on the read (250ms cap): a throttled tab can
// take 11-19s to answer a storage IPC. Defaults apply until it lands.

const FLAG_KEYS = [
  "webcodecsStartupBufferDisabled",
  "webcodecsWarmAdoptEnabled",
  "webcodecsEncoderPrewarmDisabled",
];

const _flags = {
  startupBufferDisabled: false,
  // Opt-IN: adoption holds a second VideoEncoder across the codec-selection
  // ladder, so on a machine at its encoder-session cap (Windows/NVENC with
  // Zoom or OBS) the prefer-hardware probe can fail against our own warm one.
  warmAdoptEnabled: false,
  // Disabling adoption alone still runs the warm-up, which warms the OS encode
  // service; this is the only way to get a genuinely cold encoder.
  encoderPrewarmDisabled: false,
};
let _loading = null;

export const loadStartupFlags = () => {
  if (_loading) return _loading;
  _loading = (async () => {
    try {
      const stored = await chrome.storage.local.get(FLAG_KEYS);
      _flags.startupBufferDisabled =
        stored?.webcodecsStartupBufferDisabled === true;
      _flags.warmAdoptEnabled = stored?.webcodecsWarmAdoptEnabled === true;
      _flags.encoderPrewarmDisabled =
        stored?.webcodecsEncoderPrewarmDisabled === true;
    } catch {}
    return _flags;
  })();
  return _loading;
};

export const getStartupFlags = () => _flags;

export const isStartupBufferEnabled = () => !_flags.startupBufferDisabled;

export const isWarmAdoptEnabled = () => _flags.warmAdoptEnabled === true;

export const isEncoderPrewarmEnabled = () => !_flags.encoderPrewarmDisabled;

// Escape hatch for a test that cannot seed chrome.storage. The e2e specs do
// seed storage directly, so nothing uses this today.
export const __setStartupFlagsForTests = (next) => {
  Object.assign(_flags, next);
};

try {
  if (typeof chrome !== "undefined" && chrome?.storage?.local) {
    void loadStartupFlags();
  }
} catch {}

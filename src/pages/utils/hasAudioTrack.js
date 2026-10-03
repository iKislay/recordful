// Header-only track check. Decides whether a missing AAC encoder actually
// costs the user audio, or the source was silent to begin with.
export const blobHasAudioTrack = async (blob) => {
  try {
    const { Input, ALL_FORMATS, BlobSource } = await import("mediabunny");
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(blob),
    });
    return Boolean(await input.getPrimaryAudioTrack());
  } catch {
    // Unknown beats silent. Keep the audio-correct source.
    return true;
  }
};

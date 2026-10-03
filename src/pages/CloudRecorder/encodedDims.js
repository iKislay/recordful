// The dims sent at upload-init are a guess made before the encoder exists. For
// region captures they're the CSS size of the drag handle, so on any display
// with a device pixel ratio above 1 they understate the file (a 412x924
// selection encodes 824x1848 at dpr 1, since tab capture renders at 2x). A
// survey of 328 recent scenes found 27.4% disagreeing with their own media.
//
// These dims become the scene's width/height, aspectRatio, baseResolution,
// and the divisor auto-zoom uses to turn clicks into percentages, so click
// coordinates have to be rescaled to match whatever we end up reporting.

// Prefer what the encoder wrote. Falling back to the live track is safe at stop
// time (frames have flowed, so a cropped track finally reports the crop) but not
// at start, which is why this runs at scene-create.
export function pickEncodedDims({ diag, trackSettings, fallback }) {
  const candidates = [
    [diag?.encodeWidth, diag?.encodeHeight],
    [trackSettings?.width, trackSettings?.height],
    [fallback?.width, fallback?.height],
  ];
  for (const [w, h] of candidates) {
    const width = Math.round(Number(w));
    const height = Math.round(Number(h));
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }
  return { width: 1920, height: 1080 };
}

// Clicks are CSS pixels (trackClicks.js, minus region origin); the server
// divides by the reported dims, so fixing dims without rescaling clicks sends
// auto-zoom to the top-left. Kept client-side so old extensions still work.
export function scaleClickEvents(clickEvents, fromDims, toDims) {
  if (!Array.isArray(clickEvents) || clickEvents.length === 0) return clickEvents;
  const fw = Number(fromDims?.width);
  const fh = Number(fromDims?.height);
  const tw = Number(toDims?.width);
  const th = Number(toDims?.height);
  if (![fw, fh, tw, th].every((n) => Number.isFinite(n) && n > 0)) return clickEvents;
  const sx = tw / fw;
  const sy = th / fh;
  // Guess was already right, the common case for full-screen capture at 1x.
  if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return clickEvents;
  return clickEvents.map((c) => {
    const x = Number(c?.x);
    const y = Number(c?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return c;
    return { ...c, x: Math.round(x * sx), y: Math.round(y * sy) };
  });
}

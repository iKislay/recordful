// DOM-based screenshot capture: render the live page to a PNG using the
// browser's own layout engine, so text (code, UI labels) stays crisp at
// any scale instead of being rasterised by captureVisibleTab.
//
// Falls back gracefully: returns null on any failure so callers can use
// the pixel capture path instead.

export const domCaptureAvailable = (g = (typeof window !== "undefined" ? window : globalThis)) => {
  try {
    return (
      !!g &&
      typeof g.document !== "undefined" &&
      typeof g.XMLSerializer !== "undefined" &&
      typeof g.Image !== "undefined" &&
      typeof g.Blob !== "undefined" &&
      typeof g.URL !== "undefined" &&
      typeof g.URL.createObjectURL === "function"
    );
  } catch {
    return false;
  }
};

export const buildSvgString = (w, h, serialized, scale = 2) => {
  const W = Math.max(1, Math.round(w * scale));
  const H = Math.max(1, Math.round(h * scale));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<foreignObject width="100%" height="100%">${serialized}</foreignObject>` +
    `</svg>`
  );
};

export const captureDomScreenshot = async (scale = 2) => {
  if (!domCaptureAvailable()) return null;
  try {
    const doc = document;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const clone = doc.documentElement.cloneNode(true);
    const ui = clone.querySelector && clone.querySelector("#recordful-ui");
    if (ui) ui.remove();

    // Inline every stylesheet so the SVG render keeps the page's look.
    let css = "";
    for (const ss of Array.from(doc.styleSheets || [])) {
      try {
        css += Array.from(ss.cssRules || [])
          .map((r) => r.cssText)
          .join("\n");
      } catch {
        // Cross-origin sheet: skip; page may look unstyled for those rules.
      }
    }
    if (css) {
      const styleEl = doc.createElement("style");
      styleEl.textContent = css;
      const head = clone.querySelector("head");
      if (head) head.appendChild(styleEl);
    }

    const serialized = new XMLSerializer().serializeToString(clone);
    const svg = buildSvgString(w, h, serialized, scale);

    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = (e) => reject(e);
      i.src = url;
    });

    const canvas = doc.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      URL.revokeObjectURL(url);
      return null;
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);

    const dataUrl = canvas.toDataURL("image/png");
    if (!dataUrl || dataUrl === "data:,") return null;
    return dataUrl;
  } catch {
    return null;
  }
};

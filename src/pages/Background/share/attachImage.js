// Runs inside the page of a post composer (X, Threads, Forg): puts a picture
// into it as an attachment, the way the person would by choosing a file, and
// leaves posting to them. Injected with chrome.scripting.executeScript, which
// serialises this function alone, so it uses nothing from outside itself.
//
// Each composer keeps a hidden `<input type="file">`; giving it the picture
// and telling the page it changed is the same as picking the file. Every
// composer here shows a preview of the attachment, which is what says it took.
export async function attachImageInPage(target, base64, mime, fileName) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (find, ms) => {
    const end = Date.now() + ms;
    for (;;) {
      const found = find();
      if (found) return found;
      if (Date.now() > end) return null;
      await sleep(150);
    }
  };

  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], fileName, { type: mime }));
  const give = (input) => {
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const SPECS = {
    x: {
      input: () => document.querySelector('input[data-testid="fileInput"]'),
      shown: () =>
        document.querySelector(
          '[data-testid="attachments"] img, [data-testid="attachments"] [role="img"]',
        ),
    },
    threads: {
      input: () => document.querySelector('[role="dialog"] input[type="file"]'),
      shown: () =>
        document.querySelector(
          '[role="dialog"] img[src^="blob:"], [role="dialog"] video, [role="dialog"] canvas',
        ),
    },
    forg: {
      input: () => document.querySelector('input[type="file"][accept="image/*"]'),
      shown: () => document.querySelector('img[src^="blob:"]'),
    },
  };
  const spec = SPECS[target];
  if (!spec) return { ok: false, why: "unknown-target" };

  let input = await until(spec.input, target === "forg" ? 2500 : 20000);
  if (!input && target === "forg") {
    // An older Forg opens its composer when the field is clicked.
    const field = document.querySelector("textarea");
    field?.click();
    field?.focus();
    input = await until(spec.input, 8000);
  }
  if (!input) return { ok: false, why: "no-composer" };

  give(input);
  const shown = await until(spec.shown, 15000);
  return shown ? { ok: true } : { ok: false, why: "not-attached" };
}

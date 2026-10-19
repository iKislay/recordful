// Screenshots waiting for the website's editor to take them. The service
// worker writes one as it is taken; the editor bridge page hands it to the
// site and deletes it once the site says it is kept. Both are pages of this
// extension, so they share this IndexedDB database.

const DB_NAME = "recordful-shots";
const STORE = "shots";
// What is never picked up is not kept forever.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_KEPT = 20;

export const SHOT_PREFIX = "screenshot-";

/** A name the bridge accepts: ours, and nothing that could be a path. */
export const validShotName = (name) =>
  typeof name === "string" &&
  name.startsWith(SHOT_PREFIX) &&
  /^[a-z0-9-]+$/i.test(name) &&
  name.length < 100;

const open = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "name" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const run = async (mode, work) => {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      Promise.resolve(work(store)).then((r) => {
        result = r;
      });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
};

const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export const putShot = (shot) => run("readwrite", (store) => store.put(shot));

export const getShot = async (name) => {
  if (!validShotName(name)) return null;
  const db = await open();
  try {
    return (await request(db.transaction(STORE).objectStore(STORE).get(name))) ?? null;
  } finally {
    db.close();
  }
};

export const deleteShot = (name) =>
  validShotName(name) ? run("readwrite", (store) => store.delete(name)) : Promise.resolve();

/** Drops what is old, and all but the newest few. */
export const pruneShots = async () => {
  const db = await open();
  try {
    const all = await request(db.transaction(STORE).objectStore(STORE).getAll());
    const now = Date.now();
    const sorted = all.sort((a, b) => b.takenAt - a.takenAt);
    const stale = sorted.filter((shot, i) => i >= MAX_KEPT || now - shot.takenAt > MAX_AGE_MS);
    if (!stale.length) return;
    const tx = db.transaction(STORE, "readwrite");
    for (const shot of stale) tx.objectStore(STORE).delete(shot.name);
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } finally {
    db.close();
  }
};

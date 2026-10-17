// Mirror of recordful-agent-bridge/src/auth/handshake.ts. The proof string
// format must match byte for byte or every handshake fails.
const encoder = new TextEncoder();

const toHex = (buffer) =>
  Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");

export const newNonce = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
};

// A pairing secret: 32 random bytes, base64url without padding (43 chars).
export const newSecret = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

export const computeProof = async (token, role, serverNonce, clientNonce) => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(
      `recordful-agent-bridge:${role}:${serverNonce}:${clientNonce}`,
    ),
  );
  return toHex(sig);
};

// Constant time over equal-length hex; length itself isn't secret.
export const proofsEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

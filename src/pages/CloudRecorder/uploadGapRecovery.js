// Finds which durable chunks cover the bytes the server is missing, so finalize
// can re-send them instead of declaring a length the server never received.

// ranges: [{ index, endByte, size }] in write order. covered=false means send
// nothing, since a partial re-send punches a hole rather than closing one.
export const planGapResend = ({
  ranges,
  serverOffset,
  clientBytes,
  maxGapBytes = 64 * 1024 * 1024,
}) => {
  const gapBytes = (Number(clientBytes) || 0) - (Number(serverOffset) || 0);
  if (!(gapBytes > 0)) {
    return { covered: false, plan: [], gapBytes: 0, reason: "no-gap" };
  }
  if (gapBytes > maxGapBytes) {
    return { covered: false, plan: [], gapBytes, reason: "gap-too-large" };
  }
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return { covered: false, plan: [], gapBytes, reason: "no-ranges" };
  }

  const sorted = [...ranges]
    .filter(
      (r) =>
        r &&
        Number.isFinite(r.endByte) &&
        Number.isFinite(r.size) &&
        r.size > 0 &&
        r.index !== null &&
        r.index !== undefined,
    )
    .sort((a, b) => a.endByte - b.endByte);
  if (!sorted.length) {
    return { covered: false, plan: [], gapBytes, reason: "no-usable-ranges" };
  }

  // Ranges must be contiguous, or the byte positions are guesses.
  for (let i = 0; i < sorted.length; i++) {
    const startByte = sorted[i].endByte - sorted[i].size;
    const prevEnd = i === 0 ? sorted[0].endByte - sorted[0].size : sorted[i - 1].endByte;
    if (startByte !== prevEnd) {
      return {
        covered: false,
        plan: [],
        gapBytes,
        reason: "ranges-not-contiguous",
      };
    }
  }

  const firstStart = sorted[0].endByte - sorted[0].size;
  const lastEnd = sorted[sorted.length - 1].endByte;
  // The tracked window has to span the whole gap. A purged prefix, or a chunk
  // that never reached disk, can't be reconstructed.
  if (firstStart > serverOffset || lastEnd < clientBytes) {
    return { covered: false, plan: [], gapBytes, reason: "gap-outside-ranges" };
  }

  const plan = [];
  for (const r of sorted) {
    const startByte = r.endByte - r.size;
    if (r.endByte <= serverOffset) continue;
    // Partially-received chunk: skip the bytes the server already has.
    const skipBytes = Math.max(0, serverOffset - startByte);
    plan.push({
      index: r.index,
      skipBytes,
      sendBytes: r.size - skipBytes,
      startByte: startByte + skipBytes,
    });
  }
  if (!plan.length) {
    return { covered: false, plan: [], gapBytes, reason: "empty-plan" };
  }

  const planBytes = plan.reduce((sum, p) => sum + p.sendBytes, 0);
  if (planBytes !== gapBytes) {
    return {
      covered: false,
      plan: [],
      gapBytes,
      reason: "plan-bytes-mismatch",
      planBytes,
    };
  }
  return { covered: true, plan, gapBytes, reason: "ok" };
};

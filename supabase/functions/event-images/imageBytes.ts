function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const MAX_BYTES = 5 * 1024 * 1024;
const dimensions = (w: number, h: number) =>
  w > 0 && h > 0 && w * h <= 40_000_000;
/** Validate raster container signatures, dimensions and bounded chunk/segment structure.
 * No SVG/HTML is accepted; this is format validation, not content moderation. */
export function validImageBytes(
  b: Uint8Array,
  mime: string,
  frameOnly = false,
): boolean {
  if (b.length < 12 || b.length > MAX_BYTES) return false;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const text = (at: number, count: number) =>
    String.fromCharCode(...b.slice(at, at + count));
  if (mime === "image/png") {
    if (
      !b.slice(0, 8).every((x, i) => x === [137, 80, 78, 71, 13, 10, 26, 10][i])
    ) return false;
    let offset = 8, header = false, data = false;
    while (offset + 12 <= b.length) {
      const size = v.getUint32(offset);
      const type = text(offset + 4, 4);
      if (
        size > b.length - offset - 12 ||
        crc32(b.subarray(offset + 4, offset + 8 + size)) !==
          v.getUint32(offset + 8 + size)
      ) return false;
      if (!header) {
        if (
          type !== "IHDR" || size !== 13 ||
          !dimensions(v.getUint32(offset + 8), v.getUint32(offset + 12))
        ) return false;
        header = true;
      }
      if (type === "IDAT" && size > 0) data = true;
      offset += size + 12;
      if (type === "IEND") return size === 0 && offset === b.length && data;
    }
    return false;
  }
  if (mime === "image/jpeg") {
    if (
      b[0] !== 255 || b[1] !== 216 || b[b.length - 2] !== 255 ||
      b[b.length - 1] !== 217
    ) return false;
    let offset = 2, frame = false;
    while (offset + 4 <= b.length) {
      if (b[offset++] !== 255) return false;
      while (b[offset] === 255) offset++;
      const marker = b[offset++];
      if (marker === 0xda) {
        return frame && offset + 2 <= b.length && v.getUint16(offset) >= 6 &&
          offset + v.getUint16(offset) < b.length - 2;
      }
      if (offset + 2 > b.length) return false;
      const size = v.getUint16(offset);
      if (size < 2 || offset + size > b.length) return false;
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (
          size < 8 ||
          !dimensions(v.getUint16(offset + 5), v.getUint16(offset + 3))
        ) return false;
        frame = true;
      }
      offset += size;
    }
    return false;
  }
  if (mime === "image/webp") {
    if (
      text(0, 4) !== "RIFF" || text(8, 4) !== "WEBP" ||
      v.getUint32(4, true) + 8 !== b.length
    ) return false;
    let offset = 12, image = false, animated = false;
    const uint24 = (at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
    while (offset + 8 <= b.length) {
      const kind = text(offset, 4),
        size = v.getUint32(offset + 4, true),
        start = offset + 8;
      if (size > b.length - start) return false;
      if (kind === "VP8X") {
        if (
          size !== 10 ||
          !dimensions(uint24(start + 4) + 1, uint24(start + 7) + 1)
        ) return false;
        animated = (b[start] & 2) !== 0;
      } else if (kind === "ANMF") {
        if (
          frameOnly || !animated || size <= 16 ||
          !dimensions(uint24(start + 6) + 1, uint24(start + 9) + 1)
        ) return false;
        // A frame contains ordinary VP8/VP8L chunks; allow only one nesting level.
        const frame = new Uint8Array(size - 16 + 12);
        frame.set(new TextEncoder().encode("RIFF"), 0);
        new DataView(frame.buffer).setUint32(4, frame.length - 8, true);
        frame.set(new TextEncoder().encode("WEBP"), 8);
        frame.set(b.subarray(start + 16, start + size), 12);
        if (!validImageBytes(frame, "image/webp", true)) return false;
        image = true;
      } else if (kind === "VP8 ") {
        if (
          size < 10 || text(start + 3, 3) !== "\x9d\x01\x2a" ||
          !dimensions(
            v.getUint16(start + 6, true) & 0x3fff,
            v.getUint16(start + 8, true) & 0x3fff,
          )
        ) return false;
        image = true;
      } else if (kind === "VP8L") {
        if (size < 5 || b[start] !== 0x2f) return false;
        const bits = v.getUint32(start + 1, true);
        if (!dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)) {
          return false;
        }
        image = true;
      }
      offset = start + size + (size % 2);
    }
    return image && offset === b.length;
  }
  return false;
}

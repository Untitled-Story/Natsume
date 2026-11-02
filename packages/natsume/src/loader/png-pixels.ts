import { unzlibSync } from 'fflate';
import { check, NatsumeError } from '../errors.js';
import { crc32 } from './zip.js';

export interface ImagePixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}
const passes = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;
export function decodePngPixels(bytes: Uint8Array): ImagePixels {
  try {
    return decode(bytes);
  } catch (error) {
    if (error instanceof NatsumeError) throw error;
    throw new NatsumeError('SEMANTIC', 'Invalid PNG pixel data');
  }
}
function decode(bytes: Uint8Array): ImagePixels {
  check(
    bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v),
    'SEMANTIC',
    'Invalid PNG',
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    width = view.getUint32(16),
    height = view.getUint32(20),
    depth = bytes[24]!,
    type = bytes[25]!,
    interlace = bytes[28]!;
  check(
    view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452,
    'SEMANTIC',
    'PNG must start with IHDR',
  );
  check(
    width > 0 && height > 0 && width * height <= 16_777_216,
    'LIMIT',
    'Decoded image exceeds pixel limit',
  );
  const channels =
    type === 0 || type === 3 ? 1 : type === 2 ? 3 : type === 4 ? 2 : type === 6 ? 4 : 0;
  check(
    channels &&
      [1, 2, 4, 8, 16].includes(depth) &&
      (type === 0 || type === 3 || depth >= 8) &&
      (type !== 3 || depth <= 8) &&
      bytes[26] === 0 &&
      bytes[27] === 0 &&
      interlace <= 1,
    'SEMANTIC',
    'Invalid PNG format',
  );
  let palette: Uint8Array | undefined,
    transparency: Uint8Array | undefined,
    ended = false,
    total = 0;
  const chunks: Uint8Array[] = [];
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = view.getUint32(offset),
      end = offset + 12 + length;
    check(end <= bytes.length, 'SEMANTIC', 'Truncated PNG chunk');
    check(
      crc32(bytes.subarray(offset + 4, end - 4)) === view.getUint32(end - 4),
      'SEMANTIC',
      'Invalid PNG chunk checksum',
    );
    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)),
      data = bytes.subarray(offset + 8, end - 4);
    if (name === 'IDAT') {
      chunks.push(data);
      total += length;
    } else if (name === 'PLTE') {
      check(
        !chunks.length && !palette && length > 0 && length <= 768 && length % 3 === 0,
        'SEMANTIC',
        'Invalid PNG palette',
      );
      palette = data;
    } else if (name === 'tRNS') transparency = data;
    else if (name === 'IEND') {
      check(length === 0 && end === bytes.length, 'SEMANTIC', 'Invalid PNG end');
      ended = true;
      break;
    } else
      check(
        name === 'IHDR' ? offset === 8 : (bytes[offset + 4]! & 32) !== 0,
        'SEMANTIC',
        'Unknown PNG critical chunk',
      );
    offset = end;
  }
  check(
    ended && chunks.length && (type !== 3 || (palette && palette.length % 3 === 0)),
    'SEMANTIC',
    'Incomplete PNG',
  );
  const stages = interlace ? passes : [[0, 0, 1, 1]];
  let expected = 0;
  for (const [x, y, dx, dy] of stages) {
    const w = Math.max(0, Math.ceil((width - x) / dx)),
      h = Math.max(0, Math.ceil((height - y) / dy));
    if (w && h) expected += h * (1 + Math.ceil((w * channels * depth) / 8));
  }
  const compressed = new Uint8Array(total);
  let written = 0;
  for (const c of chunks) {
    compressed.set(c, written);
    written += c.length;
  }
  // One extra byte detects overflow without allocating an unbounded inflate result.
  const raw = unzlibSync(compressed, { out: new Uint8Array(expected + 1) });
  check(raw.length === expected, 'SEMANTIC', 'Invalid PNG scanline length');
  const rgba = new Uint8Array(width * height * 4),
    bpp = Math.max(1, Math.ceil((channels * depth) / 8));
  let cursor = 0;
  const tr = new DataView(
    (transparency ?? new Uint8Array()).buffer,
    transparency?.byteOffset ?? 0,
    transparency?.byteLength ?? 0,
  );
  for (const [x, y, dx, dy] of stages) {
    const w = Math.max(0, Math.ceil((width - x) / dx)),
      h = Math.max(0, Math.ceil((height - y) / dy));
    if (!w || !h) continue;
    const rowSize = Math.ceil((w * channels * depth) / 8);
    let previous = new Uint8Array(rowSize),
      row = new Uint8Array(rowSize);
    for (let j = 0; j < h; j++) {
      const filter = raw[cursor++]!;
      check(filter <= 4, 'SEMANTIC', 'Invalid PNG filter');
      for (let k = 0; k < rowSize; k++) {
        const a = k >= bpp ? row[k - bpp]! : 0,
          b = previous[k]!,
          c = k >= bpp ? previous[k - bpp]! : 0,
          p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        row[k] =
          (raw[cursor++]! +
            (filter === 0
              ? 0
              : filter === 1
                ? a
                : filter === 2
                  ? b
                  : filter === 3
                    ? Math.floor((a + b) / 2)
                    : pa <= pb && pa <= pc
                      ? a
                      : pb <= pc
                        ? b
                        : c)) &
          255;
      }
      const sample = (i: number) =>
          depth === 16
            ? (row[i * 2]! << 8) | row[i * 2 + 1]!
            : depth === 8
              ? row[i]!
              : (row[Math.floor((i * depth) / 8)]! >>> (8 - depth - ((i * depth) % 8))) &
                ((1 << depth) - 1),
        byte = (v: number) => Math.round((v * 255) / (depth === 16 ? 65535 : (1 << depth) - 1));
      for (let i = 0; i < w; i++) {
        const target = ((y + j * dy) * width + x + i * dx) * 4,
          base = i * channels,
          r = sample(base);
        let red = 0,
          green = 0,
          blue = 0,
          alpha = 255;
        if (type === 3) {
          check(r * 3 + 2 < palette!.length, 'SEMANTIC', 'Invalid PNG palette index');
          red = palette![r * 3]!;
          green = palette![r * 3 + 1]!;
          blue = palette![r * 3 + 2]!;
          alpha = transparency?.[r] ?? 255;
        } else if (type === 0 || type === 4) {
          red = green = blue = byte(r);
          alpha =
            type === 4
              ? byte(sample(base + 1))
              : transparency?.length === 2 && r === tr.getUint16(0)
                ? 0
                : 255;
        } else {
          const g = sample(base + 1),
            b = sample(base + 2);
          red = byte(r);
          green = byte(g);
          blue = byte(b);
          alpha =
            type === 6
              ? byte(sample(base + 3))
              : transparency?.length === 6 &&
                  r === tr.getUint16(0) &&
                  g === tr.getUint16(2) &&
                  b === tr.getUint16(4)
                ? 0
                : 255;
        }
        rgba[target] = red;
        rgba[target + 1] = green;
        rgba[target + 2] = blue;
        rgba[target + 3] = alpha;
      }
      [row, previous] = [previous, row];
    }
  }
  return { width, height, rgba };
}

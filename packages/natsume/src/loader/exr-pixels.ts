import { check } from '../errors.js';

/** Uncompressed scanline HALF RGBA retained as source data, without tone mapping. */
export interface ExrPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint16Array;
}
interface Header {
  width: number;
  height: number;
  minY: number;
  channels: number[];
  table: number;
}

export function isOpenExr(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x76 &&
    bytes[1] === 0x2f &&
    bytes[2] === 0x31 &&
    bytes[3] === 1
  );
}

function header(bytes: Uint8Array): Header {
  const valid = (condition: unknown) => check(condition, 'SEMANTIC', 'Invalid source OpenEXR');
  valid(isOpenExr(bytes));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  check(
    view.getUint32(4, true) === 2,
    'CAPABILITY',
    'Only single-part scanline OpenEXR is supported',
  );
  let offset = 8;
  const string = (end = bytes.length) => {
    const first = offset;
    while (offset < end && bytes[offset] !== 0) offset++;
    valid(offset < end && offset - first <= 255);
    return new TextDecoder().decode(bytes.subarray(first, offset++));
  };
  let width = 0,
    height = 0,
    minY = 0;
  let channels: number[] = [],
    compression = -1;
  const seen = new Set<string>();
  while (offset < bytes.length && bytes[offset]) {
    const name = string(),
      type = string();
    valid(!seen.has(name) && offset + 4 <= bytes.length);
    seen.add(name);
    const size = view.getUint32(offset, true);
    offset += 4;
    const end = offset + size;
    valid(end <= bytes.length);
    if (name === 'dataWindow') {
      valid(type === 'box2i' && size === 16);
      const minX = view.getInt32(offset, true);
      minY = view.getInt32(offset + 4, true);
      width = view.getInt32(offset + 8, true) - minX + 1;
      height = view.getInt32(offset + 12, true) - minY + 1;
    } else if (name === 'compression') {
      valid(type === 'compression' && size === 1);
      compression = bytes[offset]!;
    } else if (name === 'channels') {
      valid(type === 'chlist' && size > 1);
      channels = [];
      while (offset < end && bytes[offset]) {
        const channel = string(end);
        valid(offset + 16 <= end);
        check(
          view.getInt32(offset, true) === 1,
          'CAPABILITY',
          'Source OpenEXR requires HALF channels',
        );
        check(
          view.getInt32(offset + 8, true) === 1 && view.getInt32(offset + 12, true) === 1,
          'CAPABILITY',
          'Subsampled source OpenEXR is unsupported',
        );
        const index = 'RGBA'.indexOf(channel);
        check(
          channel.length === 1 && index >= 0 && !channels.includes(index),
          'CAPABILITY',
          'Source OpenEXR requires unique RGBA channels',
        );
        channels.push(index);
        offset += 16;
      }
      valid(offset === end - 1 && bytes[offset] === 0);
    }
    offset = end;
  }
  valid(offset < bytes.length && bytes[offset] === 0);
  offset++;
  check(compression === 0, 'CAPABILITY', 'Compressed source OpenEXR requires a verified decoder');
  check(channels.length === 4, 'CAPABILITY', 'Source OpenEXR requires RGBA channels');
  check(
    width > 0 && height > 0 && width <= 16384 && height <= 16384 && width * height <= 16_777_216,
    'LIMIT',
    'Source OpenEXR dimensions exceed pixel limit',
  );
  valid(offset + height * 8 <= bytes.length);
  return { width, height, minY, channels, table: offset };
}

/** @internal Validates the supported source encoding without allocating a pixel buffer. */
export function exrImageSize(bytes: Uint8Array): { width: number; height: number } {
  const { width, height } = header(bytes);
  return { width, height };
}

export function decodeExrPixels(bytes: Uint8Array): ExrPixels {
  const { width, height, minY, channels, table } = header(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rgba = new Uint16Array(width * height * 4),
    seen = new Set<number>();
  const rowBytes = width * 8;
  for (let row = 0; row < height; row++) {
    const pointer = view.getBigUint64(table + row * 8, true);
    check(
      pointer >= BigInt(table + height * 8) &&
        pointer + BigInt(rowBytes + 8) <= BigInt(bytes.length),
      'SEMANTIC',
      'Invalid OpenEXR scanline offset',
    );
    const start = Number(pointer),
      y = view.getInt32(start, true) - minY;
    check(
      y >= 0 && y < height && !seen.has(y) && view.getUint32(start + 4, true) === rowBytes,
      'SEMANTIC',
      'Invalid OpenEXR scanline',
    );
    seen.add(y);
    for (let channel = 0; channel < 4; channel++)
      for (let x = 0; x < width; x++) {
        const value = view.getUint16(start + 8 + (channel * width + x) * 2, true);
        check((value & 0x7c00) !== 0x7c00, 'SEMANTIC', 'Nonfinite source OpenEXR texel');
        rgba[(y * width + x) * 4 + channels[channel]!] = value;
      }
  }
  return { width, height, rgba };
}

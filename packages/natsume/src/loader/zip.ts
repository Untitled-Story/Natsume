import { unzipSync } from 'fflate';
import { check } from '../errors.js';

export interface LoadLimits {
  maxPackageBytes: number;
  maxFiles: number;
  maxFileBytes: number;
}
export const DEFAULT_LIMITS: Readonly<LoadLimits> = Object.freeze({
  maxPackageBytes: 64 * 1024 * 1024,
  maxFiles: 4096,
  maxFileBytes: 32 * 1024 * 1024,
});

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 255] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Validate original directory entries before unzipSync's filename map can hide duplicates. */
export function readZip(bytes: Uint8Array, limits: LoadLimits): Map<string, Uint8Array> {
  check(bytes.length <= limits.maxPackageBytes, 'LIMIT', 'Package size limit exceeded');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const range = (at: number, size: number) =>
    check(at >= 0 && size >= 0 && size <= bytes.length - at, 'ZIP', 'Truncated ZIP');
  const u16 = (at: number) => {
    range(at, 2);
    return view.getUint16(at, true);
  };
  const u32 = (at: number) => {
    range(at, 4);
    return view.getUint32(at, true);
  };
  range(0, 22);
  let end = bytes.length - 22;
  while (
    end >= Math.max(0, bytes.length - 65557) &&
    (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length)
  )
    end--;
  check(end >= Math.max(0, bytes.length - 65557), 'ZIP', 'End of central directory missing');
  check(
    u16(end + 4) === 0 && u16(end + 6) === 0 && u16(end + 8) === u16(end + 10),
    'ZIP',
    'Split archives are unsupported',
  );
  const count = u16(end + 10),
    centralSize = u32(end + 12),
    central = u32(end + 16);
  check(
    count > 0 && count < 65535 && count <= limits.maxFiles,
    'LIMIT',
    'ZIP file count limit exceeded',
  );
  check(central + centralSize === end, 'ZIP', 'Invalid central directory range');
  const names = new Set<string>(),
    entries: { name: string; size: number }[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let cursor = central,
    localEnd = 0;
  for (let i = 0; i < count; i++) {
    check(u32(cursor) === 0x02014b50, 'ZIP', 'Invalid central directory entry');
    range(cursor, 46);
    const flags = u16(cursor + 8),
      method = u16(cursor + 10),
      checksum = u32(cursor + 16);
    const compressed = u32(cursor + 20),
      size = u32(cursor + 24);
    const nameSize = u16(cursor + 28),
      extraSize = u16(cursor + 30),
      commentSize = u16(cursor + 32),
      local = u32(cursor + 42);
    check(
      (flags & ~0x800) === 0 && method === 0 && compressed === size,
      'ZIP',
      'NOAP v1 requires unencrypted Stored entries without descriptors',
    );
    check(size <= limits.maxFileBytes, 'LIMIT', 'ZIP entry size limit exceeded');
    check(
      u16(cursor + 34) === 0 && local === localEnd,
      'ZIP',
      'Invalid or overlapping local entry',
    );
    range(cursor + 46, nameSize + extraSize + commentSize);
    let name: string;
    try {
      name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameSize));
    } catch {
      check(false, 'ZIP', 'Invalid filename encoding');
    }
    check(
      /^(manifest\.json|scene\.noir|assets\/[1-9][0-9]*\.(png|nomesh|shader\.json))$/.test(name),
      'ZIP',
      'Invalid package path',
      name,
    );
    check(!names.has(name), 'ZIP', 'Duplicate path', name);
    names.add(name);
    check(u32(local) === 0x04034b50, 'ZIP', 'Invalid local header');
    check(
      u16(local + 6) === flags &&
        u16(local + 8) === method &&
        u32(local + 14) === checksum &&
        u32(local + 18) === compressed &&
        u32(local + 22) === size &&
        u16(local + 26) === nameSize,
      'ZIP',
      'Local and central headers disagree',
      name,
    );
    const localExtra = u16(local + 28),
      data = local + 30 + nameSize + localExtra;
    range(local + 30, nameSize + localExtra + size);
    check(
      bytes
        .subarray(local + 30, local + 30 + nameSize)
        .every((v, index) => v === bytes[cursor + 46 + index]),
      'ZIP',
      'Local filename differs',
      name,
    );
    check(data + size <= central, 'ZIP', 'Entry overlaps central directory', name);
    check(crc32(bytes.subarray(data, data + size)) === checksum, 'ZIP', 'CRC-32 mismatch', name);
    // ZIP64 is unnecessary for the bounded NOAP v1 profile.
    const extra = (start: number, length: number) => {
      let pos = start;
      while (pos < start + length) {
        check(pos + 4 <= start + length, 'ZIP', 'Invalid extra field');
        const kind = u16(pos),
          len = u16(pos + 2);
        check(
          kind !== 1 && pos + 4 + len <= start + length,
          'ZIP',
          'ZIP64 or malformed extra field',
        );
        pos += 4 + len;
      }
    };
    extra(cursor + 46 + nameSize, extraSize);
    extra(local + 30 + nameSize, localExtra);
    entries.push({ name, size });
    localEnd = data + size;
    cursor += 46 + nameSize + extraSize + commentSize;
  }
  check(cursor === end && localEnd === central, 'ZIP', 'Unexpected ZIP records');
  const extracted = unzipSync(bytes);
  return new Map(
    entries.map(({ name, size }) => {
      const data = extracted[name];
      check(data?.length === size, 'ZIP', 'Extracted size differs', name);
      return [name, data];
    }),
  );
}

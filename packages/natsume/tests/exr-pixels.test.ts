import { describe, expect, it } from 'vitest';
import { decodeExrPixels, exrImageSize, isOpenExr } from '../src/loader/exr-pixels.js';

const text = (s: string) => [...new TextEncoder().encode(s), 0];
function int(value: number): number[] {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return [...bytes];
}
const attribute = (name: string, type: string, bytes: number[]) => [
  ...text(name),
  ...text(type),
  ...int(bytes.length),
  ...bytes,
];
function image(
  options: {
    width?: number;
    height?: number;
    origin?: [number, number];
    channels?: string[];
    samples?: number[];
    pixelType?: number;
    sampling?: number;
    compression?: number;
    version?: number;
    reverseRows?: boolean;
  } = {},
) {
  const width = options.width ?? 2,
    height = options.height ?? 2;
  const [minX, minY] = options.origin ?? [0, 0];
  const channels = options.channels ?? ['A', 'B', 'G', 'R'];
  const list = channels.flatMap((c) => [
    ...text(c),
    ...int(options.pixelType ?? 1),
    0,
    0,
    0,
    0,
    ...int(options.sampling ?? 1),
    ...int(1),
  ]);
  const header = [
    ...int(20000630),
    ...int(options.version ?? 2),
    ...attribute('channels', 'chlist', [...list, 0]),
    ...attribute('compression', 'compression', [options.compression ?? 0]),
    ...attribute('dataWindow', 'box2i', [
      ...int(minX),
      ...int(minY),
      ...int(minX + width - 1),
      ...int(minY + height - 1),
    ]),
    0,
  ];
  const table = header.length;
  // Invalid dimension fixtures need only a complete offset table, not pixel allocation.
  if (width <= 0 || height <= 0 || width > 16384 || height > 16384 || width * height > 16_777_216)
    return { bytes: new Uint8Array(header), table, chunks: [] as number[] };
  const rowSize = width * channels.length * 2;
  const bytes = new Uint8Array(table + height * 8 + height * (8 + rowSize));
  bytes.set(header);
  const view = new DataView(bytes.buffer),
    chunks: number[] = [];
  for (let physical = 0; physical < height; physical++) {
    const y = options.reverseRows ? height - 1 - physical : physical;
    const start = table + height * 8 + physical * (8 + rowSize);
    chunks.push(start);
    view.setBigUint64(table + physical * 8, BigInt(start), true);
    view.setInt32(start, minY + y, true);
    view.setUint32(start + 4, rowSize, true);
    channels.forEach((c, channel) => {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4 + 'RGBA'.indexOf(c);
        view.setUint16(
          start + 8 + (channel * width + x) * 2,
          options.samples?.[index] ?? 0x3c00,
          true,
        );
      }
    });
  }
  return { bytes, table, chunks };
}

describe('source HALF OpenEXR', () => {
  it('retains HDR, negative, signed-zero and subnormal HALF values without quantization', () => {
    // 2, -1, smallest positive HALF subnormal, -0; followed by 1.1875, 0, 1, 0.5.
    const samples = [0x4000, 0xbc00, 0x0001, 0x8000, 0x3cc0, 0, 0x3c00, 0x3800];
    const { bytes } = image({ width: 2, height: 1, samples });
    const result = decodeExrPixels(bytes);
    expect(result.width).toBe(2);
    expect(result.height).toBe(1);
    expect([...result.rgba]).toEqual(samples);
    expect(exrImageSize(bytes)).toEqual({ width: 2, height: 1 });
  });
  it('uses scanline coordinates, declared channel ordering and data-window origin', () => {
    const samples = Array.from({ length: 24 }, (_, i) => 0x3000 + i);
    const { bytes } = image({
      width: 3,
      height: 2,
      origin: [-17, 42],
      channels: ['G', 'R', 'A', 'B'],
      reverseRows: true,
      samples,
    });
    expect([...decodeExrPixels(bytes).rgba]).toEqual(samples);
  });
  it('honors the byteOffset of a bounded input view', () => {
    const { bytes } = image();
    const padded = new Uint8Array(bytes.length + 28);
    padded.set(bytes, 13);
    expect([...decodeExrPixels(padded.subarray(13, 13 + bytes.length)).rgba]).toEqual(
      Array(16).fill(0x3c00),
    );
  });
  it('requires the complete format signature', () => {
    expect(isOpenExr(new Uint8Array())).toBe(false);
    expect(isOpenExr(new Uint8Array([0x76, 0x2f, 0x31, 1]))).toBe(false);
    const { bytes } = image();
    bytes[0] = 0;
    expect(isOpenExr(bytes)).toBe(false);
    expect(() => decodeExrPixels(bytes)).toThrow('Invalid source OpenEXR');
  });
  it.each([0, 1, 3, 0x202, 0x1002])('rejects unsupported file version/flags %i', (version) => {
    expect(() => decodeExrPixels(image({ version }).bytes)).toThrow('single-part scanline');
  });
  it.each([1, 2, 3, 9])('rejects unsupported compression %i', (compression) => {
    expect(() => decodeExrPixels(image({ compression }).bytes)).toThrow(
      'Compressed source OpenEXR',
    );
  });
  it.each([0, 2])('rejects non-HALF channel type %i', (pixelType) => {
    expect(() => decodeExrPixels(image({ pixelType }).bytes)).toThrow('requires HALF');
  });
  it('rejects subsampling, non-RGBA channels and duplicate channels', () => {
    expect(() => decodeExrPixels(image({ sampling: 2 }).bytes)).toThrow('Subsampled');
    expect(() => decodeExrPixels(image({ channels: ['R', 'G', 'B', 'Z'] }).bytes)).toThrow(
      'unique RGBA',
    );
    expect(() => decodeExrPixels(image({ channels: ['R', 'G', 'B', 'R'] }).bytes)).toThrow(
      'unique RGBA',
    );
    expect(() => decodeExrPixels(image({ channels: ['R', 'G', 'B'] }).bytes)).toThrow(
      'requires RGBA',
    );
  });
  it.each([
    [0, 1],
    [1, 0],
    [16385, 1],
    [1, 16385],
    [8192, 4096],
  ])('rejects invalid or excessive dimensions %i×%i before allocation', (width, height) => {
    expect(() => decodeExrPixels(image({ width, height }).bytes)).toThrow(
      'dimensions exceed pixel limit',
    );
  });
  it('rejects header, offset-table and row-payload truncation', () => {
    const { bytes, table, chunks } = image();
    for (const length of [0, 7, 9, table - 1, table + 15, chunks[0]! + 7, bytes.length - 1])
      expect(() => decodeExrPixels(bytes.subarray(0, length))).toThrow();
  });
  it.each([0n, 0xffffffffffffffffn])(
    'rejects an offset outside the scanline region: %s',
    (offset) => {
      const { bytes, table } = image();
      new DataView(bytes.buffer).setBigUint64(table, offset, true);
      expect(() => decodeExrPixels(bytes)).toThrow('Invalid OpenEXR scanline offset');
    },
  );
  it('rejects duplicate/missing rows, invalid coordinates and payload byte counts', () => {
    for (const mutation of ['duplicate', 'coordinate', 'size']) {
      const { bytes, chunks } = image();
      const view = new DataView(bytes.buffer);
      if (mutation === 'duplicate') view.setInt32(chunks[1]!, 0, true);
      if (mutation === 'coordinate') view.setInt32(chunks[1]!, -1, true);
      if (mutation === 'size') view.setUint32(chunks[0]! + 4, 2, true);
      expect(() => decodeExrPixels(bytes)).toThrow('Invalid OpenEXR scanline');
    }
  });
  it.each([0x7c00, 0xfc00, 0x7e00, 0x7c01])('rejects nonfinite HALF texel 0x%s', (value) => {
    expect(() =>
      decodeExrPixels(image({ width: 1, height: 1, samples: [value, 0, 0, 0] }).bytes),
    ).toThrow('Nonfinite source OpenEXR texel');
  });
});

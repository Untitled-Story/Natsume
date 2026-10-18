import { expect, it } from 'vitest';
import { LowQualityNoiseField } from '../src/particles/noise/low-quality-field.js';

// Unity 2022.3.21f1, Low, strength/frequency 1, dt 0.002; independent positions.
const native = [
  {
    seed: 212121,
    point: [-1.3854868412017822, 2.267932891845703, -5.356330394744873],
    expected: [0.2017021083395858, 0.41162965726748807, 1.826524647741805],
  },
  {
    seed: 95959,
    point: [-1.3854868412017822, 2.267932891845703, -5.356330394744873],
    expected: [-2.4988650088737576, 1.7524956824469569, -0.2851486070616367],
  },
  {
    seed: 7654321,
    point: [-1.3854868412017822, 2.267932891845703, -5.356330394744873],
    expected: [0.9741186632960552, -1.6168355173816797, 2.0833014452379444],
  },
  {
    seed: 987654321,
    point: [-1.3854868412017822, 2.267932891845703, -5.356330394744873],
    expected: [0.7144212383446441, 2.370118982274022, -0.9984969618512829],
  },
] as const;

for (const { seed, point, expected } of native)
  it(`matches the native Low field for seed ${seed}`, () => {
    const out = new Float64Array(3);
    new LowQualityNoiseField(seed, 1).sample(...point, out);
    for (let axis = 0; axis < 3; axis++)
      expect(Math.abs(out[axis]! - expected[axis]!)).toBeLessThan(3e-4);
  });

it('keeps Low curl components constant along their transverse axes', () => {
  const field = new LowQualityNoiseField(0xffffffff, 0.28);
  const a = new Float64Array(3);
  const b = new Float64Array(3);
  field.sample(-3, 2, -1, a);
  field.sample(17, 2, 41, b);
  expect(b[0]).toBe(a[0]);
  field.sample(17, 31, -1, b);
  expect(b[1]).toBe(a[1]);
  field.sample(-3, 31, 41, b);
  expect(b[2]).toBe(a[2]);
});

it('supports zero frequency and caller-owned output offsets', () => {
  const out = new Float32Array([7, 8, 9, 10, 11]);
  new LowQualityNoiseField(0, 0).sample(-1, 2, -3, out, 1);
  expect(out[0]).toBe(7);
  expect(out.subarray(1, 4).every((value) => value === 0)).toBe(true);
  expect(out[4]).toBe(11);
});

it('rejects invalid seeds and frequencies', () => {
  for (const seed of [-1, 0x100000000, 0.5, NaN])
    expect(() => new LowQualityNoiseField(seed, 1)).toThrow(RangeError);
  for (const frequency of [-1, NaN, Infinity])
    expect(() => new LowQualityNoiseField(0, frequency)).toThrow(RangeError);
});

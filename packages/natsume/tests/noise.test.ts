import { describe, expect, it } from 'vitest';
import { CurlNoiseField } from '../src/particles/noise/curl-field.js';

describe('approximate curl field', () => {
  it('reproduces its own seed independently of sampling order and writes into a caller buffer', () => {
    const a = new CurlNoiseField(0xffffffff, 0.28);
    const b = new CurlNoiseField(0xffffffff, 0.28);
    const first = new Float64Array(3);
    const result = new Float64Array(7).fill(123);
    a.sample(1.2, -3.4, 0.7, first);
    a.sample(100, -200, 300, result, 2);
    a.sample(1.2, -3.4, 0.7, result, 2);
    expect([...result.slice(2, 5)]).toEqual([...first]);
    expect([...result.slice(0, 2), ...result.slice(5)]).toEqual([123, 123, 123, 123]);
    b.sample(1.2, -3.4, 0.7, result);
    expect([...result.slice(0, 3)]).toEqual([...first]);
    new CurlNoiseField(0xfffffffe, 0.28).sample(1.2, -3.4, 0.7, result);
    expect([...result.slice(0, 3)]).not.toEqual([...first]);
  });

  it('forms a divergence-free field, including positions near lattice boundaries', () => {
    const field = new CurlNoiseField(30, 1, 1, 1);
    const low = new Float64Array(3);
    const high = new Float64Array(3);
    const epsilon = 0.00001;
    for (let i = 0; i < 40; i++) {
      const position = [i * 0.071, i * -0.137, i * 0.193];
      let divergence = 0;
      for (let axis = 0; axis < 3; axis++) {
        const before = [...position];
        const after = [...position];
        before[axis] = before[axis]! - epsilon;
        after[axis] = after[axis]! + epsilon;
        field.sample(before[0]!, before[1]!, before[2]!, low);
        field.sample(after[0]!, after[1]!, after[2]!, high);
        divergence += (high[axis]! - low[axis]!) / (2 * epsilon);
      }
      expect(Math.abs(divergence)).toBeLessThan(0.00001);
    }
  });

  it('has continuous output across lattice cells and zero output at zero frequency', () => {
    const field = new CurlNoiseField(0, 1);
    const low = new Float64Array(3);
    const high = new Float64Array(3);
    for (let i = 0; i < 100; i++) {
      const x = i * 0.1;
      field.sample(x - 1e-7, 0.3, -1.7, low);
      field.sample(x + 1e-7, 0.3, -1.7, high);
      expect(Math.hypot(high[0]! - low[0]!, high[1]! - low[1]!, high[2]! - low[2]!)).toBeLessThan(
        1e-5,
      );
    }
    new CurlNoiseField(0, 0).sample(1, 2, 3, high);
    expect(Math.hypot(...high)).toBe(0);
  });

  it('rejects invalid construction parameters', () => {
    for (const seed of [-1, 0x100000000, NaN, 0.5])
      expect(() => new CurlNoiseField(seed, 1)).toThrow(RangeError);
    for (const frequency of [-1, Infinity, NaN])
      expect(() => new CurlNoiseField(0, frequency)).toThrow(RangeError);
    expect(() => new CurlNoiseField(0, 1, 0)).toThrow(RangeError);
    expect(() => new CurlNoiseField(0, 1, 1, NaN)).toThrow(RangeError);
  });
});

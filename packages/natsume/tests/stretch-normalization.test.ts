import { expect, it } from 'vitest';
import { stretchInverseLength } from '../src/rendering/stretch-normalization.js';

it('matches native ordinary-stretch length factors across velocity magnitudes', () => {
  // Unity BakeMesh: sizeY=3, lengthScale=2, velocityScale=0.
  for (const [squared, nativeLength] of [
    [2, 5.994494276],
    [5, 5.999313509],
    [13, 6.01160427],
    [14, 5.996902902],
    [29, 6.006935508],
    [339, 6.01270974],
  ]) {
    const length = 6 * Math.sqrt(squared!) * stretchInverseLength(squared!);
    expect(Math.abs(length - nativeLength!)).toBeLessThan(1e-6);
  }
});

it('keeps zero, invalid and extreme normalization inputs bounded', () => {
  for (const value of [0, -1, NaN, Infinity]) expect(stretchInverseLength(value)).toBe(0);
  for (const value of [1e-40, 1e40])
    expect(stretchInverseLength(value) * Math.sqrt(value)).toBeCloseTo(1, 12);
  for (const value of [0.25, 1, 4, 16, 64])
    expect(stretchInverseLength(value) * Math.sqrt(value)).toBe(1);
});

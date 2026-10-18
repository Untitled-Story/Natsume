import { PERMUTATION, noiseOffsets } from './perlin-common.js';

function derivative(x: number): number {
  const cell = Math.floor(x);
  const t = x - cell;
  const fade = t * t * t * (t * (t * 6 - 15) + 10);
  const slope = 30 * t * t * (t - 1) * (t - 1);
  const a = PERMUTATION[cell & 255]! & 1 ? -2 : 2;
  const b = PERMUTATION[(cell + 1) & 255]! & 1 ? -2 : 2;
  return a * (1 - fade) + b * fade + (b * (t - 1) - a * t) * slope;
}

/** Separable curl field measured against Unity's Low quality Noise. */
export class LowQualityNoiseField {
  private readonly phase: Float32Array;

  constructor(
    seed: number,
    private readonly frequency: number,
  ) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
      throw new RangeError('Noise seed must be uint32');
    if (!Number.isFinite(frequency) || frequency < 0)
      throw new RangeError('Noise frequency must be finite and nonnegative');
    this.phase = noiseOffsets(seed);
  }

  sample(
    x: number,
    y: number,
    z: number,
    out: Float32Array | Float64Array,
    offset = 0,
    scroll = 0,
  ): void {
    const f = this.frequency;
    const p = this.phase;
    // Curl(N(z), N(x + 100), N(y)); retain the native Float32 coordinates.
    out[offset] = derivative(Math.fround(Math.fround(Math.fround(y + p[1]!) + scroll) * f)) * f;
    out[offset + 1] = derivative(Math.fround(Math.fround(Math.fround(z + p[2]!) + scroll) * f)) * f;
    out[offset + 2] =
      derivative(Math.fround(Math.fround(Math.fround(Math.fround(x + p[0]!) + 100) + scroll) * f)) *
      f;
  }
}

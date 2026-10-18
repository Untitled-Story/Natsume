import { PERMUTATION, noiseOffsets } from './perlin-common.js';

const GX2 = new Float64Array([Math.SQRT2, -Math.SQRT2, 0, 0, 1, -1, 1, -1]);
const GY2 = new Float64Array([0, 0, Math.SQRT2, -Math.SQRT2, 1, 1, -1, -1]);
const GX3 = new Int8Array([1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0, 1, -1, 0, 0]);
const GY3 = new Int8Array([1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, 1, -1, -1]);
const GZ3 = new Int8Array([0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1, 0, 0, 1, -1]);

function derivatives(
  x: number,
  y: number,
  z: number,
  quality: 1 | 2,
  out: Float64Array,
  offset: number,
): void {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const tx = x - ix,
    ty = y - iy,
    tz = z - iz;
  const fx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
  const fy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
  const fz = tz * tz * tz * (tz * (tz * 6 - 15) + 10);
  const dx = 30 * tx * tx * (tx - 1) * (tx - 1);
  const dy = 30 * ty * ty * (ty - 1) * (ty - 1);
  let a = 0,
    b = 0;
  for (let corner = 0; corner < (quality === 1 ? 4 : 8); corner++) {
    const cx = corner & 1,
      cy = (corner >> 1) & 1,
      cz = (corner >> 2) & 1;
    let h = PERMUTATION[(PERMUTATION[(ix + cx) & 255]! + iy + cy) & 255]!;
    let gx: number,
      gy: number,
      gz = 0;
    if (quality === 1) {
      h &= 7;
      gx = GX2[h]!;
      gy = GY2[h]!;
    } else {
      h = PERMUTATION[(h + iz + cz) & 255]! & 15;
      gx = GX3[h]!;
      gy = GY3[h]!;
      gz = GZ3[h]!;
    }
    const wx = cx ? fx : 1 - fx,
      wy = cy ? fy : 1 - fy;
    const wz = quality === 1 ? 1 : cz ? fz : 1 - fz;
    const dot = gx * (tx - cx) + gy * (ty - cy) + gz * (tz - cz);
    a += (gx * wx + dot * (cx ? dx : -dx)) * wy * wz;
    b += (gy * wy + dot * (cy ? dy : -dy)) * wx * wz;
  }
  out[offset] = a;
  out[offset + 1] = b;
}

/** Analytic Perlin curl field measured against Unity's Medium and High Noise. */
export class PerlinCurlNoiseField {
  private readonly phase: Float32Array;
  private readonly scratch = new Float64Array(6);

  constructor(
    seed: number,
    private readonly frequency: number,
    private readonly quality: 1 | 2,
  ) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
      throw new RangeError('Noise seed must be uint32');
    if (!Number.isFinite(frequency) || frequency < 0)
      throw new RangeError('Noise frequency must be finite and nonnegative');
    if (quality !== 1 && quality !== 2) throw new RangeError('Invalid noise quality');
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
    const f = this.frequency,
      p = this.phase,
      d = this.scratch;
    x = Math.fround(x + p[0]!);
    y = Math.fround(y + p[1]!);
    z = Math.fround(z + p[2]!);
    const x1 = Math.fround(x + 100);
    const y0 = Math.fround(y * f);
    const z0 = Math.fround(z * f);
    const shiftedX = Math.fround(Math.fround(x + scroll) * f);
    const shiftedX1 = Math.fround(Math.fround(x1 + scroll) * f);
    const shiftedY = Math.fround(Math.fround(y + scroll) * f);
    const shiftedZ = Math.fround(Math.fround(z + scroll) * f);
    // A=(N(z,y,x), N(x+100,z,y), N(y,x+100,z)); Medium uses two coordinates.
    // Unity scrolls the last coordinate used by each potential.
    if (this.quality === 1) {
      derivatives(z0, shiftedY, 0, 1, d, 0);
      derivatives(Math.fround(x1 * f), shiftedZ, 0, 1, d, 2);
      derivatives(y0, shiftedX1, 0, 1, d, 4);
    } else {
      derivatives(z0, y0, shiftedX, 2, d, 0);
      derivatives(Math.fround(x1 * f), z0, shiftedY, 2, d, 2);
      derivatives(y0, Math.fround(x1 * f), shiftedZ, 2, d, 4);
    }
    out[offset] = (d[4]! - d[3]!) * f;
    out[offset + 1] = (d[0]! - d[5]!) * f;
    out[offset + 2] = (d[2]! - d[1]!) * f;
  }
}

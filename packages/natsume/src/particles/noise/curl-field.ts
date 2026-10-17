// Natsume approximation, not Unity's native noise function or random sequence.
// Three independent gradient-noise potentials form an analytic curl field.
const GX = new Int8Array([1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0]);
const GY = new Int8Array([1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1]);
const GZ = new Int8Array([0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1]);

function hash(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function fadeDerivative(t: number): number {
  return 30 * t * t * (t - 1) * (t - 1);
}

export class CurlNoiseField {
  private readonly phase: Float64Array;
  private readonly seeds: Uint32Array;
  private readonly derivatives = new Float64Array(9);
  private readonly frequency: number;
  private readonly coordinateScale: number;
  private readonly amplitude: number;

  // Fitted against Unity 2022.3.21f1 High / one octave, using vector RMS and
  // spatial correlation. This does not fit Unity's individual seeded paths.
  constructor(
    seed: number,
    frequency: number,
    coordinateScale = 1.02,
    amplitude = 0.9816303202717301,
  ) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
      throw new RangeError('Noise seed must be uint32');
    if (!Number.isFinite(frequency) || frequency < 0)
      throw new RangeError('Noise frequency must be finite and nonnegative');
    if (!Number.isFinite(coordinateScale) || coordinateScale <= 0 || !Number.isFinite(amplitude))
      throw new RangeError('Invalid noise calibration');
    this.frequency = frequency;
    this.coordinateScale = coordinateScale;
    this.amplitude = amplitude;
    this.phase = Float64Array.from(
      [0xa341316c, 0xc8013ea4, 0xad90777d],
      (salt) => (hash(seed ^ salt) / 0x100000000) * 256,
    );
    this.seeds = Uint32Array.from([0x9e3779b9, 0x243f6a88, 0xb7e15162], (salt) =>
      hash(seed ^ salt),
    );
  }

  // Unit Strength, Damping off; frequency includes the spatial derivative scale.
  // Callers apply strength, Damping, Position Amount and dt during integration.
  // Writes into caller-owned storage and reuses all internal scratch memory.
  sample(x: number, y: number, z: number, out: Float32Array | Float64Array, offset = 0): void {
    const scale = this.frequency * this.coordinateScale;
    x = (x + this.phase[0]!) * scale;
    y = (y + this.phase[1]!) * scale;
    z = (z + this.phase[2]!) * scale;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const tx = x - ix;
    const ty = y - iy;
    const tz = z - iz;
    const fx = fade(tx);
    const fy = fade(ty);
    const fz = fade(tz);
    const dfx = fadeDerivative(tx);
    const dfy = fadeDerivative(ty);
    const dfz = fadeDerivative(tz);
    const derivatives = this.derivatives;
    derivatives.fill(0);
    for (let corner = 0; corner < 8; corner++) {
      const dx = corner & 1;
      const dy = (corner >> 1) & 1;
      const dz = (corner >> 2) & 1;
      const wx = dx ? fx : 1 - fx;
      const wy = dy ? fy : 1 - fy;
      const wz = dz ? fz : 1 - fz;
      const weight = wx * wy * wz;
      const dwx = (dx ? dfx : -dfx) * wy * wz;
      const dwy = wx * (dy ? dfy : -dfy) * wz;
      const dwz = wx * wy * (dz ? dfz : -dfz);
      const cell =
        Math.imul((ix + dx) & 255, 0x8da6b343) ^
        Math.imul((iy + dy) & 255, 0xd8163841) ^
        Math.imul((iz + dz) & 255, 0xcb1ab31f);
      for (let potential = 0; potential < 3; potential++) {
        const gradient = hash(cell ^ this.seeds[potential]!) % 12;
        const gx = GX[gradient]!;
        const gy = GY[gradient]!;
        const gz = GZ[gradient]!;
        const dot = gx * (tx - dx) + gy * (ty - dy) + gz * (tz - dz);
        const index = potential * 3;
        derivatives[index] = derivatives[index]! + gx * weight + dot * dwx;
        derivatives[index + 1] = derivatives[index + 1]! + gy * weight + dot * dwy;
        derivatives[index + 2] = derivatives[index + 2]! + gz * weight + dot * dwz;
      }
    }
    // Curl(Ax, Ay, Az). Compensate calibration's coordinate scale so amplitude
    // and correlation length can be fitted independently.
    const gain = this.frequency * this.amplitude;
    out[offset] = (derivatives[7]! - derivatives[5]!) * gain;
    out[offset + 1] = (derivatives[2]! - derivatives[6]!) * gain;
    out[offset + 2] = (derivatives[3]! - derivatives[1]!) * gain;
  }
}

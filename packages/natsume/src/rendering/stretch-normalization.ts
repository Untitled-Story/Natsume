// ARM reciprocal-square-root estimate, normalized so powers of four are exact.
// Unity's ordinary stretch applies this estimate only to the size/length term.
const estimates = new Float64Array(256);
for (let parity = 0; parity < 2; parity++) {
  for (let i = 0; i < 128; i++) {
    const midpoint = (128 + i + 0.5) / (parity ? 256 : 512);
    estimates[parity * 128 + i] = Math.round(256 / Math.sqrt(midpoint)) * (2 / 511);
  }
}
const scalar = new Float32Array(1);
const bits = new Uint32Array(scalar.buffer);

/** Reciprocal length used by ordinary stretch; subnormal inputs use exact normalization. */
export function stretchInverseLength(squaredLength: number): number {
  scalar[0] = squaredLength;
  const word = bits[0]!;
  const exponent = (word >>> 23) - 127;
  if (squaredLength <= 0 || !Number.isFinite(squaredLength)) return 0;
  if (exponent <= -127 || exponent >= 128) return 1 / Math.sqrt(squaredLength);
  const index = ((exponent & 1) << 7) | ((word >>> 16) & 127);
  bits[0] = (126 - (exponent >> 1)) << 23;
  return estimates[index]! * scalar[0]!;
}

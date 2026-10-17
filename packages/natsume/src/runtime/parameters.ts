import { check } from '../errors.js';
import type { DeepReadonly as R } from '../pack.js';
import type { ScalarCurveT } from '../format/generated/noa/ir/scalar-curve.js';
import type { ScalarParameterT } from '../format/generated/noa/ir/scalar-parameter.js';
import type { ColorParameterT } from '../format/generated/noa/ir/color-parameter.js';
import type { GradientT } from '../format/generated/noa/ir/gradient.js';
import { ScalarMode } from '../format/generated/noa/ir/scalar-mode.js';
import { WrapMode } from '../format/generated/noa/ir/wrap-mode.js';
import { Interpolation } from '../format/generated/noa/ir/interpolation.js';
import { ColorMode } from '../format/generated/noa/ir/color-mode.js';
import { GradientMode } from '../format/generated/noa/ir/gradient-mode.js';
import { CurveDomain } from '../format/generated/noa/ir/curve-domain.js';
import type { TextureSheetModuleT } from '../format/generated/noa/ir/texture-sheet-module.js';

export function sheetFrame(
  sheet: R<TextureSheetModuleT> | undefined,
  age: number,
  startRandom: number,
  frameRandom: number,
): number {
  if (!sheet) return 0;
  // Native cycles wrap lifetime before evaluating the curve, including for
  // constant and nonlinear curves. Preserve the final frame at lifetime end.
  const cycles = sheet.cycles;
  const progress = Math.min(Math.max(age, 0) * cycles, Math.max(0, cycles - 1e-7));
  const phase = progress % 1;
  const start = Math.max(0, Math.min(1, scalar(sheet.startFrame, 0, startRandom)));
  let value = scalar(sheet.frameOverTime, phase, frameRandom) + start;
  if (value < 0 || value > 1) {
    const wrapped = ((value % 1) + 1) % 1;
    value = wrapped === 0 && value > 0 ? 1 : wrapped;
  }
  const count = sheet.columns * sheet.rows;
  return Math.max(0, Math.min(count - 1, Math.floor(value * count)));
}

export function validateParameters(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if ('preWrap' in value && 'keys' in value) {
    const c = value as R<ScalarCurveT>;
    check(
      c.domain === CurveDomain.Normalized,
      'CAPABILITY',
      'Particle curves require normalized time',
    );
    for (const [mode, source] of [
      [c.preWrap, c.sourcePreInfinity],
      [c.postWrap, c.sourcePostInfinity],
    ]) {
      check(
        mode !== WrapMode.UnitySerialized || source === 2,
        'CAPABILITY',
        'Only verified Unity internal wrap code 2 (clamp) is supported',
      );
    }
    for (const k of c.keys)
      check(
        !k.weightedIn && !k.weightedOut && k.interpolation !== Interpolation.WeightedBezier,
        'CAPABILITY',
        'Weighted curves are not supported',
      );
  }
  if ('keyColorSpace' in value)
    check(
      (value as R<GradientT>).mode !== GradientMode.PerceptualBlend,
      'CAPABILITY',
      'Perceptual gradients are not supported',
    );
  for (const child of Object.values(value)) validateParameters(child);
}

export function curve(c: R<ScalarCurveT> | null | undefined, time: number): number {
  if (!c?.keys.length) return 0;
  const keys = c.keys,
    first = keys[0]!,
    last = keys.at(-1)!;
  let t = time;
  if (t < first.time || t >= last.time) {
    const mode = t < first.time ? c.preWrap : c.postWrap;
    const duration = last.time - first.time;
    if (duration > 0 && (mode === WrapMode.Loop || mode === WrapMode.PingPong)) {
      const period = duration * (mode === WrapMode.PingPong ? 2 : 1);
      let u = (((t - first.time) % period) + period) % period;
      if (u > duration) u = period - u;
      t = first.time + u;
    }
  }
  if (t <= first.time) return first.value;
  if (t >= last.time) return last.value;
  let lo = 0,
    hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid]!.time <= t) lo = mid;
    else hi = mid;
  }
  const a = keys[lo]!,
    b = keys[hi]!,
    dt = b.time - a.time,
    u = (t - a.time) / dt;
  if (a.interpolation === Interpolation.Step) return a.value;
  if (a.interpolation === Interpolation.Linear) return a.value + (b.value - a.value) * u;
  return (
    (2 * u * u * u - 3 * u * u + 1) * a.value +
    (u * u * u - 2 * u * u + u) * dt * a.outSlope +
    (-2 * u * u * u + 3 * u * u) * b.value +
    (u * u * u - u * u) * dt * b.inSlope
  );
}

export function scalar(
  p: R<ScalarParameterT> | null | undefined,
  t = 0,
  random = 0,
  fallback = 0,
): number {
  if (!p) return fallback;
  let v: number;
  switch (p.mode) {
    case ScalarMode.Constant:
      v = p.constantMax;
      break;
    case ScalarMode.TwoConstants:
      v = p.constantMin + (p.constantMax - p.constantMin) * random;
      break;
    case ScalarMode.Curve:
      v = curve(p.curveMax, t);
      break;
    case ScalarMode.TwoCurves: {
      const a = curve(p.curveMin, t);
      v = a + (curve(p.curveMax, t) - a) * random;
      break;
    }
  }
  return v * p.multiplier;
}

export function constantZero(p: R<ScalarParameterT> | null | undefined): boolean {
  return (
    !p ||
    (p.mode === ScalarMode.Constant && p.constantMax === 0) ||
    (p.mode === ScalarMode.TwoConstants && p.constantMin === 0 && p.constantMax === 0)
  );
}

function gradient(g: R<GradientT> | null, t: number, out: Float32Array, offset: number): void {
  out.fill(1, offset, offset + 4);
  if (!g) return;
  const rgb = g.rgb,
    alpha = g.alpha;
  if (rgb.length) {
    let i = 0;
    while (i < rgb.length - 1 && t > rgb[i]!.time) i++;
    const b = rgb[i]!,
      a = rgb[Math.max(0, i - 1)]!;
    const u =
      g.mode === GradientMode.Fixed || a === b
        ? 1
        : Math.max(0, Math.min(1, (t - a.time) / (b.time - a.time)));
    out[offset] = a.r + (b.r - a.r) * u;
    out[offset + 1] = a.g + (b.g - a.g) * u;
    out[offset + 2] = a.b + (b.b - a.b) * u;
  }
  if (alpha.length) {
    let i = 0;
    while (i < alpha.length - 1 && t > alpha[i]!.time) i++;
    const b = alpha[i]!,
      a = alpha[Math.max(0, i - 1)]!;
    const u =
      g.mode === GradientMode.Fixed || a === b
        ? 1
        : Math.max(0, Math.min(1, (t - a.time) / (b.time - a.time)));
    out[offset + 3] = a.alpha + (b.alpha - a.alpha) * u;
  }
}

export function color(
  p: R<ColorParameterT> | null,
  t: number,
  random: number,
  out: Float32Array,
  offset = 0,
): void {
  out.fill(1, offset, offset + 4);
  if (!p) return;
  if (p.mode === ColorMode.Constant || p.mode === ColorMode.TwoColors) {
    const b = p.colorMax,
      a = p.mode === ColorMode.TwoColors ? p.colorMin : b;
    if (a && b) {
      const u = p.mode === ColorMode.TwoColors ? random : 1;
      out[offset] = a.r + (b.r - a.r) * u;
      out[offset + 1] = a.g + (b.g - a.g) * u;
      out[offset + 2] = a.b + (b.b - a.b) * u;
      out[offset + 3] = a.a + (b.a - a.a) * u;
    }
  } else if (p.mode === ColorMode.TwoGradients) {
    // Evaluate each channel without a per-particle temporary allocation.
    gradient(p.gradientMin, t, out, offset);
    const r = out[offset]!,
      g = out[offset + 1]!,
      b = out[offset + 2]!,
      a = out[offset + 3]!;
    gradient(p.gradientMax, t, out, offset);
    out[offset] = r + (out[offset]! - r) * random;
    out[offset + 1] = g + (out[offset + 1]! - g) * random;
    out[offset + 2] = b + (out[offset + 2]! - b) * random;
    out[offset + 3] = a + (out[offset + 3]! - a) * random;
  } else gradient(p.gradientMax, p.mode === ColorMode.RandomColor ? random : t, out, offset);
}

/** Stable independent channels: evaluation order never changes a particle's random values. */
export function random(seed: number, serial: number, channel: number): number {
  let x = (seed ^ Math.imul(serial + 1, 0x9e3779b9) ^ Math.imul(channel + 1, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

import { SupportChecks, assertSupport, type SupportIssue } from './support-checks.js';
import type { DeepReadonly as R } from '../pack.js';
import type { ScalarCurveT } from '../format/generated/noa/ir/scalar-curve.js';
import type { ScalarParameterT } from '../format/generated/noa/ir/scalar-parameter.js';
import type { ColorParameterT } from '../format/generated/noa/ir/color-parameter.js';
import type { GradientT } from '../format/generated/noa/ir/gradient.js';
import { ScalarMode } from '../format/generated/noa/ir/scalar-mode.js';
import { WrapMode } from '../format/generated/noa/ir/wrap-mode.js';
import { Interpolation } from '../format/generated/noa/ir/interpolation.js';
import { ColorMode } from '../format/generated/noa/ir/color-mode.js';
import { ColorSpace } from '../format/generated/noa/ir/color-space.js';
import { GradientMode } from '../format/generated/noa/ir/gradient-mode.js';
import { SheetTime } from '../format/generated/noa/ir/sheet-time.js';
import { SheetRow } from '../format/generated/noa/ir/sheet-row.js';
import { SheetAnimation } from '../format/generated/noa/ir/sheet-animation.js';
import type { TextureSheetModuleT } from '../format/generated/noa/ir/texture-sheet-module.js';

export function sheetFrame(
  sheet: R<TextureSheetModuleT> | undefined,
  age: number,
  startRandom: number,
  frameRandom: number,
  seconds = 0,
  speed = 0,
  rowRandom = 0,
  meshIndex = 0,
): number {
  if (!sheet) return 0;
  // Native cycles wrap lifetime before evaluating the curve, including for
  // constant and nonlinear curves. Native lifetime phase contracts by 0.9999,
  // delaying exact tile boundaries slightly without delaying a simulation step.
  const cycles = sheet.cycles;
  const progress = Math.min(Math.max(age, 0) * cycles, Math.max(0, cycles - 1e-7));
  const phase =
    sheet.timeMode === SheetTime.Speed
      ? Math.max(
          0,
          Math.min(
            1,
            (speed - (sheet.speedRange?.x ?? 0)) /
              ((sheet.speedRange?.y ?? 1) - (sheet.speedRange?.x ?? 0) || 1),
          ),
        )
      : (progress % 1) * 0.9999;
  const start = Math.max(0, Math.min(1, scalar(sheet.startFrame, 0, startRandom)));
  const sprites = sheet.mode === 1;
  const singleRow = !sprites && sheet.animation === SheetAnimation.SingleRow;
  const count = sprites
    ? sheet.spriteAssetIds.length
    : sheet.columns * (singleRow ? 1 : sheet.rows);
  if (!count) return 0;
  let value =
    (sheet.timeMode === SheetTime.FPS
      ? (seconds * sheet.fps) / count
      : scalar(sheet.frameOverTime, phase, frameRandom)) + start;
  if (value < 0 || value > 1) {
    const wrapped = ((value % 1) + 1) % 1;
    value = wrapped === 0 && value > 0 ? 1 : wrapped;
  }
  const row = !singleRow
    ? 0
    : sheet.rowMode === SheetRow.Random
      ? Math.min(sheet.rows - 1, Math.floor(rowRandom * sheet.rows))
      : sheet.rowMode === SheetRow.MeshIndex
        ? meshIndex % sheet.rows
        : sheet.row;
  return Math.max(0, Math.min(count - 1, Math.floor(value * count))) + row * sheet.columns;
}

/** Checks only parameter branches consumed by the selected mode. */
export function parameterSupport(value: unknown, path = ''): readonly SupportIssue[] {
  const rules = new SupportChecks();
  const visit = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return;
    const child = (key: string) => (path ? `${path}.${key}` : key);
    if ('constantMax' in value) {
      const p = value as R<ScalarParameterT>;
      if (p.mode === ScalarMode.TwoCurves) visit(p.curveMin, child('curveMin'));
      if (p.mode === ScalarMode.Curve || p.mode === ScalarMode.TwoCurves)
        visit(p.curveMax, child('curveMax'));
      return;
    }
    if ('gradientMax' in value) {
      const p = value as R<ColorParameterT>;
      if (p.mode === ColorMode.TwoGradients) visit(p.gradientMin, child('gradientMin'));
      if (p.mode !== ColorMode.Constant && p.mode !== ColorMode.TwoColors)
        visit(p.gradientMax, child('gradientMax'));
      return;
    }
    if ('preWrap' in value && 'keys' in value) {
      const c = value as R<ScalarCurveT>;
      for (const [mode, source, field] of [
        [c.preWrap, c.sourcePreInfinity, 'sourcePreInfinity'],
        [c.postWrap, c.sourcePostInfinity, 'sourcePostInfinity'],
      ] as const)
        rules.require(
          mode !== WrapMode.UnitySerialized || [0, 1, 2, 3, 4, 5, 8].includes(source),
          'CAPABILITY',
          child(field),
          source,
          'Unverified Unity serialized infinity code',
        );
    }
    for (const [key, nested] of Object.entries(value)) visit(nested, child(key));
  };
  visit(value, path);
  return rules.issues;
}

export function validateParameters(value: unknown): void {
  assertSupport(parameterSupport(value));
}

export function curve(c: R<ScalarCurveT> | null | undefined, time: number): number {
  if (!c?.keys.length) return 0;
  const keys = c.keys,
    first = keys[0]!,
    last = keys.at(-1)!;
  let t = time;
  if (t < first.time || t >= last.time) {
    let mode = t < first.time ? c.preWrap : c.postWrap;
    if (mode === WrapMode.UnitySerialized) {
      const code = t < first.time ? c.sourcePreInfinity : c.sourcePostInfinity;
      mode = code === 2 ? WrapMode.Clamp : code === 0 ? WrapMode.PingPong : WrapMode.Loop;
    }
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
  if (a.weightedOut || b.weightedIn || a.interpolation === Interpolation.WeightedBezier) {
    const w0 = a.weightedOut ? a.outWeight : 1 / 3,
      w1 = b.weightedIn ? b.inWeight : 1 / 3;
    // Invert Bezier time, including zero weights and flat endpoint derivatives.
    let left = 0,
      right = 1;
    for (let i = 0; i < 28; i++) {
      const q = (left + right) / 2,
        r = 1 - q;
      const x = 3 * r * r * q * w0 + 3 * r * q * q * (1 - w1) + q * q * q;
      if (x < u) left = q;
      else right = q;
    }
    const q = (left + right) / 2,
      r = 1 - q;
    return (
      r * r * r * a.value +
      3 * r * r * q * (a.value + a.outSlope * dt * w0) +
      3 * r * q * q * (b.value - b.inSlope * dt * w1) +
      q * q * q * b.value
    );
  }
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

function linearRGB(x: number): number {
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}
function srgb(x: number): number {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
}
function oklab(r: number, g: number, b: number, linear: boolean): readonly number[] {
  if (!linear) {
    r = linearRGB(r);
    g = linearRGB(g);
    b = linearRGB(b);
  }
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
    m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const perceptualKeys = new WeakMap<object, readonly (readonly number[])[]>();
function perceptual(
  g: R<GradientT>,
  index: number,
  u: number,
  out: Float32Array,
  offset: number,
): void {
  let keys = perceptualKeys.get(g);
  const linear = g.keyColorSpace === ColorSpace.Linear;
  if (!keys) {
    keys = g.rgb.map((k) => oklab(k.r, k.g, k.b, linear));
    perceptualKeys.set(g, keys);
  }
  const a = keys[Math.max(0, index - 1)]!,
    b = keys[index]!;
  const L = a[0]! + (b[0]! - a[0]!) * u,
    A = a[1]! + (b[1]! - a[1]!) * u,
    B = a[2]! + (b[2]! - a[2]!) * u;
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3,
    m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3,
    s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  out[offset] = linear ? r : srgb(r);
  out[offset + 1] = linear ? green : srgb(green);
  out[offset + 2] = linear ? blue : srgb(blue);
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
    if (g.mode === GradientMode.PerceptualBlend) perceptual(g, i, u, out, offset);
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

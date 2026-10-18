import { constant, linear, particleSource } from './particle-fixtures.js';
import { prewarmDuration } from '../src/runtime/emitter.js';
import { expect, it } from 'vitest';
import { curve, color, validateParameters } from '../src/runtime/parameters.js';
import { ScalarCurveT } from '../src/format/generated/noa/ir/scalar-curve.js';
import { FloatKeyT } from '../src/format/generated/noa/ir/float-key.js';
import { WrapMode } from '../src/format/generated/noa/ir/wrap-mode.js';
import { ColorParameterT } from '../src/format/generated/noa/ir/color-parameter.js';
import { GradientT } from '../src/format/generated/noa/ir/gradient.js';
import { RgbKeyT } from '../src/format/generated/noa/ir/rgb-key.js';
import { AlphaKeyT } from '../src/format/generated/noa/ir/alpha-key.js';
import { readNativeFixture, hasNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';
const native = JSON.parse(readNativeFixture('unity-compatibility.json')) as {
  curves?: { label: string; values: number[] }[];
  gradient?: { r: number; g: number; b: number; a: number }[];
};
for (const c of native.curves ?? [])
  it('matches native ' + c.label, () => {
    const source = new ScalarCurveT(),
      a = new FloatKeyT(),
      b = new FloatKeyT();
    a.value = 2;
    a.interpolation = 3;
    b.time = 1;
    b.value = 3;
    a.outSlope = 4;
    b.inSlope = -2;
    a.weightedOut = b.weightedIn = true;
    a.outWeight = Number(c.label.slice(9));
    b.inWeight = 0.7;
    source.keys = [a, b];
    const wrapped = c.label.startsWith('wrap');
    if (wrapped) {
      a.weightedOut = b.weightedIn = false;
      a.interpolation = 1;
      b.value = 6;
      source.preWrap = source.postWrap = WrapMode.UnitySerialized;
      source.sourcePreInfinity = source.sourcePostInfinity = Number(c.label.slice(5));
    }
    validateParameters(source);
    for (const [i, v] of c.values.entries()) {
      const t = wrapped ? [-1.25, -0.25, 0, 0.25, 1, 1.25, 2.25][i]! : i / 40;
      const error = curve(source, t) - v;
      recordError('curve.' + c.label, error, 'value', String(t));
      expect(Math.abs(error)).toBeLessThan(0.0001);
    }
  });
it.skipIf(!hasNativeFixture('unity-compatibility.json'))(
  'matches native perceptual color within native byte quantization',
  () => {
    const p = new ColorParameterT();
    p.mode = 1;
    p.gradientMax = new GradientT(
      2,
      [new RgbKeyT(0, 1, 0, 0), new RgbKeyT(1, 0, 0, 1)],
      [new AlphaKeyT(0, 0.2), new AlphaKeyT(1, 0.8)],
    );
    const out = new Float32Array(4);
    for (const [i, v] of native.gradient!.entries()) {
      color(p, i / 4, 0, out);
      for (const [j, k] of (['r', 'g', 'b', 'a'] as const).entries()) {
        recordError('gradient.perceptual', out[j]! - v[k], 'channel', i + '/' + k);
        expect(Math.abs(out[j]! - v[k])).toBeLessThan(0.004);
      }
    }
  },
);

it('ignores inactive curve branches while validating selected curves', () => {
  const c = new ScalarCurveT();
  c.preWrap = WrapMode.UnitySerialized;
  c.sourcePreInfinity = 99;
  const p = constant(1);
  p.curveMin = p.curveMax = c;
  expect(() => validateParameters(p)).not.toThrow();
  p.mode = 1;
  expect(() => validateParameters(p)).toThrow('infinity code');
});

it('evaluates weighted endpoint handles and native key time coordinates', () => {
  const c = new ScalarCurveT();
  const a = new FloatKeyT(),
    b = new FloatKeyT();
  a.time = 2;
  a.value = 1;
  a.outSlope = 4;
  a.weightedOut = true;
  a.outWeight = 1;
  a.interpolation = 3;
  b.time = 4;
  b.value = 1;
  b.weightedIn = true;
  b.inWeight = 0;
  c.keys = [a, b];
  expect(curve(c, 2)).toBe(1);
  expect(curve(c, 4)).toBe(1);
  expect(curve(c, 3)).toBeGreaterThan(3);
  const source = particleSource();
  source.main!.loop = source.main!.prewarm = true;
  source.main!.durationSeconds = 1;
  source.main!.lifetime = linear(1, 1);
  source.main!.lifetime!.curveMax = c;
  expect(prewarmDuration(source.main!)).toBe(9);
});

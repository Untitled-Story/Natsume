import { readNativeFixture, hasNativeFixture } from './native-fixture.js';
import { expect, it } from 'vitest';
import { curve } from '../src/runtime/parameters.js';
import { ScalarCurveT } from '../src/format/generated/noa/ir/scalar-curve.js';
import { FloatKeyT } from '../src/format/generated/noa/ir/float-key.js';
import { WrapMode } from '../src/format/generated/noa/ir/wrap-mode.js';
import { recordError } from './measurement.js';
const native = JSON.parse(readNativeFixture('unity-curves.json')) as {
  cases: { label: string; samples: { time: number; value: number }[] }[];
};
for (const label of ['raw-2', 'public-1', 'public-2', 'public-4', 'public-8'])
  it.skipIf(!hasNativeFixture('unity-curves.json'))('matches Unity curve ' + label, () => {
    const c = new ScalarCurveT();
    c.preWrap = c.postWrap =
      label === 'raw-2'
        ? WrapMode.UnitySerialized
        : label === 'public-2'
          ? WrapMode.Loop
          : label === 'public-4'
            ? WrapMode.PingPong
            : WrapMode.Clamp;
    c.sourcePreInfinity = c.sourcePostInfinity = 2;
    const a = new FloatKeyT(),
      b = new FloatKeyT();
    a.value = 2;
    a.outSlope = 4;
    a.interpolation = 2;
    b.time = 1;
    b.value = 6;
    b.inSlope = 4;
    c.keys = [a, b];
    for (const sample of native.cases.find((c) => c.label === label)!.samples) {
      const error = curve(c, sample.time) - sample.value;
      recordError('curve.' + label, error, 'value', String(sample.time));
      expect(Math.abs(error)).toBeLessThan(1e-6);
    }
  });

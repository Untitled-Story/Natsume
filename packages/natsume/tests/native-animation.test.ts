import { expect, it } from 'vitest';
import { readNativeFixture, hasNativeFixture } from './native-fixture.js';
import { Simulation } from '../src/runtime/simulation.js';
import { EffectPack } from '../src/pack.js';
import { minimalDocument } from './helpers.js';
import { AnimationT } from '../src/format/generated/noa/ir/animation.js';
import { AnimatorT } from '../src/format/generated/noa/ir/animator.js';
import { AnimatorLayerT } from '../src/format/generated/noa/ir/animator-layer.js';
import { AnimatorStateT } from '../src/format/generated/noa/ir/animator-state.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { NodeT } from '../src/format/generated/noa/ir/node.js';
import { TrackT } from '../src/format/generated/noa/ir/track.js';
import { BindingT } from '../src/format/generated/noa/ir/binding.js';
import { BoolTrackT } from '../src/format/generated/noa/ir/bool-track.js';
import { recordError } from './measurement.js';
import { AnimationClock, sampleBool } from '../src/runtime/animation.js';
import { curve } from '../src/runtime/parameters.js';
import { ScalarCurveT } from '../src/format/generated/noa/ir/scalar-curve.js';
import { FloatKeyT } from '../src/format/generated/noa/ir/float-key.js';
import { BoolKeyT } from '../src/format/generated/noa/ir/bool-key.js';
import { CurveDomain } from '../src/format/generated/noa/ir/curve-domain.js';
import { WrapMode } from '../src/format/generated/noa/ir/wrap-mode.js';

interface CurveCase {
  label: string;
  interpolation: number;
  preWrap: number;
  postWrap: number;
  holdout: boolean;
  keys: {
    time: number;
    value: number;
    inSlope: number;
    outSlope: number;
    inWeight: number;
    outWeight: number;
    weightedMode: number;
  }[];
  samples: { time: number; value: number }[];
}
interface ClockCase {
  label: string;
  duration: number;
  speed: number;
  storedOffset: number;
  delta: number;
  loop: boolean;
  holdout: boolean;
  samples: {
    elapsed: number;
    normalizedTime: number;
    value: number;
    active: boolean;
    ownerActive?: boolean;
  }[];
}
const native = JSON.parse(readNativeFixture('unity-animation.json')) as {
  curves: CurveCase[];
  clocks?: ClockCase[];
  disableClocks?: ClockCase[];
};
const wrap = (v: number) =>
  v === 2 ? WrapMode.Loop : v === 4 ? WrapMode.PingPong : WrapMode.Clamp;
for (const holdout of [false, true]) {
  it.skipIf(!hasNativeFixture('unity-animation.json'))(
    `matches Unity multi-key curves (${holdout ? 'holdout' : 'primary'})`,
    () => {
      for (const item of native.curves.filter((c) => c.holdout === holdout)) {
        const c = new ScalarCurveT();
        c.domain = CurveDomain.Seconds;
        c.preWrap = wrap(item.preWrap);
        c.postWrap = wrap(item.postWrap);
        c.keys = item.keys.map((k) =>
          Object.assign(new FloatKeyT(), k, {
            interpolation: item.interpolation,
            weightedIn: (k.weightedMode & 1) !== 0,
            weightedOut: (k.weightedMode & 2) !== 0,
          }),
        );
        for (const s of item.samples) {
          const error = curve(c, s.time) - s.value;
          recordError(
            `animation.curve.${holdout ? 'holdout' : 'primary'}.${item.interpolation}`,
            error,
            'value',
            `${item.label}/${s.time}`,
          );
          expect(Math.abs(error), `${item.label}/${s.time}`).toBeLessThan(2e-4);
        }
      }
    },
  );
  it.skipIf(!hasNativeFixture('unity-animation.json'))(
    `matches Unity animation clock and stepped active (${holdout ? 'holdout' : 'primary'})`,
    () => {
      for (const c of (native.clocks ?? []).filter((c) => c.holdout === holdout)) {
        const clock = new AnimationClock(c.duration, c.loop, c.speed, c.storedOffset);
        const keys =
          c.duration === 0
            ? [new BoolKeyT(0, true)]
            : [
                new BoolKeyT(0, true),
                new BoolKeyT(Math.fround(c.duration * 0.25), false),
                new BoolKeyT(Math.fround(c.duration * 0.75), true),
              ];
        for (const [i, s] of c.samples.entries()) {
          const value = c.duration === 0 ? 2 : 2 + (4 * clock.seconds) / c.duration;
          recordError(
            `animation.time.${holdout ? 'holdout' : 'primary'}`,
            clock.seconds - ((s.value - 2) * c.duration) / 4,
            'seconds',
            `${c.label}/${i}`,
          );
          recordError(
            `animation.clock.${holdout ? 'holdout' : 'primary'}`,
            value - s.value,
            'value',
            `${c.label}/${i}`,
          );
          recordError(
            `animation.active.${holdout ? 'holdout' : 'primary'}`,
            Number(sampleBool(keys, clock.seconds) !== s.active),
            'boolean',
            `${c.label}/${i}`,
          );
          expect(Math.abs(value - s.value), `${c.label}/${i}`).toBeLessThan(1e-5);
          expect(sampleBool(keys, clock.seconds), `${c.label}/${i}`).toBe(s.active);
          if (c.duration > 0) expect(clock.normalizedTime).toBe(s.normalizedTime);
          clock.advance(c.delta);
        }
      }
    },
  );
}

it.skipIf(!hasNativeFixture('unity-animation.json'))(
  'matches Unity owner disable and retained/default state time',
  () => {
    for (const [index, c] of (native.disableClocks ?? []).entries()) {
      const d = minimalDocument();
      d.nodes.push(new NodeT(3, 'target', 1, true, d.nodes[0]!.transform));
      const keys = [new BoolKeyT(0, true), new BoolKeyT(0.25, false), new BoolKeyT(0.75, true)];
      d.animations = [
        new AnimationT(6, 'active', 1, true, [
          new TrackT(new BindingT(3, 1), 5, new BoolTrackT(keys)),
        ]),
      ];
      d.components = [
        new ComponentT(
          4,
          1,
          true,
          6,
          new AnimatorT(index === 1, false, [
            new AnimatorLayerT('Base', 1, 5, [new AnimatorStateT(5, 'default', 6, 1, 0.25, true)]),
          ]),
        ),
      ];
      const pack = new EffectPack(
        d,
        {
          format: 'noa-package',
          version: 1,
          noir_version: [2, 0],
          document: 'scene.noir',
          files: [],
        },
        new Map(),
        new Map(),
      );
      const s = new Simulation(pack);
      s.play();
      for (const [i, sample] of c.samples.entries()) {
        if (i === 4) s.setNodeActive(1, false);
        if (i === 8) s.setNodeActive(1, true);
        const active = s.scene.nodes.get(3)!.active;
        recordError(
          'animation.disable.active',
          Number(active !== sample.active),
          'boolean',
          `${c.label}/${i}`,
        );
        expect(active, `${c.label}/${i}`).toBe(sample.active);
        s.update(c.delta);
      }
    }
  },
);

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { minimalDocument } from './helpers.js';
import { EffectPack } from '../src/pack.js';
import { Scene } from '../src/runtime/scene.js';
import { Simulation } from '../src/runtime/simulation.js';
import { AnimationBindings } from '../src/runtime/animation-bindings.js';
import { AnimatorController } from '../src/runtime/animator-controller.js';
import { NatsumeAnimator } from '../src/runtime/animator-handle.js';
import { AnimatorT } from '../src/format/generated/noa/ir/animator.js';
import { AnimatorLayerT } from '../src/format/generated/noa/ir/animator-layer.js';
import { AnimatorStateT } from '../src/format/generated/noa/ir/animator-state.js';
import { AnimatorParameterT } from '../src/format/generated/noa/ir/animator-parameter.js';
import { AnimatorParameterType as PT } from '../src/format/generated/noa/ir/animator-parameter-type.js';
import { AnimatorTransitionT } from '../src/format/generated/noa/ir/animator-transition.js';
import { AnimatorConditionT } from '../src/format/generated/noa/ir/animator-condition.js';
import { AnimatorConditionMode as CM } from '../src/format/generated/noa/ir/animator-condition-mode.js';
import { AnimationT } from '../src/format/generated/noa/ir/animation.js';
import { AnimationEventT } from '../src/format/generated/noa/ir/animation-event.js';
import { NodeT } from '../src/format/generated/noa/ir/node.js';
import { TransformT } from '../src/format/generated/noa/ir/transform.js';
import { Vec3T } from '../src/format/generated/noa/ir/vec3.js';
import { QuaternionT } from '../src/format/generated/noa/ir/quaternion.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { ComponentData as C } from '../src/format/generated/noa/ir/component-data.js';
import { TrackT } from '../src/format/generated/noa/ir/track.js';
import { TrackData as TD } from '../src/format/generated/noa/ir/track-data.js';
import { BindingT } from '../src/format/generated/noa/ir/binding.js';
import { AnimationProperty as P } from '../src/format/generated/noa/ir/animation-property.js';
import { Vector3TrackT } from '../src/format/generated/noa/ir/vector3-track.js';
import { FloatKeyT } from '../src/format/generated/noa/ir/float-key.js';
import { ScalarCurveT } from '../src/format/generated/noa/ir/scalar-curve.js';

const playbackPath = resolve(
  import.meta.dirname,
  '../../../data/unity-baselines/animator-playback/unity-2022.3.21f1.json',
);

function curve(a: number, b: number) {
  return Object.assign(new ScalarCurveT(), {
    keys: [
      Object.assign(new FloatKeyT(), { value: a, interpolation: 1, outSlope: b - a }),
      Object.assign(new FloatKeyT(), { time: 1, value: b, inSlope: b - a }),
    ],
  });
}
function fixture(configure: (a: AnimatorT, clips: AnimationT[]) => void = () => {}) {
  const d = minimalDocument();
  d.nodes.push(
    new NodeT(
      2,
      'target',
      1,
      true,
      new TransformT(new Vec3T(7, 11, 13), new QuaternionT(0, 0, 0, 1), new Vec3T(1, 1, 1)),
    ),
  );
  const clips = [1, 10, 20, 30].map(
    (start, i) =>
      new AnimationT(10 + i, String.fromCharCode(65 + i), 1, true, [
        new TrackT(
          new BindingT(null, 2, P.NodePosition),
          TD.Vector3Track,
          new Vector3TrackT(curve(start, start + 4), curve(0, 0), curve(0, 0)),
        ),
      ]),
  );
  const a = new AnimatorT();
  a.parameters = [
    new AnimatorParameterT('f', PT.Float, 1.25),
    new AnimatorParameterT('i', PT.Int, 0, 7),
    new AnimatorParameterT('go', PT.Bool),
    new AnimatorParameterT('trigger', PT.Trigger),
  ];
  a.layers = [
    new AnimatorLayerT(
      'Base',
      0,
      0,
      1,
      clips.map((clip, i) => new AnimatorStateT(i + 1, clip.name, clip.id, 1, 0, true)),
    ),
  ];
  configure(a, clips);
  d.animations = clips;
  d.components.push(new ComponentT(3, 1, true, C.Animator, a));
  const pack = new EffectPack(
    d,
    { format: 'noa-package', version: 1, noir_version: [1, 0], document: 'scene.noir', files: [] },
    new Map(),
    new Map(),
  );
  const scene = new Scene(pack, [1]),
    bindings = new AnimationBindings(pack, scene),
    events: string[] = [];
  const controller = new AnimatorController(
    a,
    new Map(clips.map((c) => [c.id, c])),
    bindings,
    (_c, e) => {
      events.push(String(e.name));
      return true;
    },
  );
  const node = scene.nodes.get(2)!;
  return { a, clips, pack, scene, controller, node, events };
}
function edge(destination = 2, conditions = [new AnimatorConditionT('go', CM.If)]) {
  const t = new AnimatorTransitionT();
  t.destinationStateId = destination;
  t.conditions = conditions;
  t.fixedDuration = true;
  return t;
}
function tick(c: AnimatorController, n = 1) {
  for (let i = 0; i < n; i++) {
    c.evaluate(1 / 60);
    c.apply();
  }
}

describe('typed Animator handles', () => {
  it('preserves defaults and rejects wrong names, types and nonrepresentable values', () => {
    const { controller: c } = fixture();
    const h = new NatsumeAnimator(c, () => {});
    expect(h.getFloat('f')).toBe(1.25);
    expect(h.getInt('i')).toBe(7);
    expect(h.getBool('go')).toBe(false);
    h.setFloat('f', 0.3);
    expect(h.getFloat('f')).toBe(Math.fround(0.3));
    h.setInt('i', -2147483648);
    h.setBool('go', true);
    h.setTrigger('trigger');
    h.resetTrigger('trigger');
    for (const fn of [
      () => h.setFloat('i', 1),
      () => h.getBool('unknown'),
      () => h.setFloat('f', Infinity),
      () => h.setFloat('f', 1e50),
      () => h.setInt('i', 1.2),
      () => h.setInt('i', 2147483648),
      () => h.setBool('go', 1 as unknown as boolean),
      () => h.setTrigger('go'),
      () => h.setVisible(1 as unknown as boolean),
    ])
      expect(fn).toThrow();
    c.reset();
    expect(h.getFloat('f')).toBe(1.25);
    expect(h.getInt('i')).toBe(7);
    expect(h.getBool('go')).toBe(false);
  });
  it('guards every handle operation after owner disposal', () => {
    const { controller: c } = fixture();
    let disposed = false;
    const h = new NatsumeAnimator(c, () => {
      if (disposed) throw Error('disposed');
    });
    disposed = true;
    for (const fn of [
      () => h.layerCount,
      () => h.getFloat('f'),
      () => h.setInt('i', 2),
      () => h.getCurrentState(),
      () => h.getNextState(),
      () => h.getTransition(),
      () => h.getLayerWeight(0),
      () => h.setLayerWeight(0, 0.5),
      () => h.setVisible(false),
      () => h.resetTrigger('trigger'),
    ])
      expect(fn).toThrow('disposed');
  });
});
it.each([
  [CM.Greater, 'f', 2],
  [CM.Less, 'f', 0],
  [CM.Equals, 'i', 7],
  [CM.NotEqual, 'i', 0],
  [CM.If, 'go', true],
  [CM.IfNot, 'go', false],
] as const)('selects typed condition %s', (mode, name, value) => {
  const { controller: c } = fixture((a) => {
    a.layers[0]!.states[0]!.transitions = [
      edge(2, [new AnimatorConditionT(name, mode, mode === CM.Equals ? 7 : 1)]),
    ];
  });
  if (name === 'f') c.parameters.setFloat(name, value as number);
  else if (name === 'i') c.parameters.setInt(name, value as number);
  else c.parameters.setBool(name, value as boolean);
  c.start();
  expect(c.getCurrentState()!.name).toBe('B');
});
it('requires every condition and consumes only selected trigger conditions', () => {
  const { controller: c } = fixture((a) => {
    a.layers[0]!.states[0]!.transitions = [
      edge(2, [new AnimatorConditionT('go', CM.If), new AnimatorConditionT('trigger', CM.If)]),
    ];
  });
  c.start();
  c.parameters.setTrigger('trigger');
  tick(c);
  expect(c.parameters.value('trigger')).toBe(true);
  expect(c.getCurrentState()!.name).toBe('A');
  c.parameters.setBool('go', true);
  tick(c);
  expect(c.parameters.value('trigger')).toBe(false);
  expect(c.getCurrentState()!.name).toBe('B');
});
it('retains immutable snapshots and validates layer/state controls', () => {
  const { controller: c, node } = fixture();
  c.start();
  c.apply();
  const s = c.getCurrentState()!;
  tick(c, 10);
  expect(s.normalizedTime).toBe(0);
  c.play('C');
  c.apply();
  expect(node.localPosition.x).toBe(20);
  expect(c.getLayerWeight(0)).toBe(1);
  for (const fn of [
    () => c.play('unknown'),
    () => c.play(1, 1),
    () => c.getCurrentState(-1),
    () => c.setLayerWeight(0, NaN),
    () => c.setLayerWeight(0, 1.1),
  ])
    expect(fn).toThrow();
});
it('holds outgoing pose at the start of a crossfade and advances the destination on the following frame', () => {
  const { controller: c, node } = fixture((a) => {
    const t = edge();
    t.duration = 0.1;
    a.layers[0]!.states[0]!.transitions = [t];
  });
  c.start();
  tick(c, 4);
  c.parameters.setBool('go', true);
  tick(c);
  expect(c.getNextState()!.normalizedTime).toBe(0);
  expect(c.getTransition()!.normalizedTime).toBe(0);
  expect(node.localPosition.x).toBeCloseTo(1 + 4 / 12);
  tick(c, 6);
  expect(c.getNextState()).toBeUndefined();
  expect(c.getCurrentState()!.name).toBe('B');
});
it.each([false, true])('mixes source layers with additive=%s', (additive) => {
  const {
    controller: c,
    a,
    node,
  } = fixture((a) => {
    a.layers.push(
      new AnimatorLayerT('Upper', 0.5, additive ? 1 : 0, 2, [
        new AnimatorStateT(2, 'B', 11, 1, 0, true),
      ]),
    );
  });
  c.start();
  tick(c, 30);
  expect(node.localPosition.x).toBeCloseTo(additive ? 4 : 7.5, 4);
  expect(c.getLayerWeight(0)).toBe(1);
  c.setLayerWeight(1, 0);
  tick(c);
  expect(node.localPosition.x).toBeCloseTo(1 + 31 / 15, 4);
  expect(a.layers[1]!.defaultWeight).toBe(0.5);
});
it('preserves empty controllers, layers and motions without creating a clip', () => {
  for (const kind of [0, 1, 2]) {
    const { controller: c, node } = fixture((a) => {
      if (kind === 0) a.layers = [];
      if (kind === 1) {
        a.layers[0]!.states = [];
        a.layers[0]!.defaultStateId = 0;
      }
      if (kind === 2) a.layers[0]!.states[0]!.animationId = 0;
    });
    c.start();
    tick(c, 60);
    expect(node.localPosition).toEqual({ x: 7, y: 11, z: 13 });
    if (kind === 0) expect(c.layerCount).toBe(0);
    else if (kind === 1) expect(c.getCurrentState()).toBeUndefined();
    if (kind === 2) {
      expect(c.getCurrentState()!.clipId).toBe(0);
      expect(c.getCurrentState()!.normalizedTime).toBeCloseTo(1, 5);
    }
  }
});
it.each([0, 1, 2])('honors explicit visibility for culling mode %s', (mode) => {
  const {
    controller: c,
    node,
    events,
  } = fixture((a, clips) => {
    a.cullingMode = mode;
    clips[0]!.events = [new AnimationEventT(0.1, 'hit')];
  });
  c.start();
  c.apply();
  c.setVisible(false);
  tick(c, 12);
  expect(node.localPosition.x).toBeCloseTo(mode === 0 ? 1.8 : 1, 5);
  expect(c.getCurrentState()!.normalizedTime).toBeCloseTo(mode === 2 ? 0 : 0.2, 5);
  expect(events).toEqual(mode === 2 ? [] : ['hit']);
  c.setVisible(true);
  tick(c);
  expect(node.localPosition.x).toBeGreaterThan(1);
});
it.each([0, 1, 2])('drives mode %s with the matching host clock', (mode) => {
  const { pack } = fixture((a) => {
    a.updateMode = mode;
  });
  const s = new Simulation(pack);
  s.play();
  const c = s.getAnimator(3);
  if (mode !== 0)
    expect(() => s.update(0.1)).toThrow(mode === 1 ? 'physicsSteps' : 'unscaledDeltaSeconds');
  const input = { unscaledDeltaSeconds: 0.2, physicsSteps: [0.02, 0.02, 0.02] };
  s.update(0.1, input);
  expect(c.getCurrentState()!.normalizedTime).toBeCloseTo(
    mode === 0 ? 0.1 : mode === 1 ? 0.06 : 0.2,
    5,
  );
  s.pause();
  s.update(1, input);
  expect(c.getCurrentState()!.normalizedTime).toBeCloseTo(
    mode === 0 ? 0.1 : mode === 1 ? 0.06 : 0.2,
    5,
  );
  s.play();
  s.update(0, { unscaledDeltaSeconds: 0.1, physicsSteps: [0.02] });
  expect(c.getCurrentState()!.normalizedTime).toBeCloseTo(
    mode === 0 ? 0.1 : mode === 1 ? 0.08 : 0.3,
    5,
  );
  s.restart();
  expect(c.getCurrentState()!.normalizedTime).toBe(0);
});
it('validates clocks before changing controller or particle time', () => {
  const { pack } = fixture((a) => {
    a.updateMode = 2;
  });
  const s = new Simulation(pack);
  s.play();
  for (const clocks of [
    { unscaledDeltaSeconds: -1 },
    { unscaledDeltaSeconds: NaN },
    { unscaledDeltaSeconds: 0.1, physicsSteps: [Infinity] },
  ]) {
    expect(() => s.update(0.1, clocks)).toThrow();
    expect(s.time).toBe(0);
    expect(s.getAnimator(3).getCurrentState()!.normalizedTime).toBe(0);
  }
});

it.skipIf(!existsSync(playbackPath))(
  'replays native player-loop clocks, visibility changes and event counts',
  () => {
    const native = JSON.parse(readFileSync(playbackPath, 'utf8')) as {
      clocks: { scaled: number; unscaled: number; physicsSteps: number; fixedDelta: number }[];
      cases: {
        mode: number;
        culling: number;
        label?: string;
        samples: { frame: number; time: number; x: number; visible: boolean; events: number }[];
      }[];
    };
    const results = [];
    for (const row of native.cases.filter((c) => !c.label)) {
      const {
        controller: c,
        node,
        events,
      } = fixture((a, clips) => {
        a.updateMode = row.mode;
        a.cullingMode = row.culling;
        clips[0]!.tracks[0]!.data = new Vector3TrackT(curve(0, 4), curve(0, 0), curve(0, 0));
        clips[0]!.events = Array.from(
          { length: 11 },
          (_, i) => new AnimationEventT(Math.fround(i / 10), String(i)),
        );
      });
      Object.assign(node.localPosition, { x: 0, y: 0, z: 0 });
      c.start();
      const first = row.samples[0]!;
      c.setVisible(first.visible);
      c.evaluate(first.time, false);
      c.apply();
      c.flushEvents();
      let time = 0,
        position = 0,
        eventCount = 0;
      const mismatches = [];
      for (const sample of row.samples) {
        const clock = native.clocks[sample.frame]!;
        c.setVisible(sample.visible);
        if (sample.frame > 0) {
          if (row.mode === 1) {
            for (let step = 0; step < clock.physicsSteps; step++) c.evaluate(clock.fixedDelta);
            if (clock.physicsSteps === 0) c.flushDeferredEvents();
          } else c.evaluate(row.mode === 2 ? clock.unscaled : clock.scaled);
          c.apply();
        }
        if (events.length !== sample.events)
          mismatches.push({
            frame: sample.frame,
            actual: events.length,
            expected: sample.events,
            time: c.getCurrentState()!.normalizedTime,
          });
        time = Math.max(time, Math.abs(c.getCurrentState()!.normalizedTime - sample.time));
        position = Math.max(position, Math.abs(node.localPosition.x - sample.x));
        eventCount = Math.max(eventCount, Math.abs(events.length - sample.events));
      }
      results.push({
        mode: row.mode,
        culling: row.culling,
        time,
        position,
        eventCount,
        mismatches,
      });
    }
    writeFileSync(
      playbackPath.replace('.json', '-comparison.json'),
      JSON.stringify(results, null, 2),
    );
    expect(results.filter((r) => r.time > 1e-5 || r.position > 1e-4 || r.eventCount > 0)).toEqual(
      [],
    );
  },
);

it.each([0, 1, 2, 3, 4].flatMap((mode) => [false, true].map((ordered) => ({ mode, ordered }))))(
  'resolves interruption queue $mode ordered=$ordered',
  ({ mode, ordered }) => {
    const { controller: c } = fixture((a) => {
      a.parameters.push(new AnimatorParameterT('other', PT.Bool));
      const t = edge();
      t.duration = 0.5;
      t.interruption = mode;
      t.orderedInterruption = ordered;
      a.layers[0]!.states[0]!.transitions = [t, edge(3, [new AnimatorConditionT('other', CM.If)])];
      a.layers[0]!.states[1]!.transitions = [edge(4, [new AnimatorConditionT('other', CM.If)])];
    });
    c.start();
    tick(c, 4);
    c.parameters.setBool('go', true);
    tick(c);
    c.parameters.setBool('go', false);
    tick(c, 6);
    c.parameters.setBool('other', true);
    tick(c);
    const blocked = mode === 0 || (ordered && (mode === 1 || mode === 3));
    expect(c.getCurrentState()!.name).toBe(blocked ? 'A' : mode === 1 || mode === 3 ? 'C' : 'D');
    expect(c.getNextState()?.name).toBe(blocked ? 'B' : undefined);
  },
);
it('routes top-level Exit through Entry while startup uses the default state', () => {
  const { controller: c } = fixture((a) => {
    const t = edge(0);
    t.isExit = true;
    a.layers[0]!.states[0]!.transitions = [t];
    a.layers[0]!.entryTransitions = [edge(2)];
  });
  c.start();
  expect(c.getCurrentState()!.name).toBe('A');
  c.parameters.setBool('go', true);
  tick(c);
  expect(c.getCurrentState()!.name).toBe('B');
  expect(c.getCurrentState()!.normalizedTime).toBe(0);
});
it.each([false, true])('honors AnyState self-transition flag %s', (self) => {
  const { controller: c } = fixture((a) => {
    const t = edge(3);
    t.canTransitionToSelf = self;
    a.layers[0]!.anyStateTransitions = [t];
  });
  c.start();
  c.parameters.setBool('go', true);
  tick(c, 3);
  expect(c.getCurrentState()!.name).toBe('C');
  expect(c.getCurrentState()!.normalizedTime).toBeCloseTo(self ? 0 : 2 / 60, 6);
});
it.each([false, true])('filters solo transitions after mute=%s', (mute) => {
  const { controller: c } = fixture((a) => {
    const later = edge(3);
    later.solo = true;
    later.mute = mute;
    a.layers[0]!.states[0]!.transitions = [edge(), later];
  });
  c.start();
  c.parameters.setBool('go', true);
  tick(c);
  expect(c.getCurrentState()!.name).toBe(mute ? 'B' : 'C');
});
it.each([false, true])('rechecks recurring Exit Time after late conditions, loop=%s', (loop) => {
  const { controller: c } = fixture((a, clips) => {
    clips[0]!.loop = loop;
    const t = edge();
    t.hasExitTime = true;
    t.exitTime = 0.25;
    a.layers[0]!.states[0]!.transitions = [t];
  });
  c.start();
  tick(c, 25);
  c.parameters.setBool('go', true);
  tick(c, 50);
  expect(c.getCurrentState()!.name).toBe('A');
  tick(c);
  expect(c.getCurrentState()!.name).toBe('B');
  expect(c.getCurrentState()!.normalizedTime).toBeCloseTo(1 / 60, 5);
});
it.each([false, true])(
  'retains or restores absent properties on automatic transitions, defaults=%s',
  (defaults) => {
    const { controller: c, node } = fixture((a, clips) => {
      clips[1]!.tracks[0]!.binding!.property = P.NodeScale;
      a.layers[0]!.states[1]!.writeDefaultValues = defaults;
      a.layers[0]!.states[0]!.transitions = [edge()];
    });
    c.start();
    tick(c, 4);
    c.parameters.setBool('go', true);
    tick(c, 2);
    expect(node.localPosition.x).toBeCloseTo(defaults ? 7 : 1 + (4 * 4) / 60, 6);
  },
);
it.each([false, true])(
  'weights properties absent from the lower layer, additive=%s',
  (additive) => {
    const { controller: c, node } = fixture((a, clips) => {
      clips[0]!.tracks[0]!.binding!.property = P.NodeScale;
      a.layers.push(
        new AnimatorLayerT('Upper', 0.5, additive ? 1 : 0, 2, [
          new AnimatorStateT(2, 'B', 11, 1, 0, true),
        ]),
      );
    });
    c.start();
    tick(c, 30);
    expect(node.localPosition.x).toBeCloseTo(additive ? 8 : 9.5, 5);
  },
);
it('orders Normal and UnscaledTime event batches by Animator registration within a shared evaluation', () => {
  const { pack: original } = fixture((_a, clips) => {
    clips[0]!.events = [new AnimationEventT(0.01, 'hit')];
  });
  const d = structuredClone(
    original.document,
  ) as import('../src/format/generated/noa/ir/document.js').DocumentT;
  const other = structuredClone(d.components[0]!.data) as AnimatorT;
  other.updateMode = 2;
  d.components.push(new ComponentT(4, 1, true, C.Animator, other));
  const pack = new EffectPack(d, original.manifest, new Map(), new Map());
  const s = new Simulation(pack);
  const ids: number[] = [];
  s.onAnimationEvent = (e) => {
    ids.push(e.animatorId);
  };
  s.play();
  s.update(1 / 60, { unscaledDeltaSeconds: 0.1 });
  expect(ids).toEqual([3, 4]);
});

it.each([false, true].flatMap((parameter) => [false, true].map((loop) => ({ parameter, loop }))))(
  'distinguishes reverse state speed from reverse parameter clocks, parameter=$parameter loop=$loop',
  ({ parameter, loop }) => {
    const { controller: c } = fixture((a, clips) => {
      clips[0]!.loop = loop;
      const state = a.layers[0]!.states[0]!;
      if (parameter) {
        state.speedParameter = 'f';
        a.parameters.find((p) => p.name === 'f')!.defaultFloat = -1;
      } else state.speed = -1;
      const transition = edge(2, []);
      transition.hasExitTime = true;
      transition.exitTime = 0.25;
      state.transitions = [transition];
    });
    c.start();
    tick(c, 96);
    expect(c.getCurrentState()!.name).toBe(parameter ? 'A' : 'B');
    expect(c.getCurrentState()!.normalizedTime).toBeCloseTo(parameter ? -1.6 : 1.35, 5);
  },
);

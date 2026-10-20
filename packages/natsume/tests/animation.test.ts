import { expect, it } from 'vitest';
import { Simulation } from '../src/runtime/simulation.js';
import { AnimationClock, sampleBool, animationSupport } from '../src/runtime/animation.js';
import { loadPack } from '../src/loader/load.js';
import { validateDocument } from '../src/format/semantics.js';
import { archive, encode, minimalDocument } from './helpers.js';
import { AnimationT } from '../src/format/generated/noa/ir/animation.js';
import { AnimatorT } from '../src/format/generated/noa/ir/animator.js';
import { AnimatorLayerT } from '../src/format/generated/noa/ir/animator-layer.js';
import { AnimatorStateT } from '../src/format/generated/noa/ir/animator-state.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { ComponentData } from '../src/format/generated/noa/ir/component-data.js';
import { NodeT } from '../src/format/generated/noa/ir/node.js';
import { TrackT } from '../src/format/generated/noa/ir/track.js';
import { BindingT } from '../src/format/generated/noa/ir/binding.js';
import { AnimationProperty } from '../src/format/generated/noa/ir/animation-property.js';
import { TrackData } from '../src/format/generated/noa/ir/track-data.js';
import { BoolTrackT } from '../src/format/generated/noa/ir/bool-track.js';
import { BoolKeyT } from '../src/format/generated/noa/ir/bool-key.js';
import { ActionT } from '../src/format/generated/noa/ir/action.js';
import { ActionKind } from '../src/format/generated/noa/ir/action-kind.js';
import { FloatTrackT } from '../src/format/generated/noa/ir/float-track.js';
import { ScalarCurveT } from '../src/format/generated/noa/ir/scalar-curve.js';
import { FloatKeyT } from '../src/format/generated/noa/ir/float-key.js';
import { CurveDomain } from '../src/format/generated/noa/ir/curve-domain.js';

function document() {
  const d = minimalDocument();
  d.nodes.push(new NodeT(3, 'target', 1, true, d.nodes[0]!.transform));
  d.animations = [
    new AnimationT(6, 'active', 1, false, [
      new TrackT(
        new BindingT(3, AnimationProperty.NodeActive),
        TrackData.BoolTrack,
        new BoolTrackT([
          new BoolKeyT(0, true),
          new BoolKeyT(0.05, false),
          new BoolKeyT(0.1, true),
          new BoolKeyT(0.2, false),
        ]),
      ),
    ]),
  ];
  d.components = [
    new ComponentT(
      4,
      1,
      true,
      ComponentData.Animator,
      new AnimatorT(false, false, [
        new AnimatorLayerT('Base', 1, 5, [new AnimatorStateT(5, 'default', 6, 1, 0, true)]),
      ]),
    ),
  ];
  return d;
}
async function create(d = document()) {
  return new Simulation(await loadPack(await archive(encode(d))), { seed: 123 });
}
const active = (s: Simulation) => s.scene.nodes.get(3)!.active;
const step = (s: Simulation, n: number) => {
  for (let i = 0; i < n; i++) s.update(1 / 60);
};

it('samples stepped keys inclusively and preserves a baseline before the first key', () => {
  const keys = [new BoolKeyT(0.25, false), new BoolKeyT(0.5, true)];
  expect(sampleBool(keys, 0)).toBeUndefined();
  expect(sampleBool(keys, 0.25)).toBe(false);
  expect(sampleBool(keys, 0.5)).toBe(true);
  expect(sampleBool(keys, 10)).toBe(true);
});
it('samples every executed fixed step and overwrites an immediate host edit on the next step', async () => {
  const a = await create(),
    b = new Simulation(a.pack);
  a.play();
  b.play();
  a.update(3 / 60);
  step(b, 3);
  expect(active(a)).toBe(false);
  expect(active(b)).toBe(false);
  a.setNodeActive(3, true);
  expect(active(a)).toBe(true);
  a.update(0);
  expect(active(a)).toBe(true);
  step(a, 1);
  expect(active(a)).toBe(false);
  step(a, 3);
  expect(active(a)).toBe(true);
});
it('freezes while paused and draining and restores the initial playback head on restart', async () => {
  const s = await create();
  s.play();
  step(s, 4);
  expect(active(s)).toBe(false);
  s.pause();
  s.update(1);
  expect(active(s)).toBe(false);
  s.play();
  step(s, 3);
  expect(active(s)).toBe(true);
  s.stop();
  s.update(1);
  expect(active(s)).toBe(true);
  s.restart();
  expect(active(s)).toBe(true);
  step(s, 4);
  expect(active(s)).toBe(false);
});
it('keeps animation on the simulation clock when overload time is discarded', async () => {
  const a = await create(),
    b = new Simulation(a.pack);
  a.play();
  b.play();
  a.update(10);
  step(b, 8);
  expect(a.time).toBe(b.time);
  expect(active(a)).toBe(active(b));
  expect(a.droppedSeconds).toBeGreaterThan(9.8);
  step(a, 5);
  step(b, 5);
  expect(active(a)).toBe(active(b));
});
it('separates one-shot ApplyClip from continuing PlayClip', async () => {
  for (const kind of [ActionKind.ApplyClip, ActionKind.PlayClip]) {
    const d = document();
    d.components = [];
    d.entries[0]!.actions = [new ActionT(kind, 0, 6)];
    const s = await create(d);
    s.play();
    step(s, 4);
    expect(active(s)).toBe(kind === ActionKind.ApplyClip);
  }
});
it('applies zero-duration initialization once without a repeating player', async () => {
  const d = document();
  d.animations[0]!.durationSeconds = 0;
  d.animations[0]!.loop = true;
  const s = await create(d);
  s.play();
  s.setNodeActive(3, false);
  step(s, 8);
  expect(active(s)).toBe(false);
  s.restart();
  expect(active(s)).toBe(true);
});
it('honors state speed and looping cycle offset while preserving shared package state', async () => {
  const d = document();
  d.animations[0]!.loop = true;
  const state = (d.components[0]!.data as AnimatorT).layers[0]!.states[0]!;
  state.speed = 0;
  state.cycleOffset = 0.25;
  const a = await create(d),
    b = new Simulation(a.pack);
  a.play();
  b.play();
  expect(active(a)).toBe(false);
  step(a, 90);
  expect(active(a)).toBe(false);
  a.setNodeActive(3, true);
  expect(active(b)).toBe(false);
  expect(a.pack.document.nodes[1]!.active).toBe(true);
  a.applyAnimatorState(4, 'default');
  expect(active(a)).toBe(false);
});
it('clamps non-looping clips at the last frame and ignores looping-only offset', () => {
  const c = new AnimationClock(2, false, 2, 0.5);
  expect(c.seconds).toBe(0);
  c.advance(0.5);
  expect(c.seconds).toBe(1);
  c.advance(10);
  expect(c.seconds).toBe(2);
});
it('continues to reject unimplemented tracks and events in the shared capability rules', () => {
  const a = document().animations[0]!;
  a.tracks[0]!.dataType = TrackData.Vector3Track;
  expect(animationSupport(a)[0]!.field).toContain('tracks.0');
});
it('rejects negative bool times and normalized animation curves', () => {
  const d = document();
  (d.animations[0]!.tracks[0]!.data as BoolTrackT).keys[0]!.time = -1;
  expect(() => validateDocument(d)).toThrow(/key time/);
  const c = new ScalarCurveT();
  c.domain = CurveDomain.Normalized;
  c.keys = [new FloatKeyT()];
  d.animations[0]!.tracks = [
    new TrackT(
      new BindingT(3, AnimationProperty.NodePosition),
      TrackData.FloatTrack,
      new FloatTrackT(c),
    ),
  ];
  expect(() => validateDocument(d)).toThrow(/Seconds/);
});

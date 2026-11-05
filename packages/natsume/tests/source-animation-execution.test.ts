import { expect, it } from 'vitest';
import * as I from '../src/format/generated/noa/ir.js';
import { EffectPack } from '../src/pack.js';
import { Scene } from '../src/runtime/scene.js';
import { AnimationBindings, bindingWrites } from '../src/runtime/animation-bindings.js';
import { animationSupport } from '../src/runtime/animation.js';
import { minimalDocument } from './helpers.js';
import { constant, particleSource } from './particle-fixtures.js';

function track(classId: number, field: string, value: number, target = 1): I.TrackT {
  const source = new I.UnityAnimationBindingT(1, 1n, '', classId, field);
  const curve = new I.ScalarCurveT();
  curve.keys = [Object.assign(new I.FloatKeyT(), { value })];
  return new I.TrackT(
    new I.BindingT(source, target, I.AnimationProperty.SourceBinding),
    I.TrackData.FloatTrack,
    new I.FloatTrackT(curve),
  );
}
function fixture(tracks: I.TrackT[], components: I.ComponentT[] = []) {
  const d = minimalDocument();
  d.components.push(...components);
  d.animations = [new I.AnimationT(20, 'source', 1, false, tracks)];
  const pack = new EffectPack(
    d,
    { format: 'noa-package', version: 1, noir_version: [1, 0], document: 'scene.noir', files: [] },
    new Map(),
    new Map(),
  );
  const scene = new Scene(pack, [1]);
  return { pack, scene, bindings: new AnimationBindings(pack, scene) };
}

it.each([-1, 0.01, 1.2, 0])('applies native GameObject active semantics for %s', (value) => {
  const t = track(1, 'm_IsActive', value);
  const { pack, scene, bindings } = fixture([t]);
  bindings.compile(t)!.sample(0);
  expect(scene.nodes.get(1)!.active).toBe(value !== 0);
  expect(pack.getNode(1)!.active).toBe(true);
  expect(animationSupport(pack.document.animations[0]!, pack)).toEqual([]);
});

it('writes the burst scalar without changing its mode or another instance', () => {
  const t = track(198, 'EmissionModule.m_Bursts.Array.data[0].countCurve.scalar', 7, 4);
  const ps = particleSource();
  const count = constant(2);
  const emission = new I.EmissionModuleT();
  emission.bursts = [new I.BurstT(0, count)];
  ps.modules.push(new I.ParticleModuleT(I.ParticleModuleData.EmissionModule, emission));
  const { pack, bindings } = fixture(
    [t],
    [new I.ComponentT(4, 1, true, I.ComponentData.ParticleSystem, ps)],
  );
  const other = new AnimationBindings(pack, new Scene(pack, [1]));
  const binding = bindings.compile(t)!;
  binding.sample(0);
  expect(binding.read()).toEqual([7]);
  expect(other.compile(t)!.read()).toEqual([2]);
  expect(count.constantMax).toBe(2);
  bindings.reset();
  expect(binding.read()).toEqual([2]);
});

it('uses the same write identity for source and canonical active tracks', () => {
  const t = track(1, 'm_IsActive', 0);
  const { pack } = fixture([t]);
  const canonical = new I.TrackT(
    new I.BindingT(null, 1, I.AnimationProperty.NodeActive),
    I.TrackData.BoolTrack,
    new I.BoolTrackT(),
  );
  expect(bindingWrites(pack, t)).toEqual(bindingWrites(pack, canonical));
});

it('ignores a missing target and preserves a warning instead of writing target zero', () => {
  const t = track(1, 'm_IsActive', 0, 0);
  t.binding!.source!.path = 'missing';
  const { pack, bindings, scene } = fixture([t]);
  expect(bindings.compile(t)).toBeUndefined();
  expect(scene.nodes.get(1)!.active).toBe(true);
  expect(animationSupport(pack.document.animations[0]!, pack)).toMatchObject([
    { severity: 'warning', code: 'SOURCE_ANIMATION_UNBOUND' },
  ]);
});

import { expect, it } from 'vitest';
import * as I from '../src/format/generated/noa/ir.js';
import { loadPack } from '../src/loader/load.js';
import { Emitter } from '../src/runtime/emitter.js';
import { Scene } from '../src/runtime/scene.js';
import { SubEmitterGraph } from '../src/runtime/sub-emitters.js';
import type { ParticleCollider, ParticleTriggerEvent } from '../src/runtime/particle-physics.js';
import { archive } from './helpers.js';
import { constant, manualParticle, particleSource } from './particle-fixtures.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';
type V = { x: number; y: number; z: number };
interface NativeCase {
  action: number;
  query: number;
  radius: number;
  offset: number;
  overlap: boolean;
  start: V;
  speed: number;
  samples: { frame: number; count: number; children: number; position: V }[];
  events: { frame: number; type: number; count: number; position: V; colliders: string[] }[];
}
const native = JSON.parse(readNativeFixture('unity-particle-trigger-playback.json')) as {
  cases: NativeCase[];
};
const ref = (slot: string | null) =>
  new I.EnvironmentReferenceT(I.EnvironmentKind.Collider3D, null, null, slot);
const sphere = (id: string, x: number): ParticleCollider => ({
  id,
  layer: 0,
  overlapSphere: (q) =>
    Math.hypot(q.position[0]! - x, q.position[1]!, q.position[2]!) <= 1 + q.radius,
  sweepSphere: (q) => {
    const dx = q.displacement[0]!,
      dy = q.displacement[1]!,
      dz = q.displacement[2]!;
    const length = dx * dx + dy * dy + dz * dz;
    const t = length
      ? Math.max(
          0,
          Math.min(
            1,
            ((x - q.position[0]!) * dx - q.position[1]! * dy - q.position[2]! * dz) / length,
          ),
        )
      : 0;
    return (
      Math.hypot(q.position[0]! + dx * t - x, q.position[1]! + dy * t, q.position[2]! + dz * t) <=
      1 + q.radius
    );
  },
});

it('matches native Trigger boundaries, kill counts, query modes and automatic sub-emitters', async () => {
  const pack = await loadPack(await archive());
  let maxPosition = 0;
  try {
    for (const row of native.cases) {
      const source = particleSource(),
        child = particleSource();
      source.main!.space = I.Space.World;
      source.main!.lifetime = constant(4);
      const d = new I.TriggerModuleT(
        row.action === 1 ? 1 : 2,
        row.action === 2 ? 1 : 2,
        row.action === 3 ? 1 : 2,
        row.action === 4 ? 1 : 2,
        row.query,
        row.radius,
        [ref(null), ref('a'), ref(row.overlap ? 'b' : null), ref(row.overlap ? 'a' : null)],
      );
      if (row.action === 5) d.inside = d.outside = d.enter = d.exit = I.OverlapAction.Ignore;
      source.modules.push(
        new I.ParticleModuleT(I.ParticleModuleData.TriggerModule, d),
        new I.ParticleModuleT(
          I.ParticleModuleData.SubEmittersModule,
          new I.SubEmittersModuleT([new I.SubEmitterT(6, I.SubEmitterEvent.Trigger)]),
        ),
      );
      child.main!.playOnEnable = false;
      child.main!.lifetime = constant(4);
      child.modules.push(
        new I.ParticleModuleT(
          I.ParticleModuleData.EmissionModule,
          new I.EmissionModuleT(constant(0), constant(0), [new I.BurstT(0, constant(1))], false),
        ),
      );
      const node = new Scene(pack, [1]).nodes.get(1)!;
      const a = new Emitter(5, node, source, true, 1, [], undefined, undefined, undefined, {
        fog: { mode: 'none' },
        colliders: {
          a: sphere('A', row.offset),
          b: sphere('B', Math.fround(row.offset + Math.fround(0.8))),
        },
      });
      const b = new Emitter(6, node, child, true, 1, []),
        graph = new SubEmitterGraph(
          new Map([
            [5, a],
            [6, b],
          ]),
        );
      let events: ParticleTriggerEvent[] = [];
      a.onTriggerMessage = (event) => events.push(event);
      manualParticle(a);
      b.sync();
      a.positions.set([row.start.x, row.start.y, row.start.z]);
      a.velocities.set([row.speed, 0, 0]);
      a.startSizes.fill(Math.fround(0.2));
      a.lifetimes[0] = 4;
      for (const sample of row.samples) {
        events = [];
        graph.step(Math.fround(0.02));
        const label = JSON.stringify({
          action: row.action,
          query: row.query,
          radius: row.radius,
          overlap: row.overlap,
          frame: sample.frame,
        });
        expect(a.count, label).toBe(sample.count);
        expect(b.count, label).toBe(sample.children);
        const expected = row.events.filter((event) => event.frame === sample.frame);
        expect(
          events.map((event) => ['inside', 'outside', 'enter', 'exit'].indexOf(event.kind)),
          label,
        ).toEqual(expected.map((event) => event.type));
        for (let i = 0; i < events.length; i++)
          expect(
            events[i]!.colliders.map((c) => c.colliderId),
            label,
          ).toEqual(expected[i]!.colliders);
        if (a.count)
          maxPosition = Math.max(
            maxPosition,
            Math.abs(a.positions[0]! - row.offset - sample.position.x),
          );
      }
    }
    recordError('trigger-position', maxPosition, 'scene-unit', `${native.cases.length} cases`);
    expect(maxPosition).toBeLessThan(0.001);
  } finally {
    pack.dispose();
  }
});

it('requires referenced collider slots and preserves membership through compaction and reset', async () => {
  const pack = await loadPack(await archive());
  try {
    const source = particleSource();
    source.main!.space = I.Space.World;
    const d = new I.TriggerModuleT(2, 2, 2, 2, 2, 1, [ref(null), ref('sphere')]);
    source.modules.push(new I.ParticleModuleT(I.ParticleModuleData.TriggerModule, d));
    const node = new Scene(pack, [1]).nodes.get(1)!;
    expect(() => new Emitter(5, node, source, true, 1, [])).toThrow(/collider/);
    const e = new Emitter(5, node, source, true, 1, [], undefined, undefined, undefined, {
      fog: { mode: 'none' },
      colliders: { sphere: sphere('sphere', 0) },
    });
    manualParticle(e);
    e.count = 2;
    e.serials.set([10, 20]);
    e.positions.set([0, 0, 0, 0, 0, 0]);
    e.velocities.fill(0);
    e.lifetimes.set([0.01, 2]);
    e.ages.fill(0);
    const events: ParticleTriggerEvent[] = [];
    e.onTriggerMessage = (event) => events.push(event);
    e.step(0.02);
    expect(e.count).toBe(1);
    expect(events.map((e) => e.kind)).toEqual(['inside', 'enter']);
    expect(events[0]!.particleId).toBe(20);
    events.length = 0;
    e.step(0.02);
    expect(events.map((e) => e.kind)).toEqual(['inside']);
    e.clear();
    manualParticle(e);
    e.serials[0] = 20;
    e.positions.fill(0);
    e.velocities.fill(0);
    events.length = 0;
    e.step(0.02);
    expect(events.map((e) => e.kind)).toEqual(['inside', 'enter']);
    expect(() => e.resolveEnvironment({ fog: { mode: 'none' } })).toThrow(/sphere/);
  } finally {
    pack.dispose();
  }
});

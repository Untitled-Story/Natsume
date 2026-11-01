import { expect, it } from 'vitest';
import * as I from '../src/format/generated/noa/ir.js';
import { copyEnvironment } from '../src/rendering/particle-environment.js';
import {
  selectForceFields,
  type ParticleForceField,
} from '../src/runtime/particle-force-fields.js';
import { Emitter } from '../src/runtime/emitter.js';
import { Scene } from '../src/runtime/scene.js';
import { loadPack } from '../src/loader/load.js';
import { archive } from './helpers.js';
import { constant, linear, manualParticle, particleSource } from './particle-fixtures.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';

const field = (layer: number, x: number, y = 0): ParticleForceField => ({
  layer,
  sample(_query, out) {
    out[0] = x;
    out[1] = y;
  },
});
const reference = (slot: string | null) =>
  new I.EnvironmentReferenceT(I.EnvironmentKind.ForceField, null, null, slot);

it('unions mask and list selections, deduplicates identity and ignores inactive references', () => {
  const a = field(8, 2),
    b = field(9, 0, 3);
  const m = new I.ExternalForcesModuleT(
    constant(1),
    I.InfluenceFilter.LayerMask,
    1 << 8,
    [reference('missing')],
    'world',
  );
  expect(selectForceFields(m, { world: [a, b] })).toEqual([a]);
  m.filter = I.InfluenceFilter.List;
  m.influences = [reference(null), reference('b'), reference('b')];
  expect(selectForceFields(m, { b })).toEqual([b]);
  m.filter = I.InfluenceFilter.LayerMaskAndList;
  expect(selectForceFields(m, { world: [a, b], b })).toEqual([a, b]);
  expect(() => selectForceFields(m, { world: [] })).toThrow(/slot b/);
});

it('copies slot lists while preserving borrowed field identity and mutable enabled state', () => {
  const a = field(31, 2),
    list = [a];
  const env = copyEnvironment({ fog: { mode: 'none' }, forceFields: { world: list, a } })!;
  list.length = 0;
  expect(env.forceFields!.world).toEqual([a]);
  expect(env.forceFields!.a).toBe(a);
  expect(() =>
    copyEnvironment({ fog: { mode: 'none' }, forceFields: { bad: field(32, 1) } }),
  ).toThrow(/force field/);
});

interface NativeCase {
  filter: number;
  mask: number;
  list: number;
  disabled: number;
  local: boolean;
  curve: boolean;
  dt: number;
  multiplier: number;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

const native = JSON.parse(readNativeFixture('unity-external-forces.json')) as {
  cases: NativeCase[];
};
it('matches native force-field filters, local frames and age multipliers', async () => {
  const data = native;
  const pack = await loadPack(await archive());
  let maxPosition = 0,
    maxVelocity = 0;
  try {
    for (const c of data.cases) {
      const source = particleSource();
      source.main!.space = c.local ? I.Space.Local : I.Space.World;
      source.main!.lifetime = constant(4);
      const fields = [field(8, 2), field(9, 0, 3)].map((f, i) => ({
        ...f,
        enabled: !(c.disabled && i === 0),
      }));
      source.modules.push(
        new I.ParticleModuleT(
          I.ParticleModuleData.ExternalForcesModule,
          new I.ExternalForcesModuleT(
            c.curve ? linear(0.5, 2.5) : constant(c.multiplier),
            c.filter,
            (c.mask & 1 ? 1 << 8 : 0) | (c.mask & 2 ? 1 << 9 : 0),
            fields.flatMap((_, i) => (c.list & (1 << i) ? [reference(String(i))] : [])),
            'world',
          ),
        ),
      );
      const scene = new Scene(pack, [1]);
      const node = scene.nodes.get(1)!;
      if (c.local) {
        node.localRotation.z = Math.SQRT1_2;
        node.localRotation.w = Math.SQRT1_2;
        node.transformDirty = true;
        scene.update();
      }
      const e = new Emitter(
        5,
        node,
        source,
        true,
        1,
        [],
        undefined,
        undefined,
        undefined,
        copyEnvironment({
          fog: { mode: 'none' },
          forceFields: { world: fields, '0': fields[0]!, '1': fields[1]! },
        }),
      );
      manualParticle(e);
      e.positions.fill(0);
      e.velocities.fill(0);
      e.lifetimes[0] = 4;
      e.ages[0] = 1;
      e.step(c.dt);
      for (const [axis, key] of ['x', 'y', 'z'].entries()) {
        maxPosition = Math.max(maxPosition, Math.abs(e.positions[axis]! - c.position[key as 'x']));
        maxVelocity = Math.max(maxVelocity, Math.abs(e.velocities[axis]! - c.velocity[key as 'x']));
      }
    }
    expect(maxPosition).toBeLessThan(2e-6);
    expect(maxVelocity).toBeLessThan(2e-6);
    recordError('external-force-position', maxPosition, 'scene-unit', `${data.cases.length} cases`);
    recordError(
      'external-force-velocity',
      maxVelocity,
      'scene-unit/s',
      `${data.cases.length} cases`,
    );
  } finally {
    pack.dispose();
  }
});

it('passes world inputs and stable identities, clears output and rejects invalid acceleration', async () => {
  const pack = await loadPack(await archive());
  try {
    let calls = 0;
    const host: ParticleForceField = {
      layer: 0,
      sample(q, out) {
        expect(q.systemId).toBe(17);
        expect(q.deltaSeconds).toBeCloseTo(0.02);
        expect([...q.position]).toEqual([1, 2, 3]);
        expect([...q.velocity]).toEqual([0, 0, 0]);
        expect([...out]).toEqual([0, 0, 0]);
        calls++;
        out[0] = NaN;
      },
    };
    const source = particleSource();
    source.main!.space = I.Space.World;
    source.modules.push(
      new I.ParticleModuleT(
        I.ParticleModuleData.ExternalForcesModule,
        new I.ExternalForcesModuleT(constant(1), I.InfluenceFilter.List, 0, [reference('field')]),
      ),
    );
    const node = new Scene(pack, [1]).nodes.get(1)!;
    const e = new Emitter(17, node, source, true, 1, [], undefined, undefined, undefined, {
      fog: { mode: 'none' },
      forceFields: { field: host },
    });
    manualParticle(e);
    e.positions.set([1, 2, 3]);
    e.velocities.fill(0);
    expect(() => e.step(0.02)).toThrow(/non-finite acceleration/);
    expect(calls).toBe(1);
    expect(() => e.resolveEnvironment({ fog: { mode: 'none' } })).toThrow(/slot field/);
  } finally {
    pack.dispose();
  }
});

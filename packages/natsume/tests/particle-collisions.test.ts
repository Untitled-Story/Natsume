import { expect, it } from 'vitest';
import * as I from '../src/format/generated/noa/ir.js';
import { loadPack } from '../src/loader/load.js';
import { Scene } from '../src/runtime/scene.js';
import { Emitter } from '../src/runtime/emitter.js';
import type { ParticlePhysicsWorld, ParticleCollider } from '../src/runtime/particle-physics.js';
import { archive } from './helpers.js';
import { constant, particleSource, manualParticle } from './particle-fixtures.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';
import { SubEmitterGraph } from '../src/runtime/sub-emitters.js';

type V = { x: number; y: number; z: number };
interface NativeCase {
  dampen: number;
  bounce: number;
  loss: number;
  radius: number;
  size: number;
  dt: number;
  world: boolean;
  start: V;
  inputVelocity: V;
  position: V;
  velocity: V;
  count: number;
  remaining: number;
}
const native = JSON.parse(readNativeFixture('unity-particle-collisions.json')) as {
  cases: NativeCase[];
};
interface ForceCase {
  switches: number;
  speed: number;
  size: number;
  force: number;
  dt: number;
  mass: number;
  velocity: V;
}
const forceNative = JSON.parse(readNativeFixture('unity-particle-collider-force.json')) as {
  cases: ForceCase[];
};
const planeCollider: ParticleCollider = { id: 'plane', layer: 0, overlapSphere: () => false };
const planeWorld: ParticlePhysicsWorld = {
  sweepSphere(q, hits) {
    const dy = q.displacement[1]!;
    if (dy >= 0 || q.position[1]! + dy >= q.radius) return;
    const fraction = Math.max(0, (q.radius - q.position[1]!) / dy);
    hits.push({
      collider: planeCollider,
      fraction,
      point: [
        q.position[0]! + q.displacement[0]! * fraction,
        0,
        q.position[2]! + q.displacement[2]! * fraction,
      ],
      normal: [0, 1, 0],
    });
  },
};

for (const world of [false, true])
  it(`matches native ${world ? 'world' : 'plane'} bounce, damping, penetration and lifetime loss`, async () => {
    const pack = await loadPack(await archive());
    let maxPosition = 0,
      maxVelocity = 0,
      maxLifetime = 0;
    try {
      for (const c of native.cases.filter((c) => c.world === world)) {
        const source = particleSource();
        source.main!.space = I.Space.World;
        const collision = new I.CollisionModuleT();
        collision.planes = [0, 1];
        collision.type = world ? I.CollisionType.World : I.CollisionType.Planes;
        collision.hostPhysicsSlot = 'physics';
        collision.dampen = constant(c.dampen);
        collision.bounce = constant(c.bounce);
        collision.lifetimeLoss = constant(c.loss);
        collision.radiusScale = c.radius;
        collision.maxKillSpeed = 10000;
        source.modules.push(new I.ParticleModuleT(I.ParticleModuleData.CollisionModule, collision));
        const scene = new Scene(pack, [1]);
        const e = new Emitter(
          5,
          scene.nodes.get(1)!,
          source,
          true,
          1,
          [],
          undefined,
          undefined,
          undefined,
          world ? { fog: { mode: 'none' }, physicsWorlds: { physics: planeWorld } } : undefined,
          scene.nodes,
        );
        manualParticle(e);
        e.positions.set([c.start.x, c.start.y, c.start.z]);
        e.velocities.set([c.inputVelocity.x, c.inputVelocity.y, c.inputVelocity.z]);
        e.startSizes.fill(c.size);
        e.lifetimes[0] = 4;
        e.ages[0] = 1;
        e.step(c.dt);
        expect(e.count).toBe(c.count);
        for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
          maxPosition = Math.max(maxPosition, Math.abs(e.positions[axis]! - c.position[key]));
          maxVelocity = Math.max(maxVelocity, Math.abs(e.velocities[axis]! - c.velocity[key]));
        }
        maxLifetime = Math.max(
          maxLifetime,
          Math.abs(Math.max(0, e.lifetimes[0]! - e.ages[0]!) - c.remaining),
        );
      }
      recordError(
        `${world ? 'world' : 'plane'}-collision-position`,
        maxPosition,
        'scene-unit',
        '81 cases',
      );
      recordError(
        `${world ? 'world' : 'plane'}-collision-velocity`,
        maxVelocity,
        'scene-unit/s',
        '81 cases',
      );
      recordError(`${world ? 'world' : 'plane'}-collision-lifetime`, maxLifetime, 's', '81 cases');
      expect(maxPosition).toBeLessThan(world ? 0.001 : 2.1e-5);
      expect(maxVelocity).toBeLessThan(2e-6);
      expect(maxLifetime).toBeLessThan(1e-6);
    } finally {
      pack.dispose();
    }
  });

it('uses host sweep contacts, filters layers and rejects invalid hits', async () => {
  const pack = await loadPack(await archive());
  try {
    const source = particleSource();
    source.main!.space = I.Space.World;
    const c = new I.CollisionModuleT();
    c.type = I.CollisionType.World;
    c.hostPhysicsSlot = 'physics';
    c.dampen = constant(0);
    c.bounce = constant(1);
    c.lifetimeLoss = constant(0);
    c.maxKillSpeed = 10000;
    c.radiusScale = 0.5;
    source.modules.push(new I.ParticleModuleT(I.ParticleModuleData.CollisionModule, c));
    const scene = new Scene(pack, [1]);
    expect(() => new Emitter(5, scene.nodes.get(1)!, source, true, 1, [])).toThrow(/physics world/);
    const e = new Emitter(
      5,
      scene.nodes.get(1)!,
      source,
      true,
      1,
      [],
      undefined,
      undefined,
      undefined,
      { fog: { mode: 'none' }, physicsWorlds: { physics: planeWorld } },
    );
    manualParticle(e);
    e.positions.set([0, 0.06, 0]);
    e.velocities.set([2, -10, 1]);
    e.startSizes.fill(0.2);
    let contacts = 0;
    e.onCollision = () => contacts++;
    e.step(0.02);
    expect(contacts).toBe(1);
    expect(e.velocities[1]).toBeCloseTo(10);
    expect(e.positions[1]).toBeCloseTo(0.24, 5);
    expect(() => e.resolveEnvironment({ fog: { mode: 'none' } })).toThrow(/physics world/);
    c.layerMask = 0;
    e.positions.set([0, 0.06, 0]);
    e.velocities.set([2, -10, 1]);
    e.step(0.02);
    expect(contacts).toBe(1);
    c.layerMask = -1;
    e.environment = {
      fog: { mode: 'none' },
      physicsWorlds: {
        physics: {
          sweepSphere(_q, hits) {
            hits.push({
              collider: planeCollider,
              fraction: NaN,
              point: [0, 0, 0],
              normal: [0, 1, 0],
            });
          },
        },
      },
    };
    expect(() => e.step(0.02)).toThrow(/sweep hit/);
  } finally {
    pack.dispose();
  }
});

it('matches native collider forces including sphere volume, speed and incidence switches', async () => {
  const pack = await loadPack(await archive());
  let maxRelative = 0,
    maxAbsolute = 0;
  try {
    for (const row of forceNative.cases) {
      const actual = [0, 0, 0];
      const collider: ParticleCollider = {
        ...planeCollider,
        dynamic: true,
        applyForce(force) {
          for (let axis = 0; axis < 3; axis++)
            actual[axis] = actual[axis]! + (force[axis]! * row.dt) / row.mass;
        },
      };
      const world: ParticlePhysicsWorld = {
        sweepSphere(query, hits) {
          planeWorld.sweepSphere(query, hits);
          for (let i = 0; i < hits.length; i++) hits[i] = { ...hits[i]!, collider };
        },
      };
      const source = particleSource();
      source.main!.space = I.Space.World;
      const c = new I.CollisionModuleT();
      c.type = I.CollisionType.World;
      c.hostPhysicsSlot = 'world';
      c.dynamicColliders = true;
      c.radiusScale = 0.5;
      c.dampen = constant(0);
      c.bounce = constant(1);
      c.lifetimeLoss = constant(0);
      c.maxKillSpeed = 10000;
      c.colliderForce = row.force;
      c.multiplyForceBySize = !!(row.switches & 1);
      c.multiplyForceBySpeed = !!(row.switches & 2);
      c.multiplyForceByAngle = !!(row.switches & 4);
      source.modules.push(new I.ParticleModuleT(I.ParticleModuleData.CollisionModule, c));
      const node = new Scene(pack, [1]).nodes.get(1)!;
      const e = new Emitter(5, node, source, true, 1, [], undefined, undefined, undefined, {
        fog: { mode: 'none' },
        physicsWorlds: { world },
      });
      manualParticle(e);
      e.positions.set([0, 0.01 + row.size * 0.25, 0]);
      e.velocities.set([row.speed * 0.6, -row.speed * 0.8, 0]);
      e.startSizes.fill(row.size);
      e.step(row.dt);
      const errors = [
        actual[0]! - row.velocity.x,
        actual[1]! - row.velocity.y,
        actual[2]! - row.velocity.z,
      ];
      maxAbsolute = Math.max(maxAbsolute, ...errors.map(Math.abs));
      maxRelative = Math.max(
        maxRelative,
        Math.hypot(...errors) / Math.hypot(row.velocity.x, row.velocity.y, row.velocity.z),
      );
    }
    recordError(
      'collider-force-velocity',
      maxAbsolute,
      'scene-unit/s',
      `${forceNative.cases.length} cases`,
    );
    recordError(
      'collider-force-relative',
      maxRelative,
      'ratio',
      `${forceNative.cases.length} cases`,
    );
    expect(maxRelative).toBeLessThan(0.1);
  } finally {
    pack.dispose();
  }
});

it('emits collision sub-emitters automatically without enabling public messages', async () => {
  const pack = await loadPack(await archive());
  try {
    const scene = new Scene(pack, [1]),
      node = scene.nodes.get(1)!;
    const parent = particleSource(),
      child = particleSource();
    parent.main!.space = I.Space.World;
    const c = new I.CollisionModuleT();
    c.planes = [1];
    c.radiusScale = 0.5;
    c.dampen = constant(0);
    c.bounce = constant(1);
    c.lifetimeLoss = constant(0);
    c.maxKillSpeed = 10000;
    parent.modules.push(
      new I.ParticleModuleT(I.ParticleModuleData.CollisionModule, c),
      new I.ParticleModuleT(
        I.ParticleModuleData.SubEmittersModule,
        new I.SubEmittersModuleT([new I.SubEmitterT(6, I.SubEmitterEvent.Collision)]),
      ),
    );
    child.main!.playOnEnable = false;
    child.modules.push(
      new I.ParticleModuleT(
        I.ParticleModuleData.EmissionModule,
        new I.EmissionModuleT(constant(0), constant(0), [new I.BurstT(0, constant(3))], false),
      ),
    );
    const a = new Emitter(
      5,
      node,
      parent,
      true,
      1,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      scene.nodes,
    );
    const b = new Emitter(6, node, child, true, 1, []);
    const graph = new SubEmitterGraph(
      new Map([
        [5, a],
        [6, b],
      ]),
    );
    manualParticle(a);
    b.sync();
    a.positions.set([0, 0.06, 0]);
    a.velocities.set([2, -10, 1]);
    a.startSizes.fill(0.2);
    graph.step(0.02);
    expect(b.count).toBe(3);
  } finally {
    pack.dispose();
  }
});

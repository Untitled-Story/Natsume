import { expect, it } from 'vitest';
import { copyEnvironment } from '../src/rendering/particle-environment.js';
import { loadPack } from '../src/loader/load.js';
import { Scene } from '../src/runtime/scene.js';
import { Emitter } from '../src/runtime/emitter.js';
import * as I from '../src/format/generated/noa/ir.js';
import { archive } from './helpers.js';
import { particleSource, constant, linear, manualParticle } from './particle-fixtures.js';
import { maximumLifetime, prewarmDuration } from '../src/runtime/prewarm.js';

it('copies velocity and 2D gravity inputs and rejects invalid dimensions', () => {
  const velocity: [number, number, number] = [1, 2, 3];
  const g: [number, number] = [0, -4];
  const env = copyEnvironment({
    fog: { mode: 'none' },
    gravity2D: g,
    rigidbodyVelocities: { body: velocity },
  })!;
  velocity[0] = 99;
  g[1] = 99;
  expect(env.rigidbodyVelocities!.body).toEqual([1, 2, 3]);
  expect(env.gravity2D).toEqual([0, -4]);
  expect(() =>
    copyEnvironment({ fog: { mode: 'none' }, rigidbodyVelocities: { body: [0, NaN, 0] } }),
  ).toThrow(/Rigidbody velocity/);
  expect(() => copyEnvironment({ fog: { mode: 'none' }, gravity2D: [Infinity, 0] })).toThrow(
    /Physics2D/,
  );
});

it('requires the exact Rigidbody slot and uses selected gravity independently of velocity', async () => {
  const pack = await loadPack(await archive());
  try {
    const source = particleSource();
    source.main!.space = I.Space.World;
    source.main!.emitterVelocityMode = I.EmitterVelocityMode.Rigidbody;
    source.main!.hostRigidbodyVelocitySlot = 'body';
    source.main!.gravitySource = I.GravitySource.Physics2D;
    source.main!.gravityMultiplier = constant(1);
    const node = new Scene(pack, [1]).nodes.get(1)!;
    expect(() => new Emitter(5, node, source, true, 1, [], [0, -9.81, 0])).toThrow(/Rigidbody/);
    const environment = copyEnvironment({
      fog: { mode: 'none' },
      gravity: [0, -9.81, 0],
      gravity2D: [2, -3],
      rigidbodyVelocities: { body: [4, 5, 6] },
    })!;
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
      environment,
    );
    expect(e.gravity).toEqual([2, -3, 0]);
    manualParticle(e);
    e.velocities.fill(0);
    e.step(0.02);
    expect([...e.emitterVelocity]).toEqual([4, 5, 6]);
    expect(e.velocities[0]).toBeCloseTo(0.04, 6);
    expect(e.velocities[1]).toBeCloseTo(-0.06, 6);
    expect(() => e.resolveEnvironment({ fog: { mode: 'none' }, gravity2D: [0, -3] })).toThrow(
      /body/,
    );
  } finally {
    pack.dispose();
  }
});

it('derives Transform velocity from world displacement, resets the baseline and preserves Custom units', async () => {
  const pack = await loadPack(await archive());
  try {
    const scene = new Scene(pack, [1]);
    const node = scene.nodes.get(1)!;
    const source = particleSource();
    const e = new Emitter(5, node, source, true, 1, []);
    e.sync();
    node.localPosition.x = 3;
    node.transformDirty = true;
    scene.update();
    e.sync();
    e.step(0.02);
    expect(e.emitterVelocity[0]).toBeCloseTo(150, 8);
    e.reset();
    e.sync();
    e.step(0.02);
    expect([...e.emitterVelocity]).toEqual([0, 0, 0]);
    source.main!.emitterVelocityMode = I.EmitterVelocityMode.Custom;
    source.main!.customEmitterVelocity = new I.Vec3T(2, 3, 4);
    node.localScale.x = 20;
    node.transformDirty = true;
    scene.update();
    e.sync();
    e.step(0.02);
    expect([...e.emitterVelocity]).toEqual([2, 3, 4]);
    node.active = false;
    scene.update();
    e.sync();
    node.localPosition.x = 100;
    node.transformDirty = true;
    scene.update();
    node.active = true;
    scene.update();
    e.sync();
    source.main!.emitterVelocityMode = I.EmitterVelocityMode.Transform;
    e.step(0.02);
    expect([...e.emitterVelocity]).toEqual([0, 0, 0]);
  } finally {
    pack.dispose();
  }
});

it('includes speed-modulated lifetime peaks in prewarm and birth survival bounds', () => {
  const source = particleSource();
  source.main!.lifetime = constant(2);
  source.main!.loop = true;
  source.main!.prewarm = true;
  source.main!.durationSeconds = 3;
  source.modules.push(
    new I.ParticleModuleT(
      I.ParticleModuleData.LifetimeByEmitterSpeedModule,
      new I.LifetimeByEmitterSpeedModuleT(linear(0.5, 4), new I.Vec2T(0, 10)),
    ),
  );
  expect(maximumLifetime(source.main!, source.modules)).toBe(8);
  expect(prewarmDuration(source.main!, source.modules)).toBe(9);
});

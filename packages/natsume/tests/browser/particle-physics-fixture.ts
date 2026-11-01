import { Application, type WebGLRenderer } from 'pixi.js';
import * as I from '../../src/format/generated/noa/ir.js';
import { EffectPack } from '../../src/pack.js';
import { NatsumeRuntime } from '../../src/runtime/runtime.js';
import { minimalDocument } from '../helpers.js';
import { particleSource, constant, manualParticle } from '../particle-fixtures.js';

export async function checkCollisionEvents() {
  const app = new Application();
  await app.init({
    preference: 'webgl',
    preferWebGLVersion: 2,
    width: 32,
    height: 32,
    autoStart: false,
  });
  const runtime = new NatsumeRuntime(app.renderer as WebGLRenderer);
  const doc = minimalDocument(),
    source = particleSource();
  source.main!.space = I.Space.World;
  const collision = new I.CollisionModuleT();
  collision.planes = [1];
  collision.dampen = constant(0);
  collision.bounce = constant(1);
  collision.lifetimeLoss = constant(0);
  collision.maxKillSpeed = 10000;
  collision.radiusScale = 0.5;
  collision.sendMessages = true;
  source.modules.push(new I.ParticleModuleT(I.ParticleModuleData.CollisionModule, collision));
  doc.features = [new I.FeatureRequirementT('particle.collision')];
  doc.components = [new I.ComponentT(5, 1, true, I.ComponentData.ParticleSystem, source)];
  const pack = new EffectPack(
    doc,
    { format: 'noa-package', version: 1, noir_version: [1, 0], document: 'scene.noir', files: [] },
    new Map(),
    new Map(),
  );
  const effect = await runtime.instantiate(pack);
  const events: {
    systemId: number;
    particleId: number;
    planeNodeId: number | undefined;
    normal: readonly number[];
  }[] = [];
  const reset = () => {
    effect.restart();
    effect.play();
    const emitter = effect.simulation.emitters.get(5)!;
    manualParticle(emitter);
    emitter.positions.set([0, 0.06, 0]);
    emitter.velocities.set([2, -10, 1]);
    emitter.startSizes.fill(0.2);
  };
  let recursive = false,
    late = 0;
  const offError = effect.onParticleCollision(() => {
    throw new Error('contact failure');
  });
  const off = effect.onParticleCollision((event) => {
    events.push(event);
    try {
      effect.update(0);
    } catch {
      recursive = true;
    }
  });
  reset();
  effect.update(1 / 60);
  const diagnostics = effect.diagnostics.map((d) => d.code);
  offError();
  off();
  off();
  const count = events.length;
  reset();
  effect.update(1 / 60);
  const unsubscribed = events.length === count;
  const cancel = effect.onParticleCollision(() => effect.stop('clear'));
  effect.onParticleCollision(() => late++);
  reset();
  effect.update(1 / 60);
  cancel();
  const stopped = effect.particleCount === 0;
  effect.destroy();
  let disposed = false;
  try {
    effect.onParticleCollision(() => {});
  } catch {
    disposed = true;
  }
  pack.dispose();
  runtime.destroy();
  app.destroy();
  return { events, diagnostics, recursive, unsubscribed, late, stopped, disposed };
}

export async function checkTriggerEvents() {
  const app = new Application();
  await app.init({
    preference: 'webgl',
    preferWebGLVersion: 2,
    width: 32,
    height: 32,
    autoStart: false,
  });
  const runtime = new NatsumeRuntime(app.renderer as WebGLRenderer),
    doc = minimalDocument(),
    source = particleSource();
  source.main!.space = I.Space.World;
  const ref = (slot: string | null) =>
    new I.EnvironmentReferenceT(I.EnvironmentKind.Collider3D, null, null, slot);
  source.modules.push(
    new I.ParticleModuleT(
      I.ParticleModuleData.TriggerModule,
      new I.TriggerModuleT(2, 2, 2, 2, I.ColliderQuery.All, 1, [
        ref(null),
        ref('sphere'),
        ref(null),
        ref('sphere'),
      ]),
    ),
  );
  doc.features = [new I.FeatureRequirementT('particle.trigger')];
  doc.components = [new I.ComponentT(5, 1, true, I.ComponentData.ParticleSystem, source)];
  const pack = new EffectPack(
    doc,
    { format: 'noa-package', version: 1, noir_version: [1, 0], document: 'scene.noir', files: [] },
    new Map(),
    new Map(),
  );
  const effect = await runtime.instantiate(pack, {
    particleEnvironment: {
      fog: { mode: 'none' },
      colliders: {
        sphere: { id: 'sphere', layer: 0, overlapSphere: () => true, sweepSphere: () => true },
      },
    },
  });
  const events: { kind: string; colliders: readonly { slot: number; colliderId: string }[] }[] = [];
  const offError = effect.onParticleTrigger(() => {
    throw new Error('trigger failure');
  });
  let recursive = false;
  const off = effect.onParticleTrigger((event) => {
    events.push(event);
    try {
      effect.update(0);
    } catch {
      recursive = true;
    }
    if (events.length === 1) effect.pause();
  });
  effect.play();
  const e = effect.simulation.emitters.get(5)!;
  manualParticle(e);
  e.positions.fill(0);
  e.velocities.fill(0);
  effect.update(1 / 60);
  const pausedAt = effect.time;
  effect.update(1 / 60);
  const paused = effect.time === pausedAt;
  effect.play();
  effect.update(1 / 60);
  const resumedAt = effect.time;
  offError();
  off();
  off();
  effect.update(1 / 60);
  const unsubscribed = events.length === 2;
  const diagnostics = effect.diagnostics.map((d) => d.code);
  effect.destroy();
  let disposed = false;
  try {
    effect.onParticleTrigger(() => {});
  } catch {
    disposed = true;
  }
  pack.dispose();
  runtime.destroy();
  app.destroy();
  return { events, recursive, paused, pausedAt, resumedAt, unsubscribed, diagnostics, disposed };
}

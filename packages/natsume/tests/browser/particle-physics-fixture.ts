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

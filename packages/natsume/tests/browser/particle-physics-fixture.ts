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

export async function checkParticleLightLifecycle() {
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
  source.modules.push(
    new I.ParticleModuleT(
      I.ParticleModuleData.LightsModule,
      new I.LightsModuleT(
        1,
        false,
        true,
        true,
        true,
        8,
        new I.EnvironmentReferenceT(I.EnvironmentKind.Light, null, null, 'light'),
        constant(1),
        constant(1),
      ),
    ),
  );
  doc.features = [new I.FeatureRequirementT('particle.lights')];
  doc.components = [new I.ComponentT(5, 1, true, I.ComponentData.ParticleSystem, source)];
  const pack = new EffectPack(
    doc,
    { format: 'noa-package', version: 1, noir_version: [1, 0], document: 'scene.noir', files: [] },
    new Map(),
    new Map(),
  );
  let created = 0,
    destroyed = 0,
    updates = 0;
  const template = {
    color: [1, 1, 1] as const,
    range: 1,
    intensity: 1,
    create() {
      created++;
      return {
        update() {
          updates++;
        },
        destroy() {
          destroyed++;
        },
      };
    },
  };
  const environment = { fog: { mode: 'none' as const }, lights: { light: template } };
  const blocked = !runtime.checkCompatibility(pack).compatible;
  const effect = await runtime.instantiate(pack, { particleEnvironment: environment });
  effect.play();
  manualParticle(effect.simulation.emitters.get(5)!);
  effect.update(1 / 60);
  const first = { created, destroyed };
  effect.pause();
  effect.update(0);
  effect.setParticleEnvironment({ ...environment, lights: { light: { ...template } } });
  const replaced = { created, destroyed };
  effect.stop('clear');
  const cleared = { created, destroyed };
  effect.restart();
  effect.play();
  manualParticle(effect.simulation.emitters.get(5)!);
  effect.update(1 / 60);
  effect.destroy();
  effect.destroy();
  const final = { created, destroyed };
  pack.dispose();
  runtime.destroy();
  app.destroy();
  return { blocked, first, replaced, cleared, final, updates };
}

export async function checkParticleStopLifecycle() {
  const app = new Application();
  await app.init({
    preference: 'webgl',
    preferWebGLVersion: 2,
    width: 32,
    height: 32,
    autoStart: false,
  });
  const runtime = new NatsumeRuntime(app.renderer as WebGLRenderer),
    identity = new I.ScriptIdentityT('Probe', 'Probe', 'Stopped');
  const calls: string[] = [];
  let factories = 0;
  runtime.registerScript(identity, () => {
    factories++;
    return {
      onEnable() {
        calls.push('enable');
      },
      onDisable() {
        calls.push('disable');
      },
      destroy() {
        calls.push('destroy');
      },
      onParticleSystemStopped(e) {
        calls.push(`bridge:${e.systemId}`);
      },
    };
  });
  const makePack = (action: number, receiverEnabled = true) => {
    const doc = minimalDocument(),
      source = particleSource();
    source.main!.playOnEnable = true;
    source.main!.durationSeconds = 0.05;
    source.main!.lifetime = constant(0.02);
    source.main!.stopAction = action;
    source.modules.push(
      new I.ParticleModuleT(
        I.ParticleModuleData.EmissionModule,
        new I.EmissionModuleT(constant(0), constant(0), [new I.BurstT(0, constant(1), 1, 0, 1)]),
      ),
    );
    doc.components = [
      new I.ComponentT(5, 1, true, I.ComponentData.ParticleSystem, source),
      new I.ComponentT(
        6,
        1,
        receiverEnabled,
        I.ComponentData.CustomComponent,
        new I.CustomComponentT(identity),
      ),
    ];
    return new EffectPack(
      doc,
      {
        format: 'noa-package',
        version: 1,
        noir_version: [1, 0],
        document: 'scene.noir',
        files: [],
      },
      new Map(),
      new Map(),
    );
  };
  const pack = makePack(I.StopAction.Callback),
    effect = await runtime.instantiate(pack);
  let recursive = false,
    late = 0,
    received = 0;
  const offError = effect.onParticleSystemStopped(() => {
    throw new Error('stop failure');
  });
  const off = effect.onParticleSystemStopped((e) => {
    received++;
    if (e.systemId !== 5) throw new Error('system');
    try {
      effect.update(0);
    } catch {
      recursive = true;
    }
  });
  effect.play();
  for (let i = 0; i < 10; i++) effect.update(1 / 60);
  const firstBridge = calls.filter((c) => c === 'bridge:5').length;
  off();
  off();
  offError();
  const cancel = effect.onParticleSystemStopped(() => effect.restart());
  const after = effect.onParticleSystemStopped(() => late++);
  effect.restart();
  for (let i = 0; i < 4; i++) effect.update(1 / 60);
  cancel();
  after();
  const cancelledBridge = calls.filter((c) => c === 'bridge:5').length === firstBridge;
  effect.stop('clear');
  effect.update(0);
  const diagnostics = effect.diagnostics.map((d) => d.code);
  effect.destroy();
  pack.dispose();
  const disabledPack = makePack(I.StopAction.Callback, false);
  const disabled = await runtime.instantiate(disabledPack);
  const beforeDisabled = calls.filter((c) => c === 'bridge:5').length;
  disabled.play();
  for (let i = 0; i < 10; i++) disabled.update(1 / 60);
  const disabledReceiver = calls.filter((c) => c === 'bridge:5').length === beforeDisabled + 1;
  disabled.destroy();
  disabledPack.dispose();
  const destroyedPack = makePack(I.StopAction.Destroy),
    destroyed = await runtime.instantiate(destroyedPack);
  const beforeDestroy = calls.filter((c) => c === 'destroy').length;
  destroyed.play();
  const handle = destroyed.getNode(1)!;
  for (let i = 0; i < 10; i++) destroyed.update(1 / 60);
  const removed = destroyed.getNode(1) === undefined;
  let rejects = false;
  try {
    handle.setActive(true);
  } catch {
    rejects = true;
  }
  const afterDestroy = calls.filter((c) => c === 'destroy').length - beforeDestroy;
  const beforeRestart = factories;
  destroyed.restart();
  const recreated = factories === beforeRestart + 1 && !!destroyed.getNode(1);
  destroyed.destroy();
  destroyed.destroy();
  destroyedPack.dispose();
  runtime.destroy();
  app.destroy();
  return {
    recursive,
    received,
    late,
    firstBridge,
    cancelledBridge,
    diagnostics,
    removed,
    rejects,
    afterDestroy,
    recreated,
    disabledReceiver,
  };
}

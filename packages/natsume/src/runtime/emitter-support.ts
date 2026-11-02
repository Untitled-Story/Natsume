import type { DeepReadonly as R } from '../pack.js';
import type { ParticleSystemT } from '../format/generated/noa/ir/particle-system.js';
import type { EmissionModuleT } from '../format/generated/noa/ir/emission-module.js';
import type { NoiseModuleT } from '../format/generated/noa/ir/noise-module.js';
import type { SubEmittersModuleT } from '../format/generated/noa/ir/sub-emitters-module.js';
import type { ShapeModuleT } from '../format/generated/noa/ir/shape-module.js';
import { ParticleModuleData as M } from '../format/generated/noa/ir/particle-module-data.js';
import { Space } from '../format/generated/noa/ir/space.js';
import { ShapeGeometry } from '../format/generated/noa/ir/shape-geometry.js';
import { constantZero, parameterSupport } from './parameters.js';
import { prewarmDuration } from './prewarm.js';
import type { ParticleEnvironment } from '../rendering/particle-environment.js';
import { SupportChecks, type SupportIssue } from './support-checks.js';
import type { ExternalForcesModuleT } from '../format/generated/noa/ir/external-forces-module.js';
import { selectForceFields } from './particle-force-fields.js';
import type { CollisionModuleT } from '../format/generated/noa/ir/collision-module.js';
import type { TriggerModuleT } from '../format/generated/noa/ir/trigger-module.js';
import type { LightsModuleT } from '../format/generated/noa/ir/lights-module.js';

export function emitterSupport(
  source: R<ParticleSystemT>,
  gravity: readonly [number, number, number] | undefined,
  customSpaceAvailable: boolean,
  environment?: ParticleEnvironment,
  sceneNodeIds?: ReadonlySet<number>,
): readonly SupportIssue[] {
  const rules = new SupportChecks();
  rules.issues.push(...parameterSupport(source));
  const main = source.main!;
  rules.require(
    main.culling !== 1 ||
      (environment?.fixedDeltaSeconds !== undefined &&
        Number.isFinite(environment.fixedDeltaSeconds) &&
        environment.fixedDeltaSeconds > 0),
    'HOST',
    'particleEnvironment.fixedDeltaSeconds',
    environment?.fixedDeltaSeconds,
    'PauseAndCatchup requires particleEnvironment.fixedDeltaSeconds',
  );
  rules.require(
    main.emitterVelocityMode !== 1 ||
      environment?.rigidbodyVelocities?.[String(main.hostRigidbodyVelocitySlot)] !== undefined,
    'HOST',
    'main.hostRigidbodyVelocitySlot',
    main.hostRigidbodyVelocitySlot,
    'Emitter requires a bound host Rigidbody velocity',
  );
  rules.require(
    constantZero(main.gravityMultiplier) ||
      (main.gravitySource === 1
        ? environment?.gravity2D !== undefined
        : gravity !== undefined || environment?.gravity !== undefined) ||
      main.gravity,
    'HOST',
    'main.gravityMultiplier',
    main.gravityMultiplier,
    'Nonzero gravityMultiplier requires particleEnvironment.gravity',
  );
  rules.require(
    main.space !== Space.Custom || customSpaceAvailable,
    'HOST',
    'main.customSpaceNodeId',
    main.customSpaceNodeId,
    'Custom simulation node is unavailable',
  );
  rules.require(
    main.maxParticles <= 100_000,
    'LIMIT',
    'main.maxParticles',
    main.maxParticles,
    'Emitter capacity exceeds playback limit',
  );
  rules.require(
    main.durationSeconds >= 1 / 60,
    'CAPABILITY',
    'main.durationSeconds',
    main.durationSeconds,
    'Playback requires duration >= 1/60 second',
  );
  if (
    main.prewarm &&
    main.loop &&
    !constantZero(main.startDelay) &&
    source.modules.some(
      (module) =>
        module.dataType === M.SubEmittersModule &&
        (module.data as R<SubEmittersModuleT>).emitters.some((edge) => edge.systemComponentId),
    )
  )
    rules.warn(
      'DELAYED_GRAPH_PREWARM',
      'main.prewarm',
      true,
      'Natsume continues playback after delayed graph prewarm; Unity 2022.3 can stall in multi-level configurations.',
    );
  const steps = Math.ceil(prewarmDuration(main, source.modules) * 60);
  rules.require(
    steps <= 36_000 && main.maxParticles * steps <= 10_000_000,
    'LIMIT',
    'main.prewarm',
    { steps, capacitySteps: main.maxParticles * steps },
    'Prewarm work exceeds playback budget',
  );
  for (const [index, module] of source.modules.entries()) {
    const path = `modules.${index}`;
    rules.require(
      (module.dataType >= M.EmissionModule && module.dataType <= M.RotationBySpeedModule) ||
        module.dataType === M.SubEmittersModule ||
        module.dataType === M.TrailsModule ||
        module.dataType === M.ForceModule ||
        module.dataType === M.ExternalForcesModule ||
        module.dataType === M.CollisionModule ||
        module.dataType === M.TriggerModule ||
        module.dataType === M.LightsModule ||
        module.dataType === M.ColorBySpeedModule ||
        module.dataType === M.InheritVelocityModule ||
        module.dataType === M.LifetimeByEmitterSpeedModule,
      'CAPABILITY',
      `${path}.dataType`,
      module.dataType,
      'Unsupported particle module',
    );
    if (module.dataType === M.ExternalForcesModule) {
      try {
        selectForceFields(module.data as R<ExternalForcesModuleT>, environment?.forceFields);
      } catch (error) {
        rules.require(
          false,
          'HOST',
          `${path}.influences`,
          module.data,
          error instanceof Error ? error.message : 'Missing host force fields',
        );
      }
    }
    if (module.dataType === M.CollisionModule) {
      const collision = module.data as R<CollisionModuleT>;
      if (collision.type === 1 && collision.quality !== 0)
        rules.warn(
          'HOST_COLLISION_QUALITY',
          `${path}.quality`,
          collision.quality,
          'Collision quality and voxel settings are passed to host sphere sweeps; Unity native voxel-cache history is not reproduced.',
        );
      if (collision.type === 0)
        for (const [slot, id] of collision.planes.entries())
          rules.require(
            !id || sceneNodeIds?.has(id),
            'HOST',
            `${path}.planes.${slot}`,
            id,
            'Collision plane is outside this instance',
          );
      rules.require(
        collision.type === 0 || environment?.physicsWorlds?.[String(collision.hostPhysicsSlot)],
        'HOST',
        `${path}.hostPhysicsSlot`,
        collision.hostPhysicsSlot,
        'Missing host particle physics world',
      );
    }
    if (module.dataType === M.TriggerModule)
      for (const [slot, reference] of (module.data as R<TriggerModuleT>).colliders.entries())
        rules.require(
          !reference.hostSlot || environment?.colliders?.[String(reference.hostSlot)]?.sweepSphere,
          'HOST',
          `${path}.colliders.${slot}.hostSlot`,
          reference.hostSlot,
          'Missing host particle collider',
        );
    if (module.dataType === M.LightsModule) {
      const slot = (module.data as R<LightsModuleT>).light?.hostSlot;
      rules.require(
        !slot || environment?.lights?.[String(slot)],
        'HOST',
        `${path}.light.hostSlot`,
        slot,
        'Missing host particle light template',
      );
    }
    if (module.dataType === M.EmissionModule) {
      const emission = module.data as R<EmissionModuleT>;
      const count = emission.bursts.reduce(
        (count, burst) =>
          count +
          (burst.intervalSeconds === 0
            ? 1
            : burst.cycles ||
              Math.max(
                0,
                Math.ceil((main.durationSeconds - burst.timeSeconds) / burst.intervalSeconds),
              )),
        0,
      );
      rules.require(count <= 4096, 'LIMIT', `${path}.bursts`, count, 'Too many burst repetitions');
    }
    if (module.dataType === M.ShapeModule) {
      const shape = module.data as R<ShapeModuleT>;
      rules.require(
        shape.geometry &&
          shape.geometryType >= ShapeGeometry.CircleShape &&
          shape.geometryType <= ShapeGeometry.MeshShape,
        'CAPABILITY',
        `${path}.geometryType`,
        shape.geometryType,
        'Unsupported shape',
      );
    }
    if (module.dataType === M.NoiseModule) {
      const noise = module.data as R<NoiseModuleT>;
      rules.require(
        noise.algorithm === 'unity-particle-noise' && noise.algorithmRevision === 1,
        'CAPABILITY',
        `${path}.algorithm`,
        [noise.algorithm, noise.algorithmRevision],
        'Unsupported particle noise algorithm or revision',
      );
      rules.warn(
        'APPROXIMATE_NOISE',
        path,
        noise.algorithm,
        'Noise uses measured Perlin curl fields; unmeasured parameter combinations may differ from Unity.',
      );
    }
  }
  return rules.issues;
}

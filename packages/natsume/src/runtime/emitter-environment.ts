import type { DeepReadonly as R } from '../pack.js';
import type { ParticleSystemT } from '../format/generated/noa/ir/particle-system.js';
import type { ExternalForcesModuleT } from '../format/generated/noa/ir/external-forces-module.js';
import type { CollisionModuleT } from '../format/generated/noa/ir/collision-module.js';
import type { TriggerModuleT } from '../format/generated/noa/ir/trigger-module.js';
import type { LightsModuleT } from '../format/generated/noa/ir/lights-module.js';
import { ParticleModuleData as M } from '../format/generated/noa/ir/particle-module-data.js';
import type { ParticleEnvironment } from '../rendering/particle-environment.js';
import { selectForceFields } from './particle-force-fields.js';
import { constantZero } from './parameters.js';
import { SupportChecks } from './support-checks.js';

/** Resolves the same host requirements for preflight, construction and replacement. */
export function inspectEmitterEnvironment(
  source: R<ParticleSystemT>,
  environment: ParticleEnvironment | undefined,
  fallbackGravity?: readonly [number, number, number],
  animatedGravity = false,
) {
  const rules = new SupportChecks();
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
  const velocity = environment?.rigidbodyVelocities?.[String(main.hostRigidbodyVelocitySlot)];
  rules.require(
    main.emitterVelocityMode !== 1 ||
      (Array.isArray(velocity) && velocity.length === 3 && velocity.every(Number.isFinite)),
    'HOST',
    'main.hostRigidbodyVelocitySlot',
    main.hostRigidbodyVelocitySlot,
    `Emitter requires a bound host Rigidbody velocity: ${main.hostRigidbodyVelocitySlot}`,
  );
  const suppliedGravity =
    main.gravitySource === 1
      ? environment?.gravity2D && ([environment.gravity2D[0], environment.gravity2D[1], 0] as const)
      : (environment?.gravity ?? fallbackGravity);
  rules.require(
    (!animatedGravity && constantZero(main.gravityMultiplier)) || suppliedGravity || main.gravity,
    'HOST',
    'main.gravityMultiplier',
    main.gravityMultiplier,
    `${animatedGravity ? 'Animated' : 'Nonzero'} gravityMultiplier requires particleEnvironment.gravity`,
  );
  const authored = main.gravity;
  const gravity =
    suppliedGravity ??
    (authored ? ([authored.x, authored.y, authored.z] as const) : ([0, 0, 0] as const));
  rules.require(
    Array.isArray(gravity) && gravity.length === 3 && gravity.every(Number.isFinite),
    'HOST',
    'particleEnvironment.gravity',
    gravity,
    'Invalid particle gravity',
  );
  for (const [index, module] of source.modules.entries()) {
    const path = `modules.${index}`;
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
          `Missing host particle collider ${reference.hostSlot}`,
        );
    if (module.dataType === M.LightsModule) {
      const slot = (module.data as R<LightsModuleT>).light?.hostSlot;
      rules.require(
        !slot || environment?.lights?.[String(slot)],
        'HOST',
        `${path}.light.hostSlot`,
        slot,
        `Missing host particle light template ${slot}`,
      );
    }
  }
  return { gravity, issues: rules.issues };
}

import type { DeepReadonly as R } from '../pack.js';
import type { ParticleSystemT } from '../format/generated/noa/ir/particle-system.js';
import type { EmissionModuleT } from '../format/generated/noa/ir/emission-module.js';
import type { NoiseModuleT } from '../format/generated/noa/ir/noise-module.js';
import type { ShapeModuleT } from '../format/generated/noa/ir/shape-module.js';
import { ParticleModuleData as M } from '../format/generated/noa/ir/particle-module-data.js';
import { Space } from '../format/generated/noa/ir/space.js';
import { ShapeGeometry } from '../format/generated/noa/ir/shape-geometry.js';
import { constantZero, parameterSupport } from './parameters.js';
import { prewarmDuration } from './prewarm.js';
import { SupportChecks, type SupportIssue } from './support-checks.js';

export function emitterSupport(
  source: R<ParticleSystemT>,
  gravity: readonly [number, number, number] | undefined,
  customSpaceAvailable: boolean,
): readonly SupportIssue[] {
  const rules = new SupportChecks();
  rules.issues.push(...parameterSupport(source));
  const main = source.main!;
  rules.require(
    constantZero(main.gravityMultiplier) || gravity !== undefined || main.gravity,
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
  const steps = Math.ceil(prewarmDuration(main) * 60);
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
      module.dataType >= M.EmissionModule && module.dataType <= M.CustomDataModule,
      'CAPABILITY',
      `${path}.dataType`,
      module.dataType,
      'Unsupported particle module',
    );
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
          shape.geometryType <= ShapeGeometry.EdgeShape,
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
        'Noise uses calibrated TypeScript Curl Noise; seeded trajectories differ from Unity.',
      );
    }
  }
  return rules.issues;
}

import { createPlaybackHarness } from './playback-harness.js';
import { minimalDocument } from '../helpers.js';
import { particleSource, constant } from '../particle-fixtures.js';
import { EffectPack } from '../../src/pack.js';
import { ComponentT } from '../../src/format/generated/noa/ir/component.js';
import { ComponentData } from '../../src/format/generated/noa/ir/component-data.js';
import { NatsumeCompatibilityError } from '../../src/runtime/compatibility.js';
import type { ParticleEnvironment } from '../../src/rendering/particle-environment.js';

export async function verifyEnvironmentValidation() {
  const { app, runtime } = await createPlaybackHarness();
  const document = minimalDocument(),
    source = particleSource();
  source.main!.gravityMultiplier = constant(1);
  document.components = [new ComponentT(3, 1, true, ComponentData.ParticleSystem, source)];
  const pack = new EffectPack(document, { files: [] } as never, new Map(), new Map());
  const valid: ParticleEnvironment = { fog: { mode: 'none' }, gravity: [0, -4, 0] };
  try {
    const effect = await runtime.instantiate(pack, { particleEnvironment: valid });
    const results = [];
    for (const invalid of [
      { gravity: 'abc' },
      { rigidbodyVelocities: { body: 'abc' } },
      { fixedDeltaSeconds: -1 },
      { gravity2D: [NaN, 0] },
      { rigidbodyVelocities: { body: [Infinity, 0, 0] } },
      { forceFields: { field: { layer: 0 } } },
      { physicsWorlds: { world: {} } },
      { colliders: { collider: { id: '', layer: 0, overlapSphere() {} } } },
      { lights: { light: { create() {}, color: [1, 1, 1], range: -1, intensity: 1 } } },
    ]) {
      const environment = {
        ...valid,
        gravity: [0, -8, 0],
        ...invalid,
      } as unknown as ParticleEnvironment;
      const report = runtime.checkCompatibility(pack, { particleEnvironment: environment });
      let creationRejected = false,
        replacementRejected = false;
      try {
        await runtime.instantiate(pack, { particleEnvironment: environment });
      } catch (error) {
        creationRejected =
          error instanceof NatsumeCompatibilityError &&
          JSON.stringify(error.issues) === JSON.stringify(report.issues);
      }
      try {
        effect.setParticleEnvironment(environment);
      } catch {
        replacementRejected = true;
      }
      results.push(
        !report.compatible &&
          creationRejected &&
          replacementRejected &&
          effect.simulation.emitters.get(3)!.gravity[1] === -4,
      );
    }
    effect.setParticleEnvironment({ ...valid, gravity: [0, -8, 0] });
    return { rejected: results, replaced: effect.simulation.emitters.get(3)!.gravity[1] === -8 };
  } finally {
    runtime.destroy();
    pack.dispose();
    app.destroy(true);
  }
}

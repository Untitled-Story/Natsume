import type { EffectPack } from '../src/pack.js';
import type { ParticleSystemT } from '../src/format/generated/noa/ir/particle-system.js';
import { emitterSupport } from '../src/runtime/emitter-support.js';
import { SUPPORTED_FEATURES } from '../src/format/semantics.js';

/** New compiler contracts may expose host requirements absent from older native fixtures. */
export function nativeSimulationIssues(pack: EffectPack): string[] {
  return [
    ...pack.document.features
      .filter((f) => f.required && SUPPORTED_FEATURES[String(f.name)] !== f.revision)
      .map((f) => String(f.name)),
    ...pack.components
      .filter((c) => c.dataType === 3)
      .flatMap((c) =>
        emitterSupport(c.data as ParticleSystemT, [0, -9.81, 0], true)
          .filter((i) => i.severity === 'error')
          .map((i) => `${c.id}:${i.field}`),
      ),
  ];
}

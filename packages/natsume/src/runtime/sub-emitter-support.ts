import type { DeepReadonly as R } from '../pack.js';
import type { ParticleSystemT } from '../format/generated/noa/ir/particle-system.js';
import type { SupportIssue } from './support-checks.js';
import { subEmitterVisitCounts } from './sub-emitter-order.js';

/** Reports pools reached by independent update roots; duplicate slots share one root. */
export function subEmitterSupport(
  systems: ReadonlyMap<number, R<ParticleSystemT>>,
): readonly SupportIssue[] {
  const shared = [...subEmitterVisitCounts(systems)]
    .filter(([, visits]) => visits > 1)
    .map(([id]) => id);
  return shared.length
    ? [
        {
          severity: 'warning',
          code: 'SHARED_SUB_EMITTER_ORDER',
          field: 'subEmitters.sharedTargets',
          value: shared,
          message:
            'Shared sub-emitter pools use stable scheduling by default. Unity job interleaving can change birth ages and lifetime-boundary counts; subEmitterUpdateOrder controls pool and parent job order.',
        },
      ]
    : [];
}

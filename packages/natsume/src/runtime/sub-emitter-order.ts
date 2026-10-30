import { check } from '../errors.js';
import type { DeepReadonly as R } from '../pack.js';
import type { ParticleSystemT } from '../format/generated/noa/ir/particle-system.js';
import type { SubEmittersModuleT } from '../format/generated/noa/ir/sub-emitters-module.js';
import { ParticleModuleData as M } from '../format/generated/noa/ir/particle-module-data.js';

/** One pool update per independent root; repeated slots and diamonds share a visit. */
export function subEmitterVisitCounts(
  systems: ReadonlyMap<number, R<ParticleSystemT>>,
): Map<number, number> {
  const edges = new Map(
    [...systems].map(([id, source]) => [
      id,
      new Set(
        (
          (
            source.modules.find((m) => m.dataType === M.SubEmittersModule)?.data as
              | R<SubEmittersModuleT>
              | undefined
          )?.emitters ?? []
        )
          .map((edge) => edge.systemComponentId)
          .filter((id) => systems.has(id)),
      ),
    ]),
  );
  const incoming = new Set([...edges.values()].flatMap((ids) => [...ids]));
  const visits = new Map([...systems.keys()].map((id) => [id, 0]));
  for (const root of systems.keys()) {
    if (incoming.has(root)) continue;
    const seen = new Set<number>();
    const queue = [root];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]!;
      if (seen.has(id)) continue;
      seen.add(id);
      visits.set(id, visits.get(id)! + 1);
      queue.push(...edges.get(id)!);
    }
  }
  return visits;
}

/** Validates and copies a complete fixed-step job order without retaining host arrays. */
export function copySubEmitterUpdateOrder(
  systems: ReadonlyMap<number, R<ParticleSystemT>>,
  order: readonly number[] | undefined,
): readonly number[] | undefined {
  if (order === undefined) return undefined;
  check(Array.isArray(order), 'HOST', 'Sub-emitter update order must be an array of system IDs');
  const remaining = subEmitterVisitCounts(systems);
  for (const [id, count] of remaining) remaining.set(id, Math.max(1, count));
  check(
    order.length === [...remaining.values()].reduce((sum, count) => sum + count, 0),
    'HOST',
    'Sub-emitter update order must include every pool once per independent root',
  );
  for (const id of order) {
    const count = remaining.get(id) ?? 0;
    check(
      Number.isInteger(id) && count > 0,
      'HOST',
      'Unknown or excessive system ID in sub-emitter update order',
    );
    remaining.set(id, count - 1);
  }
  return order.slice();
}

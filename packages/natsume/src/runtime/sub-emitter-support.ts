import type { DeepReadonly as R } from '../pack.js';
import type { ParticleSystemT } from '../format/generated/noa/ir/particle-system.js';
import type { SubEmittersModuleT } from '../format/generated/noa/ir/sub-emitters-module.js';
import { ParticleModuleData as M } from '../format/generated/noa/ir/particle-module-data.js';
import type { SupportIssue } from './support-checks.js';

/** Reports pools reached by independent update roots; duplicate slots share one root. */
export function subEmitterSupport(
  systems: ReadonlyMap<number, R<ParticleSystemT>>,
): readonly SupportIssue[] {
  const edges = new Map(
    [...systems].map(([id, source]) => [
      id,
      new Set(
        (
          source.modules.find((m) => m.dataType === M.SubEmittersModule)?.data as
            | R<SubEmittersModuleT>
            | undefined
        )?.emitters
          .map((e) => e.systemComponentId)
          .filter((target) => systems.has(target)) ?? [],
      ),
    ]),
  );
  const degrees = new Map([...systems.keys()].map((id) => [id, 0]));
  for (const targets of edges.values())
    for (const id of targets) degrees.set(id, degrees.get(id)! + 1);
  const roots = new Map<number, Set<number>>();
  const queue = [...systems.keys()].filter((id) => degrees.get(id) === 0);
  for (const id of queue) roots.set(id, new Set([id]));
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const target of edges.get(id)!) {
      let incoming = roots.get(target);
      if (!incoming) roots.set(target, (incoming = new Set()));
      for (const root of roots.get(id)!) incoming.add(root);
      const degree = degrees.get(target)! - 1;
      degrees.set(target, degree);
      if (degree === 0) queue.push(target);
    }
  }
  const shared = [...roots].filter(([, incoming]) => incoming.size > 1).map(([id]) => id);
  return shared.length
    ? [
        {
          severity: 'warning',
          code: 'SHARED_SUB_EMITTER_ORDER',
          field: 'subEmitters.sharedTargets',
          value: shared,
          message:
            'Shared sub-emitter pools follow serial root updates. Unity parallel scheduling and global registration can change birth ages and lifetime-boundary counts.',
        },
      ]
    : [];
}

import type { DeepReadonly as R } from '../pack.js';
import type { ParticleSystemT } from '../format/generated/noa/ir/particle-system.js';
import { scalar } from './parameters.js';
import { ParticleModuleData as M } from '../format/generated/noa/ir/particle-module-data.js';
import type { ParticleModuleT } from '../format/generated/noa/ir/particle-module.js';
import type { ScalarParameterT } from '../format/generated/noa/ir/scalar-parameter.js';
import type { LifetimeByEmitterSpeedModuleT } from '../format/generated/noa/ir/lifetime-by-emitter-speed-module.js';
import type { SubEmittersModuleT } from '../format/generated/noa/ir/sub-emitters-module.js';

/** Conservative upper bound of authored birth lifetimes, including curve peaks. */
function maximumParameter(p: R<ScalarParameterT> | null): number {
  let lifetime = Math.max(1e-6, scalar(p, 0, 0), scalar(p, 0, 1));
  if (p && (p.mode === 1 || p.mode === 3)) {
    for (const c of p.mode === 3 ? [p.curveMin, p.curveMax] : [p.curveMax]) {
      for (let i = 0; i < (c?.keys.length ?? 0); i++) {
        const k = c!.keys[i]!,
          next = c!.keys[i + 1];
        lifetime = Math.max(lifetime, k.value * p.multiplier);
        if (next && k.interpolation >= 2) {
          const dt = next.time - k.time;
          // Bezier control values bound weighted and Hermite segment peaks.
          lifetime = Math.max(
            lifetime,
            (k.value + k.outSlope * dt * (k.weightedOut ? k.outWeight : 1 / 3)) * p.multiplier,
            (next.value - next.inSlope * dt * (next.weightedIn ? next.inWeight : 1 / 3)) *
              p.multiplier,
          );
        }
      }
    }
  }
  return lifetime;
}

/** Conservative lifetime bound including emitter-speed modulation. */
export function maximumLifetime(
  main: NonNullable<R<ParticleSystemT>['main']>,
  modules: readonly R<ParticleModuleT>[] = [],
): number {
  const module = modules.find((m) => m.dataType === M.LifetimeByEmitterSpeedModule)?.data as
    | R<LifetimeByEmitterSpeedModuleT>
    | undefined;
  return Math.max(
    1e-6,
    maximumParameter(main.lifetime) * (module ? maximumParameter(module.multiplier) : 1),
  );
}

/** Warm complete cycles until birth lifetimes can reach steady state. */
export function prewarmDuration(
  main: NonNullable<R<ParticleSystemT>['main']>,
  modules: readonly R<ParticleModuleT>[] = [],
): number {
  if (!main.prewarm || !main.loop) return 0;
  return Math.ceil(maximumLifetime(main, modules) / main.durationSeconds) * main.durationSeconds;
}

/** Connected warm history follows the longest authored lifetime path, not a sum of siblings. */
export function graphPrewarmEstimate(
  rootId: number,
  systems: ReadonlyMap<number, R<ParticleSystemT>>,
): { history: number; work: number } {
  const edges = (id: number) =>
    (
      systems.get(id)!.modules.find((m) => m.dataType === M.SubEmittersModule)?.data as
        | R<SubEmittersModuleT>
        | undefined
    )?.emitters ?? [];
  const scope = new Set([rootId]);
  for (const id of scope)
    for (const edge of edges(id))
      if (systems.has(edge.systemComponentId)) scope.add(edge.systemComponentId);
  const degrees = new Map([...scope].map((id) => [id, 0]));
  let capacity = 0;
  for (const id of scope) {
    capacity += systems.get(id)!.main!.maxParticles;
    for (const edge of edges(id))
      if (scope.has(edge.systemComponentId))
        degrees.set(edge.systemComponentId, degrees.get(edge.systemComponentId)! + 1);
  }
  const order = [...scope].filter((id) => degrees.get(id) === 0);
  for (let i = 0; i < order.length; i++)
    for (const edge of edges(order[i]!))
      if (scope.has(edge.systemComponentId)) {
        const degree = degrees.get(edge.systemComponentId)! - 1;
        degrees.set(edge.systemComponentId, degree);
        if (degree === 0) order.push(edge.systemComponentId);
      }
  // Propagate accumulated prefixes: Float32 addition is not associative.
  // Shared descendants retain the longest incoming path without expanding the DAG.
  const paths = new Map([
    [
      rootId,
      Math.fround(maximumLifetime(systems.get(rootId)!.main!, systems.get(rootId)!.modules)),
    ],
  ]);
  let history = 0;
  for (const id of order) {
    const prefix = paths.get(id);
    if (prefix === undefined) continue;
    history = Math.max(history, prefix);
    for (const edge of edges(id)) {
      const target = systems.get(edge.systemComponentId);
      if (!target) continue;
      const next = Math.fround(prefix + Math.fround(maximumLifetime(target.main!, target.modules)));
      paths.set(edge.systemComponentId, Math.max(paths.get(edge.systemComponentId) ?? 0, next));
    }
  }
  if (order.length !== scope.size) history = Infinity;
  const duration = systems.get(rootId)!.main!.durationSeconds;
  return {
    history,
    work: capacity * (Math.ceil((Math.ceil(history / duration) * duration) / 0.02) + 2),
  };
}

/** Conservative startup budget, counting each connected pool once per warming root. */
export function instancePrewarmWork(
  systems: ReadonlyMap<number, R<ParticleSystemT>>,
  enabled: ReadonlySet<number>,
): number {
  const edges = (source: R<ParticleSystemT>) =>
    (
      source.modules.find((m) => m.dataType === M.SubEmittersModule)?.data as
        | R<SubEmittersModuleT>
        | undefined
    )?.emitters ?? [];
  let work = 0;
  for (const [id, source] of systems) {
    const main = source.main!;
    if (!enabled.has(id) || !main.prewarm || !main.loop) continue;
    if (!edges(source).some((e) => e.systemComponentId)) {
      work += main.maxParticles * Math.ceil(prewarmDuration(main, source.modules) * 60);
      continue;
    }
    work += graphPrewarmEstimate(id, systems).work;
  }
  return work;
}

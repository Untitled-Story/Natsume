import type { DeepReadonly as R } from '../pack.js';
import type { ParticleSystemT } from '../format/generated/noa/ir/particle-system.js';
import { scalar } from './parameters.js';
import { ParticleModuleData as M } from '../format/generated/noa/ir/particle-module-data.js';
import type { SubEmittersModuleT } from '../format/generated/noa/ir/sub-emitters-module.js';

/** Conservative upper bound of authored birth lifetimes, including curve peaks. */
export function maximumLifetime(main: NonNullable<R<ParticleSystemT>['main']>): number {
  const p = main.lifetime;
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

/** Warm complete cycles until birth lifetimes can reach steady state. */
export function prewarmDuration(main: NonNullable<R<ParticleSystemT>['main']>): number {
  if (!main.prewarm || !main.loop) return 0;
  return Math.ceil(maximumLifetime(main) / main.durationSeconds) * main.durationSeconds;
}

/** Connected warming retains the longest authored lifetime across its shared pools. */
export function graphPrewarmEstimate(
  main: NonNullable<R<ParticleSystemT>['main']>,
  systems: Iterable<R<ParticleSystemT>>,
): { history: number; work: number } {
  let history = 0,
    capacity = 0;
  for (const system of systems) {
    history = Math.max(history, maximumLifetime(system.main!));
    capacity += system.main!.maxParticles;
  }
  return {
    history,
    work:
      capacity *
      Math.ceil((Math.ceil(history / main.durationSeconds) * main.durationSeconds) / 0.02),
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
      work += main.maxParticles * Math.ceil(prewarmDuration(main) * 60);
      continue;
    }
    const scope = new Set([id]);
    for (const current of scope)
      for (const edge of edges(systems.get(current)!))
        if (systems.has(edge.systemComponentId)) scope.add(edge.systemComponentId);
    work += graphPrewarmEstimate(
      main,
      [...scope].map((target) => systems.get(target)!),
    ).work;
  }
  return work;
}

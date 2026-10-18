import type { DeepReadonly as R } from '../pack.js';
import type { ParticleSystemT } from '../format/generated/noa/ir/particle-system.js';
import { scalar } from './parameters.js';

/** Warm complete cycles until constant/ranged birth lifetimes can reach steady state. */
export function prewarmDuration(main: NonNullable<R<ParticleSystemT>['main']>): number {
  if (!main.prewarm || !main.loop) return 0;
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
  return Math.ceil(lifetime / main.durationSeconds) * main.durationSeconds;
}

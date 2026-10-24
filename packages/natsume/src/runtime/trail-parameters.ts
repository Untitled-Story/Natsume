import type { DeepReadonly as R } from '../pack.js';
import type { TrailsModuleT } from '../format/generated/noa/ir/trails-module.js';
import { TrailMode } from '../format/generated/noa/ir/trail-mode.js';
import { TrailTextureMode as T } from '../format/generated/noa/ir/trail-texture-mode.js';
import { scalar, color } from './parameters.js';

/** Trail lifetime is a fraction of start lifetime; size uses its largest axis. */
export function trailLifetime(
  trails: R<TrailsModuleT>,
  particleLifetime: number,
  particleSize: readonly number[],
  birthPhase: number,
  factor: number,
): number {
  return Math.max(
    0,
    scalar(trails.lifetime, birthPhase, factor) *
      particleLifetime *
      (trails.sizeAffectsLifetime ? Math.max(...particleSize) : 1),
  );
}

/** U and V scaling follows the native Ribbon and PerParticle conventions. */
export function trailUV(
  trails: R<TrailsModuleT>,
  distance: number,
  length: number,
  index: number,
  segments: number,
  side: 0 | 1,
  staticOffset = 0,
): readonly [number, number] {
  const ribbon = trails.mode === TrailMode.Ribbon,
    sx = ribbon ? 1 : (trails.textureScale?.x ?? 1),
    sy = trails.textureScale?.y ?? 1,
    phase = length > 0 ? distance / length : 0;
  let u: number;
  switch (trails.textureMode) {
    case T.Tile:
      u = distance;
      break;
    case T.DistributePerSegment:
      u = segments > 0 ? index / segments : 0;
      break;
    case T.RepeatPerSegment:
      u = index;
      break;
    case T.Static:
      u = ribbon ? phase : distance - staticOffset;
      break;
    default:
      u = phase;
  }
  return [u * sx, 0.5 + (side === 0 ? 0.5 : -0.5) * sy];
}

/** Current particle color/size modulate the entire trail; trail phase runs head to tail. */
export function trailAppearance(
  trails: R<TrailsModuleT>,
  particlePhase: number,
  trailPhase: number,
  particleSize: readonly number[],
  particleColor: readonly number[],
  lifetimeRandom: number,
  widthRandom: number,
  trailRandom: number,
  outColor: Float32Array,
  scratch = new Float32Array(4),
): number {
  color(trails.colorOverLifetime, particlePhase, lifetimeRandom, outColor);
  const along = scratch;
  color(trails.colorOverTrail, trailPhase, trailRandom, along);
  for (let i = 0; i < 4; i++) {
    let channel = Math.max(0, Math.min(255, Math.round(outColor[i]! * along[i]! * 255)));
    if (trails.inheritParticleColor)
      channel = Math.round(channel * Math.max(0, Math.min(1, particleColor[i]!)));
    outColor[i] = channel / 255;
  }
  return (
    scalar(trails.widthOverTrail, trailPhase, widthRandom, 1) *
    (trails.sizeAffectsWidth ? Math.max(...particleSize) : 1)
  );
}

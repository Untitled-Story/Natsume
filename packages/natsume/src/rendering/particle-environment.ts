import { Texture } from 'pixi.js';
import { check } from '../errors.js';

export type ParticleFog =
  | { readonly mode: 'none' }
  | {
      readonly mode: 'linear';
      readonly color: readonly [number, number, number];
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly mode: 'exp' | 'exp2';
      readonly color: readonly [number, number, number];
      readonly density: number;
    };

/** Host inputs for Unity legacy particle recipes. Texture ownership stays with the host. */
export interface ParticleEnvironment {
  readonly fog: ParticleFog;
  /** Acceleration in Unity world units per second squared. */
  readonly gravity?: readonly [number, number, number] | undefined;
  /** View translation velocity in Unity world units per second. Omit for a stationary view. */
  readonly viewVelocity?: readonly [number, number, number] | undefined;
  /** View distance, or coefficients ax+by+cz+d in Unity world coordinates. Defaults to container.zIndex; negative distances clamp to zero. */
  readonly depth?: number | readonly [number, number, number, number] | undefined;
  /** Omit to disable soft particles. R stores linear view distance in the same units as depth. */
  readonly softParticles?:
    | {
        readonly depthTexture: Texture;
        /** Maps top-left normalized screen UV: uv * xy + zw. Defaults to [1,1,0,0]. */
        readonly uvTransform?: readonly [number, number, number, number] | undefined;
      }
    | undefined;
}

/** Validates and copies values; the host may update texture contents in place. */
export function copyEnvironment(
  value: ParticleEnvironment | undefined,
): ParticleEnvironment | undefined {
  if (!value) return;
  const f = value.fog;
  check(
    f && ['none', 'linear', 'exp', 'exp2'].includes(f.mode),
    'HOST',
    'Invalid particle fog mode',
  );
  if (f.mode !== 'none') {
    check(
      f.color?.length === 3 && f.color.every((v) => Number.isFinite(v) && v >= 0),
      'HOST',
      'Fog color requires three nonnegative values in source working color space',
    );
    if (f.mode === 'linear')
      check(
        Number.isFinite(f.start) && Number.isFinite(f.end) && f.end > f.start,
        'HOST',
        'Fog end must exceed start',
      );
    else check(Number.isFinite(f.density) && f.density >= 0, 'HOST', 'Invalid fog density');
  }
  const g = value.gravity;
  check(
    g === undefined || (g.length === 3 && g.every(Number.isFinite)),
    'HOST',
    'Invalid particle gravity',
  );
  const d = value.depth;
  const velocity = value.viewVelocity;
  check(
    velocity === undefined || (velocity.length === 3 && velocity.every(Number.isFinite)),
    'HOST',
    'View velocity requires three finite world-space components',
  );
  check(
    d === undefined ||
      (typeof d === 'number' ? Number.isFinite(d) : d.length === 4 && d.every(Number.isFinite)),
    'HOST',
    'Invalid particle depth',
  );
  const soft = value.softParticles;
  if (soft) {
    check(
      soft.depthTexture instanceof Texture &&
        !soft.depthTexture.destroyed &&
        soft.depthTexture.source.format !== 'depth24plus',
      'HOST',
      'Soft particles require a live color texture containing linear depth in R',
    );
    check(
      !soft.uvTransform ||
        (soft.uvTransform.length === 4 && soft.uvTransform.every(Number.isFinite)),
      'HOST',
      'Invalid depth UV transform',
    );
  }
  return {
    fog: f.mode === 'none' ? { mode: 'none' } : { ...f, color: [...f.color] },
    gravity: g ? [...g] : undefined,
    viewVelocity: velocity ? [...velocity] : undefined,
    depth: typeof d === 'number' || d === undefined ? d : [...d],
    softParticles: soft
      ? {
          depthTexture: soft.depthTexture,
          uvTransform: soft.uvTransform ? [...soft.uvTransform] : undefined,
        }
      : undefined,
  };
}

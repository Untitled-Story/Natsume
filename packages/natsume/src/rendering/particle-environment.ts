import { Texture } from 'pixi.js';
import { NatsumeError } from '../errors.js';
import { SupportChecks, assertSupport, type SupportIssue } from '../runtime/support-checks.js';
import { copyForceFields, type ParticleForceFields } from '../runtime/particle-force-fields.js';
import type { ParticlePhysicsWorld, ParticleCollider } from '../runtime/particle-physics.js';
import type { ParticleLightTemplate } from '../runtime/particle-lights.js';

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

/** Host gravity, view, fog and depth inputs. Texture ownership stays with the host. */
export interface ParticleEnvironment {
  readonly fog: ParticleFog;
  /** Unity project fixedDeltaTime in seconds. Required for PauseAndCatchup culling. */
  readonly fixedDeltaSeconds?: number | undefined;
  /** Acceleration in Unity world units per second squared. */
  readonly gravity?: readonly [number, number, number] | undefined;
  /** Physics2D acceleration in Unity world units per second squared. */
  readonly gravity2D?: readonly [number, number] | undefined;
  /** Borrowed force-field services, indexed by source reference or world-search slot. */
  readonly forceFields?: ParticleForceFields | undefined;
  /** Borrowed sphere-sweep services indexed by the package's physics-world slots. */
  readonly physicsWorlds?: Readonly<Record<string, ParticlePhysicsWorld>> | undefined;
  /** Borrowed collider references indexed by source slots. */
  readonly colliders?: Readonly<Record<string, ParticleCollider>> | undefined;
  /** Borrowed templates. Natsume owns only the handles returned by template.create(). */
  readonly lights?: Readonly<Record<string, ParticleLightTemplate>> | undefined;
  /** World-space velocities indexed by the package's host Rigidbody slot. */
  readonly rigidbodyVelocities?:
    | Readonly<Record<string, readonly [number, number, number]>>
    | undefined;
  /** View translation velocity in Unity world units per second. Omit for a stationary view. */
  readonly viewVelocity?: readonly [number, number, number] | undefined;
  /** View origin in Unity world coordinates. Required for Facing alignment and Freeform stretch. */
  readonly viewPosition?: readonly [number, number, number] | undefined;
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

/** Shared structural checks for preflight, creation and atomic replacement. */
export function particleEnvironmentSupport(
  value: ParticleEnvironment | undefined,
): readonly SupportIssue[] {
  if (!value) return [];
  const rules = new SupportChecks();
  const checkField = (condition: unknown, field: keyof ParticleEnvironment, message: string) =>
    rules.require(
      condition,
      'HOST',
      `particleEnvironment.${field}`,
      field === 'softParticles' ? 'invalid depth texture or UV transform' : value[field],
      message,
    );
  checkField(
    value.fixedDeltaSeconds === undefined ||
      (Number.isFinite(value.fixedDeltaSeconds) && value.fixedDeltaSeconds > 0),
    'fixedDeltaSeconds',
    'Particle fixedDeltaSeconds must be finite and positive',
  );
  const f = value.fog;
  checkField(
    f && ['none', 'linear', 'exp', 'exp2'].includes(f.mode),
    'fog',
    'Invalid particle fog mode',
  );
  if (f && f.mode !== 'none') {
    checkField(
      Array.isArray(f.color) &&
        f.color.length === 3 &&
        f.color.every((v) => Number.isFinite(v) && v >= 0),
      'fog',
      'Fog color requires three nonnegative values in source working color space',
    );
    if (f.mode === 'linear')
      checkField(
        Number.isFinite(f.start) && Number.isFinite(f.end) && f.end > f.start,
        'fog',
        'Fog end must exceed start',
      );
    else checkField(Number.isFinite(f.density) && f.density >= 0, 'fog', 'Invalid fog density');
  }
  const g = value.gravity;
  checkField(
    g === undefined || (Array.isArray(g) && g.length === 3 && g.every(Number.isFinite)),
    'gravity',
    'Invalid particle gravity',
  );
  const g2 = value.gravity2D;
  checkField(
    g2 === undefined || (Array.isArray(g2) && g2.length === 2 && g2.every(Number.isFinite)),
    'gravity2D',
    'Invalid Physics2D gravity',
  );
  if (value.rigidbodyVelocities)
    for (const [slot, v] of Object.entries(value.rigidbodyVelocities)) {
      checkField(
        slot.length > 0 && Array.isArray(v) && v.length === 3 && v.every(Number.isFinite),
        'rigidbodyVelocities',
        'Rigidbody velocity requires three finite world-space components',
      );
    }
  const d = value.depth;
  for (const [slot, template] of Object.entries(value.lights ?? {}))
    checkField(
      slot.length > 0 &&
        template &&
        typeof template.create === 'function' &&
        Array.isArray(template.color) &&
        template.color.length === 3 &&
        template.color.every((v) => Number.isFinite(v) && v >= 0) &&
        Number.isFinite(template.range) &&
        template.range >= 0 &&
        Number.isFinite(template.intensity) &&
        template.intensity >= 0,
      'lights',
      'Invalid particle light template',
    );
  for (const [slot, world] of Object.entries(value.physicsWorlds ?? {}))
    checkField(
      slot.length > 0 && world && typeof world.sweepSphere === 'function',
      'physicsWorlds',
      'Invalid particle physics world',
    );
  for (const [slot, collider] of Object.entries(value.colliders ?? {}))
    checkField(
      slot.length > 0 &&
        collider &&
        typeof collider.id === 'string' &&
        collider.id.length > 0 &&
        Number.isInteger(collider.layer) &&
        collider.layer >= 0 &&
        collider.layer < 32 &&
        typeof collider.overlapSphere === 'function' &&
        (collider.sweepSphere === undefined || typeof collider.sweepSphere === 'function') &&
        (collider.applyForce === undefined || typeof collider.applyForce === 'function'),
      'colliders',
      'Invalid particle collider',
    );
  const velocity = value.viewVelocity;
  const position = value.viewPosition;
  checkField(
    position === undefined ||
      (Array.isArray(position) && position.length === 3 && position.every(Number.isFinite)),
    'viewPosition',
    'View position requires three finite world-space components',
  );
  checkField(
    velocity === undefined ||
      (Array.isArray(velocity) && velocity.length === 3 && velocity.every(Number.isFinite)),
    'viewVelocity',
    'View velocity requires three finite world-space components',
  );
  checkField(
    d === undefined ||
      (typeof d === 'number'
        ? Number.isFinite(d)
        : Array.isArray(d) && d.length === 4 && d.every(Number.isFinite)),
    'depth',
    'Invalid particle depth',
  );
  const soft = value.softParticles;
  if (soft) {
    checkField(
      soft.depthTexture instanceof Texture &&
        !soft.depthTexture.destroyed &&
        soft.depthTexture.source.format !== 'depth24plus',
      'softParticles',
      'Soft particles require a live color texture containing linear depth in R',
    );
    checkField(
      !soft.uvTransform ||
        (Array.isArray(soft.uvTransform) &&
          soft.uvTransform.length === 4 &&
          soft.uvTransform.every(Number.isFinite)),
      'softParticles',
      'Invalid depth UV transform',
    );
  }
  try {
    copyForceFields(value.forceFields);
  } catch (error) {
    if (!(error instanceof NatsumeError)) throw error;
    checkField(false, 'forceFields', error.message);
  }
  return rules.issues;
}

/** Validates and copies values; textures and host callbacks stay borrowed. */
export function copyEnvironment(
  value: ParticleEnvironment | undefined,
): ParticleEnvironment | undefined {
  assertSupport(particleEnvironmentSupport(value));
  if (!value) return;
  const {
    fog: f,
    gravity: g,
    gravity2D: g2,
    viewVelocity: velocity,
    viewPosition: position,
    depth: d,
    softParticles: soft,
  } = value;
  const velocities: Record<string, readonly [number, number, number]> = Object.create(null);
  for (const [slot, v] of Object.entries(value.rigidbodyVelocities ?? {}))
    velocities[slot] = [v[0], v[1], v[2]];
  return {
    fog: f.mode === 'none' ? { mode: 'none' } : { ...f, color: [...f.color] },
    fixedDeltaSeconds: value.fixedDeltaSeconds,
    gravity: g ? [g[0], g[1], g[2]] : undefined,
    gravity2D: g2 ? [g2[0], g2[1]] : undefined,
    forceFields: copyForceFields(value.forceFields),
    physicsWorlds: value.physicsWorlds ? { ...value.physicsWorlds } : undefined,
    colliders: value.colliders ? { ...value.colliders } : undefined,
    lights: value.lights ? { ...value.lights } : undefined,
    rigidbodyVelocities: value.rigidbodyVelocities ? velocities : undefined,
    viewVelocity: velocity ? [velocity[0], velocity[1], velocity[2]] : undefined,
    viewPosition: position ? [position[0], position[1], position[2]] : undefined,
    depth: typeof d === 'number' || d === undefined ? d : [...d],
    softParticles: soft
      ? {
          depthTexture: soft.depthTexture,
          uvTransform: soft.uvTransform ? [...soft.uvTransform] : undefined,
        }
      : undefined,
  };
}

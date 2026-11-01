import type { Emitter } from './emitter.js';
import { scalar, random } from './parameters.js';
import { speedSize } from './speed-modules.js';

/** Copied particle state. Positions, velocities and sizes use Unity world units; rotations use radians. */
export interface ParticleSnapshot {
  /** Stable within a system until restart; unaffected by particle-array compaction. */
  readonly id: number;
  readonly position: readonly [number, number, number];
  readonly velocity: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  /** Euler components in the particle's simulation space. */
  readonly rotation: readonly [number, number, number];
  readonly color: readonly [number, number, number, number];
  readonly age: number;
  readonly lifetime: number;
  readonly remainingLifetime: number;
}
type Writable<T> = T extends readonly number[] ? [...T] : T;
export type MutableParticleSnapshot = {
  -readonly [K in keyof ParticleSnapshot]: Writable<ParticleSnapshot[K]>;
};

/** @internal Current module values, evaluated without changing simulation state. */
export function particleSnapshot(
  e: Emitter,
  index: number,
  remainingStep = 0,
  reuse?: MutableParticleSnapshot,
  scratch = new Float32Array(4),
  worldSize = true,
): MutableParticleSnapshot {
  const id = e.serials[index]!,
    o = index * 3,
    m = e.simulationMatrix;
  const x = e.positions[o]!,
    y = e.positions[o + 1]!,
    z = e.positions[o + 2]!;
  const v = e.renderVelocities ?? e.velocities,
    vx = v[o]!,
    vy = v[o + 1]!,
    vz = v[o + 2]!;
  const phase = Math.max(0, Math.min(1, e.ages[index]! / e.lifetimes[index]!));
  const c = scratch,
    size: [number, number, number] = reuse?.size ?? [0, 0, 0];
  e.sampleColor(index, c);
  for (let axis = 0; axis < 3; axis++) {
    const s = e.sizeModule,
      parameter = !s?.separateAxes || axis === 0 ? s?.size?.x : axis === 1 ? s.size?.y : s.size?.z;
    size[axis] =
      e.startSizes[o + axis]! *
      scalar(parameter, phase, random(e.seed, id, 50), 1) *
      (e.sizeBySpeed
        ? speedSize(
            e.sizeBySpeed,
            e.moduleSpeeds?.[index] ?? Math.hypot(vx, vy, vz),
            random(e.seed, id, 73),
            axis,
          )
        : 1) *
      (e.noiseSizes?.[o + axis] ?? 1) *
      (worldSize ? e.particleScale[axis]! : 1);
  }
  const state =
    reuse ??
    ({
      id,
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      size,
      rotation: [0, 0, 0],
      color: [0, 0, 0, 0],
      age: 0,
      lifetime: 0,
      remainingLifetime: 0,
    } as MutableParticleSnapshot);
  state.id = id;
  for (let axis = 0; axis < 3; axis++) {
    state.position[axis] = m[axis]! * x + m[4 + axis]! * y + m[8 + axis]! * z + m[12 + axis]!;
    state.velocity[axis] = m[axis]! * vx + m[4 + axis]! * vy + m[8 + axis]! * vz;
    state.rotation[axis] = e.rotations[o + axis]!;
  }
  for (let axis = 0; axis < 4; axis++) state.color[axis] = c[axis]!;
  state.age = e.ages[index]!;
  state.lifetime = e.lifetimes[index]!;
  state.remainingLifetime = Math.max(0, state.lifetime - state.age - remainingStep);
  return state;
}

/** @internal Unity inherits current module size before applying either system's transform scale. */
export function particleInheritanceSnapshot(e: Emitter, index: number): MutableParticleSnapshot {
  return particleSnapshot(e, index, 0, undefined, undefined, false);
}

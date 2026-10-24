import type { Emitter } from './emitter.js';
import { color, scalar, random } from './parameters.js';
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

/** @internal Current module values, evaluated without changing simulation state. */
export function particleSnapshot(e: Emitter, index: number, remainingStep = 0): ParticleSnapshot {
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
  const c = new Float32Array(4),
    size: [number, number, number] = [0, 0, 0];
  color(e.colorModule?.color ?? null, phase, random(e.seed, id, 53), c);
  for (let axis = 0; axis < 4; axis++) c[axis] = c[axis]! * e.startColors[index * 4 + axis]!;
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
      e.particleScale[axis]!;
  }
  return {
    id,
    position: [
      m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
      m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
      m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
    ],
    velocity: [
      m[0]! * vx + m[4]! * vy + m[8]! * vz,
      m[1]! * vx + m[5]! * vy + m[9]! * vz,
      m[2]! * vx + m[6]! * vy + m[10]! * vz,
    ],
    size,
    rotation: [e.rotations[o]!, e.rotations[o + 1]!, e.rotations[o + 2]!],
    color: [c[0]!, c[1]!, c[2]!, c[3]!],
    age: e.ages[index]!,
    lifetime: e.lifetimes[index]!,
    remainingLifetime: Math.max(0, e.lifetimes[index]! - e.ages[index]! - remainingStep),
  };
}

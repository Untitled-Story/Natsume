import type { EffectPack } from './pack.js';
import type { CanvasEnvironment } from './rendering/canvas-environment.js';
import type { ParticleEnvironment } from './rendering/particle-environment.js';

const CAMERA_Z = -1000;
const NEAR = 0.1;
const FAR = 2000;

/**
 * Canvas inputs for a flat 2D host: one unit is one Pixi logical pixel, viewed from z = -1000
 * along +Z with an orthographic projection. Pair with screenParticleEnvironment.
 */
export function screenCanvasEnvironment(
  width: number,
  height: number,
  display = 0,
): CanvasEnvironment {
  const range = FAR - NEAR;
  return {
    displays: { [display]: { width, height } },
    mainCamera: {
      viewMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, CAMERA_Z, 1],
      projectionMatrix: [
        2 / width,
        0,
        0,
        0,
        0,
        2 / height,
        0,
        0,
        0,
        0,
        -2 / range,
        0,
        0,
        0,
        -(FAR + NEAR) / range,
        1,
      ],
    },
  };
}

/** Particle inputs for a flat 2D host: no fog, Unity's default gravity, view at z = -1000. */
export function screenParticleEnvironment(
  overrides: Partial<ParticleEnvironment> = {},
): ParticleEnvironment {
  return {
    fog: { mode: 'none' },
    fixedDeltaSeconds: 0.02,
    gravity: [0, -9.81, 0],
    viewPosition: [0, 0, CAMERA_Z],
    ...overrides,
  };
}

/** Zero velocities for every host Rigidbody slot the package's particle systems declare. */
export function stationaryRigidbodyVelocities(
  pack: EffectPack,
): Record<string, readonly [number, number, number]> {
  const velocities: Record<string, readonly [number, number, number]> = {};
  for (const system of pack.findComponents('ParticleSystem')) {
    const slot = system.data.main?.hostRigidbodyVelocitySlot;
    if (slot) velocities[String(slot)] = [0, 0, 0];
  }
  return velocities;
}

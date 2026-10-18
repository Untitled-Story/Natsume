import { check } from '../errors.js';
import type { DeepReadonly as R } from '../pack.js';
import type { ShapeModuleT } from '../format/generated/noa/ir/shape-module.js';
import type { CircleShapeT } from '../format/generated/noa/ir/circle-shape.js';
import type { ConeShapeT } from '../format/generated/noa/ir/cone-shape.js';
import type { SphereShapeT } from '../format/generated/noa/ir/sphere-shape.js';
import type { BoxShapeT } from '../format/generated/noa/ir/box-shape.js';
import type { EdgeShapeT } from '../format/generated/noa/ir/edge-shape.js';
import { ShapeGeometry as G } from '../format/generated/noa/ir/shape-geometry.js';
import { scalar, random } from './parameters.js';

export function validateShape(s: R<ShapeModuleT>): void {
  const c = s.geometry;
  check(
    c && s.geometryType >= G.CircleShape && s.geometryType <= G.EdgeShape,
    'CAPABILITY',
    'Unsupported shape',
  );
}

/** Integrates normalized emission-speed curves over elapsed system seconds. */
function travel(
  p: R<import('../format/generated/noa/ir/scalar-parameter.js').ScalarParameterT> | null,
  seconds: number,
  duration: number,
  rnd: number,
): number {
  if (!p || p.mode === 0 || p.mode === 2) return scalar(p, 0, rnd, 1) * seconds;
  const integrate = (end: number) => {
    let sum = 0;
    for (let i = 0; i <= 16; i++)
      sum += scalar(p, (end * i) / 16, rnd) * (i === 0 || i === 16 ? 1 : i % 2 ? 4 : 2);
    return (sum * end) / 48;
  };
  const cycles = Math.floor(seconds / duration),
    phase = seconds / duration - cycles;
  return (cycles * integrate(1) + integrate(phase)) * duration;
}
function sweep(mode: number, distance: number, rnd: number, burst: number, spread: number): number {
  let value =
    mode === 0
      ? rnd
      : mode === 3
        ? burst
        : mode === 2
          ? 1 - Math.abs((((distance % 2) + 2) % 2) - 1)
          : ((distance % 1) + 1) % 1;
  if (spread > 0) value = Math.floor((value + 1e-8) / spread) * spread;
  return Math.max(0, Math.min(1, value));
}

/** Samples local position and unit direction into six scalars, before Shape TRS. */
export function sampleShape(
  s: R<ShapeModuleT>,
  seed: number,
  serial: number,
  phase: number,
  index: number,
  count: number,
  out: Float64Array,
  seconds = phase,
  duration = 1,
): void {
  const rnd = (ch: number) => random(seed, serial, ch);
  let x = 0,
    y = 0,
    z = 0,
    dx = 0,
    dy = 0,
    dz = 1;
  switch (s.geometryType) {
    case G.CircleShape:
    case G.ConeShape: {
      const c = s.geometry as R<CircleShapeT | ConeShapeT>;
      const divisor = Math.max(1, count - (Math.abs(c.arcRadians - Math.PI * 2) < 1e-6 ? 0 : 1));
      const arcTravel = travel(c.arcSpeed, seconds, duration, random(seed, 0, 71)) * Math.PI * 2;
      const angle =
        sweep(
          c.arcMode,
          c.arcRadians > 0 ? arcTravel / c.arcRadians : 0,
          rnd(1),
          index / divisor,
          c.arcSpread,
        ) * c.arcRadians;
      const outer = Math.max(0, scalar(c.radius, phase, rnd(2)));
      const inner =
        s.geometryType === G.ConeShape ? Math.sqrt(1 - c.radiusThickness) : 1 - c.radiusThickness;
      const radiusTravel = travel(c.radiusSpeed, seconds, duration, random(seed, 0, 72)) * 0.5;
      const radialSample = sweep(
        c.radiusMode,
        radiusTravel,
        rnd(3),
        index / Math.max(1, count - 1),
        c.radiusSpread,
      );
      const fraction = Math.sqrt(inner * inner + (1 - inner * inner) * radialSample);
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      dz = 0;
      x = dx * outer * fraction;
      y = dy * outer * fraction;
      if (s.geometryType === G.ConeShape) {
        const cone = c as R<ConeShapeT>;
        // Native cone direction is normalized (radial * tan(angle), 1).
        // sin/cos form stays finite at 90 degrees and at zero radius.
        const radial = fraction * Math.sin(cone.angleRadians),
          axial = Math.cos(cone.angleRadians);
        const length = Math.hypot(radial, axial);
        dx *= length > 1e-12 ? radial / length : 0;
        dy *= length > 1e-12 ? radial / length : 0;
        dz = length > 1e-12 ? axial / length : 1;
        if (cone.region === 1) {
          const distance = rnd(14) * cone.length;
          x += dx * distance;
          y += dy * distance;
          z += dz * distance;
        }
      }
      break;
    }
    case G.SphereShape: {
      const c = s.geometry as R<SphereShapeT>;
      dz = c.hemisphere ? rnd(1) : rnd(1) * 2 - 1;
      const angle = rnd(2) * Math.PI * 2,
        planar = Math.sqrt(Math.max(0, 1 - dz * dz));
      dx = Math.cos(angle) * planar;
      dy = Math.sin(angle) * planar;
      const inner = 1 - c.radiusThickness;
      const radius =
        Math.max(0, scalar(c.radius, phase, rnd(14))) *
        Math.cbrt(inner ** 3 + (1 - inner ** 3) * rnd(3));
      x = dx * radius;
      y = dy * radius;
      z = dz * radius;
      break;
    }
    case G.BoxShape: {
      const b = s.geometry as R<BoxShapeT>;
      x = rnd(1) - 0.5;
      y = rnd(2) - 0.5;
      z = rnd(3) - 0.5;
      if (b.region !== 0) {
        const axis = Math.min(2, Math.floor(rnd(14) * 3));
        if (b.region === 1) {
          if (axis === 0) x = rnd(15) < 0.5 ? -0.5 : 0.5;
          if (axis === 1) y = rnd(15) < 0.5 ? -0.5 : 0.5;
          if (axis === 2) z = rnd(15) < 0.5 ? -0.5 : 0.5;
        } else {
          if (axis !== 0) x = rnd(15) < 0.5 ? -0.5 : 0.5;
          if (axis !== 1) y = rnd(16) < 0.5 ? -0.5 : 0.5;
          if (axis !== 2) z = rnd(17) < 0.5 ? -0.5 : 0.5;
        }
        // Unity 2022.3 shell/edge thickness shrinks towards the negative corner.
        x -= (x + 0.5) * b.thickness!.x * rnd(18);
        y -= (y + 0.5) * b.thickness!.y * rnd(19);
        z -= (z + 0.5) * b.thickness!.z * rnd(23);
      }
      break;
    }
    case G.EdgeShape: {
      const c = s.geometry as R<EdgeShapeT>;
      const u = sweep(
        c.mode,
        travel(c.speed, seconds, duration, random(seed, 0, 73)) * 0.5,
        rnd(1),
        index / Math.max(1, count - 1),
        c.spread,
      );
      x = (u * 2 - 1) * Math.max(0, scalar(c.halfLength, phase, rnd(2)));
      // Actual 2022.3 SingleSidedEdge points +Y; upstream's +Z comment is inaccurate.
      dy = 1;
      dz = 0;
      break;
    }
  }
  if (s.sphericalDirection) {
    const length = Math.hypot(x, y, z);
    if (length > 1e-12) {
      dx += (x / length - dx) * s.sphericalDirection;
      dy += (y / length - dy) * s.sphericalDirection;
      dz += (z / length - dz) * s.sphericalDirection;
    }
  }
  if (s.randomDirection) {
    const h = rnd(24) * 2 - 1,
      a = rnd(25) * Math.PI * 2,
      planar = Math.sqrt(Math.max(0, 1 - h * h));
    dx += (Math.cos(a) * planar - dx) * s.randomDirection;
    dy += (Math.sin(a) * planar - dy) * s.randomDirection;
    dz += (h - dz) * s.randomDirection;
  }
  const norm = Math.hypot(dx, dy, dz);
  if (norm > 1e-12) {
    dx /= norm;
    dy /= norm;
    dz /= norm;
  } else {
    dx = dy = 0;
    dz = 1;
  }
  if (s.randomPosition) {
    const h = rnd(12) * 2 - 1,
      a = rnd(13) * Math.PI * 2,
      planar = Math.sqrt(Math.max(0, 1 - h * h));
    x += Math.cos(a) * planar * s.randomPosition;
    y += Math.sin(a) * planar * s.randomPosition;
    z += h * s.randomPosition;
  }
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = dx;
  out[4] = dy;
  out[5] = dz;
}

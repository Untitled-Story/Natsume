import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ParticleTrails } from '../src/runtime/particle-trails.js';
import { TrailPointPool } from '../src/runtime/trail-point-pool.js';
import { TrailsModuleT } from '../src/format/generated/noa/ir/trails-module.js';
import { Emitter } from '../src/runtime/emitter.js';
import { Scene } from '../src/runtime/scene.js';
import { EffectPack } from '../src/pack.js';
import { minimalDocument } from './helpers.js';
import { constant, particleSource, vector } from './particle-fixtures.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';
import { BurstT } from '../src/format/generated/noa/ir/burst.js';
import { TrailGeometry } from '../src/rendering/trail-geometry.js';
import { Vec2T } from '../src/format/generated/noa/ir/vec2.js';
import { ColorParameterT } from '../src/format/generated/noa/ir/color-parameter.js';
import { ColorT } from '../src/format/generated/noa/ir/color.js';
import { linear } from './particle-fixtures.js';
import { recordError } from './measurement.js';
import { GradientT } from '../src/format/generated/noa/ir/gradient.js';
import { RgbKeyT } from '../src/format/generated/noa/ir/rgb-key.js';
import { AlphaKeyT } from '../src/format/generated/noa/ir/alpha-key.js';
import { particleSnapshot } from '../src/runtime/particle-snapshot.js';

function fixture(
  mode = 0,
  worldSpace = false,
  dieWithParticles = false,
  limit = 65536,
  attach = false,
  split = false,
) {
  const pack = new EffectPack(minimalDocument(), { files: [] } as never, new Map(), new Map());
  const scene = new Scene(pack, [1]),
    source = particleSource();
  source.main!.lifetime = constant(0.5);
  source.main!.size = vector(2, 2, 2);
  source.modules.push(
    new ParticleModuleT(
      M.EmissionModule,
      new EmissionModuleT(constant(0), constant(0), [
        new BurstT(0, constant(mode === 1 ? 5 : 1), 1, 0, 1),
      ]),
    ),
  );
  const emitter = new Emitter(3, scene.nodes.get(1)!, source, true, 12345, []);
  const definition = new TrailsModuleT();
  definition.mode = mode;
  definition.worldSpace = worldSpace;
  definition.dieWithParticles = dieWithParticles;
  definition.lifetime = constant(0.4);
  definition.minVertexDistance = 0.1;
  definition.ribbonCount = 2;
  definition.attachRibbonsToTransform = attach;
  definition.splitSubEmitterRibbons = split;
  const pool = new TrailPointPool(limit),
    trails = new ParticleTrails(emitter, definition, pool);
  emitter.sync();
  for (let i = 0; i < emitter.count; i++) emitter.velocities.set([1, 0, 0], i * 3);
  return { emitter, definition, pool, trails, source };
}
function centers(trails: ParticleTrails) {
  const strips: number[][][] = [];
  let points: number[][] = [];
  trails.visit((_, point, x, y, z) => {
    if (point < 0) {
      strips.push(points);
      points = [];
    } else points.push([x, y, z]);
  });
  return strips;
}

it('retains independent history after death, frees expired points and reuses storage on restart', () => {
  const { emitter, trails, pool } = fixture();
  for (let i = 0; i < 9; i++) emitter.step(0.05);
  expect(pool.count).toBeGreaterThan(2);
  emitter.step(0.1);
  expect(emitter.count).toBe(0);
  expect(trails.records.size).toBe(1);
  expect(centers(trails)[0]!.length).toBeGreaterThan(1);
  for (let i = 0; i < 10; i++) emitter.step(0.05);
  expect(trails.records.size).toBe(0);
  expect(pool.count).toBe(0);
  const capacity = pool.capacity;
  emitter.reset();
  emitter.sync();
  emitter.step(0.05);
  expect(pool.capacity).toBe(capacity);
  emitter.clear();
  expect(pool.count).toBe(0);
});

it('drops die-with-particle histories and atomically releases an incomplete first allocation', () => {
  const a = fixture(0, false, true);
  a.emitter.step(0.05);
  a.emitter.step(0.6);
  expect(a.pool.count).toBe(0);
  const b = fixture(0, false, false, 1);
  expect(() => b.emitter.step(0.01)).toThrow('maxTrailPoints');
  expect(b.pool.count).toBe(0);
  expect(b.trails.records.size).toBe(0);
});

it('recycles expired anchors before allocating and does not allocate zero-lifetime history', () => {
  const a = fixture(0, false, false, 5);
  a.source.main!.lifetime = constant(10);
  a.emitter.reset();
  a.emitter.sync();
  a.emitter.velocities.set([1, 0, 0]);
  a.definition.lifetime = constant(0.02);
  for (let i = 0; i < 300; i++) a.emitter.step(0.025);
  expect(a.pool.count).toBeLessThanOrEqual(5);
  expect(centers(a.trails)[0]!.length).toBeGreaterThan(1);
  a.emitter.clear();
  expect(a.pool.count).toBe(0);
  const b = fixture(0, false, false, 1);
  b.definition.lifetime = constant(0);
  b.emitter.step(0.05);
  expect(b.pool.count).toBe(0);
});

it('redistributes Ribbon after compacting dead particle slots and releases history', () => {
  const { emitter, trails, pool, source } = fixture(1);
  expect(centers(trails).map((s) => s.length)).toEqual([3, 2]);
  expect(pool.count).toBe(5);
  const parent = particleSnapshot(emitter, 0);
  emitter.clear();
  for (let i = 0; i < 5; i++) {
    source.main!.lifetime = constant(i === 1 ? 1e-5 : 0.5);
    emitter.emitSubParticles(1, 0, 0, parent, 0);
  }
  emitter.step(0.01);
  expect(centers(trails).map((s) => s.length)).toEqual([2, 2]);
  emitter.step(0.6);
  expect(pool.count).toBe(0);
});

it('uses ratio only for per-particle trails, including after restart', () => {
  for (const mode of [0, 1]) {
    const { emitter, definition, trails } = fixture(mode);
    definition.ratio = 0;
    emitter.reset();
    emitter.sync();
    emitter.step(0.01);
    expect(trails.records.size).toBe(mode === 1 ? 5 : 0);
  }
});

it('accounts for transform attachment points in the budget and omits unattached particles from split ribbons', () => {
  const a = fixture(1, false, false, 65536, true);
  expect(centers(a.trails).map((s) => s.length)).toEqual([4, 3]);
  expect(a.pool.count).toBe(7);
  a.emitter.clear();
  expect(a.pool.count).toBe(0);
  const b = fixture(1, false, false, 65536, false, true);
  expect(b.trails.records.size).toBe(0);
  expect(b.pool.count).toBe(0);
});

interface NativeCase {
  mode: number;
  texture: number;
  flags: number;
  samples: {
    frame: number;
    vertices: { x: number; y: number; z: number }[];
    uv: { x: number; y: number }[];
    colors: { r: number; g: number; b: number; a: number }[];
  }[];
}
const nativePath = new URL(
  '../../../data/unity-baselines/trails/unity-2022.3.21f1.json',
  import.meta.url,
);
it.skipIf(!existsSync(nativePath))(
  'matches independently sampled attached folds across width and particle-size multipliers',
  () => {
    const { folds } = JSON.parse(readFileSync(nativePath, 'utf8')) as {
      folds: {
        spacing: number;
        ratio: number;
        shift: number;
        width: number;
        sizeWidth: boolean;
        vertices: { x: number; y: number; z: number }[];
      }[];
    };
    let maximum = 0,
      relative = 0,
      compared = 0;
    expect(folds).toHaveLength(984);
    for (const c of folds) {
      const { emitter, trails, definition } = fixture(1, false, false, 65536, true);
      definition.sizeAffectsWidth = c.sizeWidth;
      definition.ratio = c.ratio;
      emitter.reset();
      emitter.sync();
      definition.widthOverTrail = linear(0.5, 1.5);
      definition.widthOverTrail.multiplier = c.width;
      emitter.velocities.fill(0);
      for (let i = 0; i < emitter.count; i++)
        emitter.positions.set(
          [
            Math.fround(Math.fround(i * Math.fround(c.spacing)) + c.shift),
            (i % 2) * Math.fround(0.2),
            0,
          ],
          i * 3,
        );
      emitter.step(1e-6);
      const geometry = new TrailGeometry();
      geometry.update(trails);
      expect(geometry.vertexCount).toBe(c.vertices.length);
      const degenerate = new Set<number>();
      let start = 0;
      for (const strip of centers(trails)) {
        const a = strip[0]!,
          b = strip[1]!;
        const direction = b.map((v, axis) => v - a[axis]!);
        const collinear = strip.every((p) => {
          const d = p.map((v, axis) => v - a[axis]!);
          return (
            Math.hypot(
              direction[1]! * d[2]! - direction[2]! * d[1]!,
              direction[2]! * d[0]! - direction[0]! * d[2]!,
              direction[0]! * d[1]! - direction[1]! * d[0]!,
            ) < 1e-8
          );
        });
        if (collinear) for (let j = start; j < start + strip.length * 2; j++) degenerate.add(j);
        start += strip.length * 2;
      }
      for (let i = 0; i < geometry.vertexCount; i++) {
        const expected = c.vertices[i]!,
          opposite = c.vertices[i ^ 1]!;
        const width = Math.hypot(
          expected.x - opposite.x,
          expected.y - opposite.y,
          expected.z - opposite.z,
        );
        let squared = 0;
        for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
          const error = Math.abs(geometry.vertices[i * 10 + axis]! - expected[key]);
          squared += error * error;
        }
        // Exact collinear reversals have no unique left/right orientation. Native
        // Float32 normalization can exchange an otherwise identical vertex pair.
        const offset = i * 10,
          swapped = Math.hypot(
            geometry.vertices[offset]! - opposite.x,
            geometry.vertices[offset + 1]! - opposite.y,
            geometry.vertices[offset + 2]! - opposite.z,
          );
        const distance = degenerate.has(i)
          ? Math.min(Math.sqrt(squared), swapped)
          : Math.sqrt(squared);
        maximum = Math.max(maximum, distance);
        const error = distance / width;
        relative = Math.max(relative, error);
        expect(
          error,
          `shift=${c.shift} width=${c.width} size=${c.sizeWidth} vertex=${i}`,
        ).toBeLessThan(0.1);
        compared++;
      }
    }
    recordError(
      'trail.fold.independent.position',
      maximum,
      'scene units',
      `${folds.length} cases, ${compared} vertices`,
    );
    recordError(
      'trail.fold.independent.relative',
      relative,
      'full trail width',
      `${folds.length} cases, ${compared} vertices`,
    );
  },
);
it.skipIf(!existsSync(nativePath))(
  'matches native live-history centers and lifetime tail clipping',
  () => {
    const { cases } = JSON.parse(readFileSync(nativePath, 'utf8')) as { cases: NativeCase[] };
    for (const c of cases.filter(
      (c) => c.mode === 0 && c.texture === 0 && [0, 16].includes(c.flags),
    )) {
      const { emitter, trails } = fixture(0, Boolean(c.flags & 16));
      for (let frame = 1; frame <= 9; frame++) {
        if (frame === 4) {
          emitter.node.worldMatrix[12] = 1;
          emitter.node.worldMatrix[13] = 2;
          emitter.updateSpace();
        }
        emitter.step(0.05);
        const sample = c.samples.find((s) => s.frame === frame);
        if (!sample) continue;
        const actual = centers(trails)[0]!;
        const expected = sample.vertices
          .filter((_, i) => i % 2 === 0)
          .map((p, i) => {
            const q = sample.vertices[i * 2 + 1]!;
            return [
              (p.x + q.x) / 2 + (frame >= 4 && !(c.flags & 16) ? 1 : 0),
              (p.y + q.y) / 2 + (frame >= 4 && !(c.flags & 16) ? 2 : 0),
              (p.z + q.z) / 2,
            ];
          });

        expect(actual.length, `flags=${c.flags}, frame=${frame}`).toBe(expected.length);
        for (let i = 0; i < actual.length; i++)
          for (let axis = 0; axis < 3; axis++)
            expect(
              Math.abs(actual[i]![axis]! - expected[i]![axis]!),
              `flags=${c.flags}, frame=${frame},point=${i},axis=${axis}`,
            ).toBeLessThan(2e-5);
      }
    }
  },
);

it.skipIf(!existsSync(nativePath))(
  'matches native PerParticle and Ribbon geometry through turns, transforms and tail clipping',
  () => {
    const { cases } = JSON.parse(readFileSync(nativePath, 'utf8')) as {
      cases: NativeCase[];
    };
    let positionError = 0,
      uvError = 0,
      colorError = 0,
      comparisons = 0,
      relativeError = 0,
      foldError = 0,
      foldRelativeError = 0,
      foldVertices = 0;
    for (const c of cases.filter((c) =>
      [0, 1, 2, 4, 8, 16, 31, 128, 512, 1024].includes(c.flags),
    )) {
      const { emitter, trails, definition } = fixture(
        c.mode,
        Boolean(c.flags & 16),
        Boolean(c.flags & 8),
        65536,
        Boolean(c.flags & 128),
      );
      definition.textureMode = c.texture;
      definition.textureScale = new Vec2T(1.5, 0.75);
      definition.sizeAffectsLifetime = Boolean(c.flags & 1);
      definition.sizeAffectsWidth = Boolean(c.flags & 2);
      definition.inheritParticleColor = Boolean(c.flags & 4);
      definition.colorOverLifetime = new ColorParameterT(0, null, new ColorT(0.5, 0.6, 0.7, 0.5));
      definition.colorOverTrail = new ColorParameterT(0, null, new ColorT(0.8, 0.6, 0.4, 0.9));
      definition.widthOverTrail = linear(0.5, 1.5);
      if (c.flags & 512) definition.minVertexDistance = 0.01;
      for (let i = 0; i < emitter.count; i++) {
        emitter.startColors.set([0.2, 0.4, 0.6, 0.8], i * 4);
        if (c.mode === 1)
          emitter.positions.set([i * 0.3, (i % 2) * 0.2, c.flags & 512 ? i * i * 0.1 : 0], i * 3);
        if (c.flags & 1024) emitter.velocities.set([1, 0.5, 0.75], i * 3);
      }
      const geometry = new TrailGeometry();
      for (let frame = 1; frame <= 9; frame++) {
        if (frame === 4) {
          emitter.node.worldMatrix[12] = 1;
          emitter.node.worldMatrix[13] = 2;
          emitter.updateSpace();
        }
        if (c.mode === 0 && c.flags & 512)
          emitter.velocities.set(frame % 2 ? [1, 0, 0] : [0, 1, 0]);
        emitter.step(0.05);
        geometry.update(trails);
        const sample = c.samples.find((s) => s.frame === frame);
        if (!sample) continue;
        // Keep the previously divergent folds as an independently bounded measurement.
        const fold =
          (c.mode === 0 && c.flags === 31 && frame > 3) || (c.mode === 1 && c.flags === 128);
        expect(geometry.vertexCount, `flags=${c.flags} frame=${frame}`).toBe(
          sample.vertices.length,
        );
        for (let i = 0; i < geometry.vertexCount; i++) {
          if (fold) foldVertices++;
          else comparisons++;
          const offset = i * 10,
            expected = sample.vertices[i]!;
          const opposite = sample.vertices[i ^ 1]!;
          const width = Math.hypot(
            expected.x - opposite.x,
            expected.y - opposite.y,
            expected.z - opposite.z,
          );
          let squared = 0;
          for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
            const position =
              expected[key] +
              (frame >= 4 && (c.mode === 1 || !(c.flags & 16)) ? [1, 2, 0][axis]! : 0);
            const error = Math.abs(geometry.vertices[offset + axis]! - position);
            squared += error * error;
            if (fold) {
              foldError = Math.max(foldError, error);
              expect(error).toBeLessThan(2e-5);
            } else {
              positionError = Math.max(positionError, error);
              expect(
                error,
                `mode=${c.mode} flags=${c.flags} frame=${frame} vertex=${i} axis=${axis}`,
              ).toBeLessThan(c.flags & 512 ? (c.mode === 1 ? width * 0.1 : 1e-3) : 2e-5);
            }
          }
          if (width > 1e-6) {
            const relative = Math.sqrt(squared) / width;
            if (fold) {
              foldRelativeError = Math.max(foldRelativeError, relative);
              expect(relative).toBeLessThan(0.1);
            } else {
              relativeError = Math.max(relativeError, relative);
              expect(relative).toBeLessThan(0.1);
            }
          }
          uvError = Math.max(
            uvError,
            Math.abs(geometry.vertices[offset + 3]! - sample.uv[i]!.x),
            Math.abs(geometry.vertices[offset + 4]! - sample.uv[i]!.y),
          );
          expect(Math.abs(geometry.vertices[offset + 3]! - sample.uv[i]!.x)).toBeLessThan(2e-5);
          expect(Math.abs(geometry.vertices[offset + 4]! - sample.uv[i]!.y)).toBeLessThan(2e-5);
          for (const [channel, key] of (['r', 'g', 'b', 'a'] as const).entries()) {
            colorError = Math.max(
              colorError,
              Math.abs(geometry.vertices[offset + 5 + channel]! * 255 - sample.colors[i]![key]),
            );
            expect(
              Math.abs(geometry.vertices[offset + 5 + channel]! * 255 - sample.colors[i]![key]),
              `flags=${c.flags} frame=${frame} channel=${channel}`,
            ).toBeLessThan(0.01);
          }
        }
      }
      const vertices = geometry.vertices;
      geometry.update(trails);
      expect(geometry.vertices).toBe(vertices);
    }
    recordError(
      'trail.geometry.position',
      positionError,
      'scene units',
      `${comparisons} accepted trail vertices; folds measured separately`,
    );
    recordError(
      'trail.geometry.uv',
      uvError,
      'UV units',
      `${comparisons + foldVertices} trail vertices`,
    );
    recordError(
      'trail.geometry.color',
      colorError,
      '/255',
      `${comparisons + foldVertices} trail vertices`,
    );
    recordError(
      'trail.geometry.relative',
      relativeError,
      'full trail width',
      `${comparisons} accepted trail vertices`,
    );
    recordError('trail.fold.position', foldError, 'scene units', `${foldVertices} fold vertices`);
    recordError(
      'trail.fold.relative',
      foldRelativeError,
      'full trail width',
      `${foldVertices} fold vertices`,
    );
  },
);

it.skipIf(!existsSync(nativePath))(
  'measures Ribbon geometry with independent perspective views and per-particle widths',
  () => {
    const { advanced } = JSON.parse(readFileSync(nativePath, 'utf8')) as {
      advanced: {
        view: { x: number; y: number; z: number };
        layout: number;
        sizes: number;
        width: number;
        centers: { x: number; y: number; z: number }[];
        particleSizes: number[];
        vertices: { x: number; y: number; z: number }[];
        normals: { x: number; y: number; z: number }[];
        tangents: { x: number; y: number; z: number; w: number }[];
      }[];
    };
    expect(advanced).toHaveLength(54);
    let maximum = 0,
      relative = 0,
      compared = 0,
      lighting = 0;
    for (const c of advanced) {
      const { emitter, trails, definition, source } = fixture(1);
      source.main!.size = vector(1, 1, 1);
      definition.ribbonCount = 1;
      definition.sizeAffectsWidth = true;
      definition.widthOverTrail = constant(c.width);
      emitter.reset();
      emitter.sync();
      emitter.velocities.fill(0);
      for (let i = 0; i < emitter.count; i++) {
        const p = c.centers[i]!;
        emitter.positions.set([p.x, p.y, p.z], i * 3);
        emitter.startSizes.fill(c.particleSizes[i]!, i * 3, i * 3 + 3);
      }
      emitter.step(1e-6);
      const geometry = new TrailGeometry();
      const forward = [-c.view.x, -c.view.y, -c.view.z];
      const length = Math.hypot(...forward);
      for (let axis = 0; axis < 3; axis++) forward[axis]! /= length;
      const right = [forward[2]!, 0, -forward[0]!];
      const horizontal = Math.hypot(...right);
      for (let axis = 0; axis < 3; axis++) right[axis]! /= horizontal;
      const up = [
        forward[1]! * right[2]!,
        forward[2]! * right[0]! - forward[0]! * right[2]!,
        -forward[1]! * right[0]!,
      ];
      geometry.update(
        trails,
        [c.view.x, c.view.y, c.view.z],
        [
          right[0]!,
          up[0]!,
          forward[0]!,
          0,
          right[1]!,
          up[1]!,
          forward[1]!,
          0,
          right[2]!,
          up[2]!,
          forward[2]!,
          0,
          0,
          0,
          0,
          1,
        ],
      );
      expect(geometry.vertexCount).toBe(c.vertices.length);
      for (let i = 0; i < geometry.vertexCount; i++) {
        const p = c.vertices[i]!,
          q = c.vertices[i ^ 1]!;
        const distance = Math.hypot(
          geometry.vertices[i * 10]! - p.x,
          geometry.vertices[i * 10 + 1]! - p.y,
          geometry.vertices[i * 10 + 2]! - p.z,
        );
        const width = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
        maximum = Math.max(maximum, distance);
        relative = Math.max(relative, distance / width);
        expect(
          distance / width,
          `layout=${c.layout} sizes=${c.sizes} width=${c.width} view=${JSON.stringify(c.view)} vertex=${i}`,
        ).toBeLessThan(0.1);
        for (let axis = 0; axis < 3; axis++) {
          const key = (['x', 'y', 'z'] as const)[axis]!;
          lighting = Math.max(
            lighting,
            Math.abs(geometry.streams[i * 15 + axis]! - c.normals[i]![key]),
            Math.abs(geometry.streams[i * 15 + 3 + axis]! - c.tangents[i]![key]),
          );
        }
        expect(lighting).toBeLessThan(0.01);
        compared++;
      }
    }
    recordError(
      'trail.view-width.lighting',
      lighting,
      'normal / tangent component',
      `${compared} vertices`,
    );
    recordError(
      'trail.view-width.position',
      maximum,
      'scene units',
      `${advanced.length} cases, ${compared} vertices`,
    );
    recordError(
      'trail.view-width.relative',
      relative,
      'full trail width',
      `${advanced.length} cases, ${compared} vertices`,
    );
  },
);

it.skipIf(!existsSync(nativePath))(
  'matches native Ribbon links across parent and child deaths',
  () => {
    type Point = { x: number; y: number; z: number };
    const { groups } = JSON.parse(readFileSync(nativePath, 'utf8')) as {
      groups: {
        split: boolean;
        attach: boolean;
        ribbons: number;
        parentDead: boolean;
        childDead: boolean;
        particles: Point[];
        vertices: Point[];
        indices: number[];
        candidateVertices?: Point[];
        candidateIndices?: number[];
        candidateMismatches: number;
        livePixels: number;
      }[];
    };
    expect(groups).toHaveLength(24);
    let compared = 0;
    for (const c of groups) {
      // Candidate geometry was rendered by Unity with the same camera and material.
      if (!c.candidateVertices || !c.candidateIndices) continue;
      expect(c.livePixels).toBeGreaterThan(0);
      expect(c.candidateMismatches).toBe(0);
      const { emitter, trails, definition, source } = fixture(
        1,
        false,
        false,
        65536,
        c.attach,
        c.split,
      );
      const parent = particleSnapshot(emitter, 0);
      emitter.clear();
      definition.ribbonCount = c.ribbons;
      definition.sizeAffectsWidth = false;
      definition.widthOverTrail = constant(0.25);
      for (let i = 0; i < 6; i++) {
        source.main!.lifetime = constant(c.childDead && i === 1 ? 1e-5 : 2);
        emitter.emitSubParticles(
          1,
          0,
          0,
          { ...parent, id: i < 3 ? 1 : 2, position: [0, 0, 0] },
          0,
          0,
          0,
          7,
        );
        emitter.positions.set([i * 0.4, (i % 2) * 0.2, 0], i * 3);
        emitter.velocities.fill(0, i * 3, i * 3 + 3);
        emitter.startSizes.fill(1, i * 3, i * 3 + 3);
      }
      emitter.step(c.parentDead ? 0.11 : 1e-6);
      const geometry = new TrailGeometry();
      geometry.update(trails);
      const actual: Point[] = [];
      for (let i = 0; i < geometry.vertexCount; i++)
        actual.push({
          x: geometry.vertices[i * 10]!,
          y: geometry.vertices[i * 10 + 1]!,
          z: geometry.vertices[i * 10 + 2]!,
        });
      expect(geometry.indexCount).toBe(c.candidateIndices.length);
      expect(Array.from(geometry.indices.subarray(0, geometry.indexCount))).toEqual(
        c.candidateIndices,
      );
      expect(actual.length).toBe(c.candidateVertices.length);
      for (let i = 0; i < actual.length; i++)
        for (const key of ['x', 'y', 'z'] as const)
          expect(Math.abs(actual[i]![key] - c.candidateVertices[i]![key])).toBeLessThan(1e-6);
      emitter.clear();
      expect(trails.pool.count).toBe(0);
      compared++;
    }
    recordError(
      'trail.ribbon.parent-pixels',
      0,
      'pixel mismatches',
      `${compared} parent / child death cases`,
    );
  },
);

it.skipIf(!existsSync(nativePath))(
  'measures perspective PerParticle turns and retained gradient endpoints',
  () => {
    type Point = { x: number; y: number; z: number };
    const { motion } = JSON.parse(readFileSync(nativePath, 'utf8')) as {
      motion: {
        view: Point;
        die: boolean;
        width: number;
        frame: number;
        vertices: Point[];
        uv: { x: number; y: number }[];
        colors: { r: number; g: number; b: number; a: number }[];
      }[];
    };
    expect(motion).toHaveLength(96);
    let relative = 0,
      absolute = 0,
      uv = 0,
      color = 0,
      compared = 0;
    const gradient = (a: number[], b: number[]) =>
      new ColorParameterT(
        1,
        null,
        null,
        null,
        new GradientT(
          0,
          [new RgbKeyT(0, a[0]!, a[1]!, a[2]!), new RgbKeyT(1, b[0]!, b[1]!, b[2]!)],
          [new AlphaKeyT(0, a[3]!), new AlphaKeyT(1, b[3]!)],
        ),
      );
    for (const c of motion) {
      const { emitter, trails, definition, source } = fixture(0, false, c.die);
      emitter.reset();
      source.main!.size = vector(1, 1, 1);
      emitter.sync();
      emitter.enableLifetimeProgress();
      definition.lifetime = constant(1);
      definition.minVertexDistance = 0.01;
      definition.sizeAffectsWidth = false;
      definition.widthOverTrail = constant(c.width);
      definition.colorOverLifetime = gradient([1, 0, 0, 1], [0, 0, 1, 1]);
      definition.colorOverTrail = gradient([1, 1, 1, 1], [0.5, 1, 0.5, 0.5]);
      for (let frame = 1; frame <= c.frame; frame++) {
        emitter.velocities.set([1, 0.5, 0.75]);
        emitter.step(0.05);
      }
      const forward = [-c.view.x, -c.view.y, -c.view.z];
      const length = Math.hypot(...forward);
      for (let axis = 0; axis < 3; axis++) forward[axis]! /= length;
      const right = [forward[2]!, 0, -forward[0]!];
      const horizontal = Math.hypot(...right);
      for (let axis = 0; axis < 3; axis++) right[axis]! /= horizontal;
      const up = [
        forward[1]! * right[2]!,
        forward[2]! * right[0]! - forward[0]! * right[2]!,
        -forward[1]! * right[0]!,
      ];
      const geometry = new TrailGeometry();
      geometry.update(
        trails,
        [c.view.x, c.view.y, c.view.z],
        [
          right[0]!,
          up[0]!,
          forward[0]!,
          0,
          right[1]!,
          up[1]!,
          forward[1]!,
          0,
          right[2]!,
          up[2]!,
          forward[2]!,
          0,
          0,
          0,
          0,
          1,
        ],
      );
      const unique = (count: number, point: (i: number) => Point) => {
        const result: number[] = [];
        for (let i = 0; i < count; i += 2) {
          const a = point(i),
            b = point(i + 1);
          const center = [(a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5];
          if (result.length) {
            const j = result[result.length - 2]!,
              p = point(j),
              q = point(j + 1);
            if (
              Math.hypot(
                center[0]! - (p.x + q.x) * 0.5,
                center[1]! - (p.y + q.y) * 0.5,
                center[2]! - (p.z + q.z) * 0.5,
              ) < 1e-6
            )
              continue;
          }
          result.push(i, i + 1);
        }
        return result;
      };
      const actual = (i: number) => ({
        x: geometry.vertices[i * 10]!,
        y: geometry.vertices[i * 10 + 1]!,
        z: geometry.vertices[i * 10 + 2]!,
      });
      const left = unique(geometry.vertexCount, actual),
        rightIndices = unique(c.vertices.length, (i) => c.vertices[i]!);
      expect(
        Math.abs(geometry.vertexCount - c.vertices.length),
        `frame=${c.frame} view=${JSON.stringify(c.view)} die=${c.die} native=${c.vertices.length} actual=${geometry.vertexCount}`,
      ).toBeLessThanOrEqual(4);
      expect(left.length, `frame=${c.frame}`).toBe(rightIndices.length);
      for (let k = 0; k < left.length; k++) {
        const i = left[k]!,
          j = rightIndices[k]!,
          p = c.vertices[j]!,
          q = c.vertices[j ^ 1]!;
        const distance = Math.hypot(
          geometry.vertices[i * 10]! - p.x,
          geometry.vertices[i * 10 + 1]! - p.y,
          geometry.vertices[i * 10 + 2]! - p.z,
        );
        const width = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
        absolute = Math.max(absolute, distance);
        relative = Math.max(relative, distance / width);
        expect(
          distance / width,
          `frame=${c.frame} view=${JSON.stringify(c.view)} width=${c.width} die=${c.die} vertex=${i}`,
        ).toBeLessThan(0.1);
        uv = Math.max(
          uv,
          Math.abs(geometry.vertices[i * 10 + 3]! - c.uv[j]!.x),
          Math.abs(geometry.vertices[i * 10 + 4]! - c.uv[j]!.y),
        );
        for (let axis = 0; axis < 4; axis++) {
          const key = (['r', 'g', 'b', 'a'] as const)[axis]!;
          color = Math.max(
            color,
            Math.abs(geometry.vertices[i * 10 + 5 + axis]! * 255 - c.colors[j]![key]),
          );
        }
        compared++;
      }
    }
    expect(uv).toBeLessThan(1e-4);
    expect(color).toBeLessThan(1.01);
    recordError(
      'trail.motion.position',
      absolute,
      'scene units',
      `${motion.length} cases; ${compared} vertices`,
    );
    recordError(
      'trail.motion.relative',
      relative,
      'full trail width',
      `${motion.length} cases; ${compared} vertices`,
    );
    recordError('trail.motion.uv', uv, 'UV units', `${compared} vertices`);
    recordError('trail.motion.color', color, '/255', `${compared} vertices`);
  },
);

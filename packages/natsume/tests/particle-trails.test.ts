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
  return { emitter, definition, pool, trails };
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
  a.emitter.lifetimes[0] = 10;
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

it('groups Ribbon using stable particle IDs and removes dead records without retaining history', () => {
  const { emitter, trails, pool } = fixture(1);
  expect(centers(trails).map((s) => s.length)).toEqual([3, 2]);
  expect(pool.count).toBe(5);
  emitter.lifetimes[1] = 1e-5;
  emitter.step(0.01);
  expect(centers(trails).map((s) => s.length)).toEqual([3, 1]);
  emitter.step(0.6);
  expect(pool.count).toBe(0);
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
  'matches straight native strip vertices, all five UV modes and quantized colors',
  () => {
    const { cases } = JSON.parse(readFileSync(nativePath, 'utf8')) as {
      cases: NativeCase[];
    };
    let positionError = 0,
      uvError = 0,
      colorError = 0,
      comparisons = 0;
    for (const c of cases.filter(
      (c) => c.mode === 0 && [0, 1, 2, 4, 8, 16, 31].includes(c.flags),
    )) {
      const { emitter, trails, definition } = fixture(
        0,
        Boolean(c.flags & 16),
        Boolean(c.flags & 8),
      );
      definition.textureMode = c.texture;
      definition.textureScale = new Vec2T(1.5, 0.75);
      definition.sizeAffectsLifetime = Boolean(c.flags & 1);
      definition.sizeAffectsWidth = Boolean(c.flags & 2);
      definition.inheritParticleColor = Boolean(c.flags & 4);
      definition.colorOverLifetime = new ColorParameterT(0, null, new ColorT(0.5, 0.6, 0.7, 0.5));
      definition.colorOverTrail = new ColorParameterT(0, null, new ColorT(0.8, 0.6, 0.4, 0.9));
      definition.widthOverTrail = linear(0.5, 1.5);
      emitter.startColors.set([0.2, 0.4, 0.6, 0.8]);
      const geometry = new TrailGeometry();
      for (let frame = 1; frame <= 3; frame++) {
        emitter.step(0.05);
        geometry.update(trails);
        const sample = c.samples.find((s) => s.frame === frame)!;
        expect(geometry.vertexCount, `flags=${c.flags} frame=${frame}`).toBe(
          sample.vertices.length,
        );
        for (let i = 0; i < geometry.vertexCount; i++) {
          comparisons++;
          const offset = i * 10,
            expected = sample.vertices[i]!;
          for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
            positionError = Math.max(
              positionError,
              Math.abs(geometry.vertices[offset + axis]! - expected[key]),
            );
            expect(
              Math.abs(geometry.vertices[offset + axis]! - expected[key]),
              `flags=${c.flags} frame=${frame} vertex=${i} axis=${axis}`,
            ).toBeLessThan(2e-5);
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
      `${comparisons} straight strip vertices`,
    );
    recordError('trail.geometry.uv', uvError, 'UV units', `${comparisons} straight strip vertices`);
    recordError(
      'trail.geometry.color',
      colorError,
      '/255',
      `${comparisons} straight strip vertices`,
    );
  },
);

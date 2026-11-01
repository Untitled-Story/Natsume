import { expect, it } from 'vitest';
import * as I from '../src/format/generated/noa/ir.js';
import { MeshT } from '../src/format/generated/noa/mesh/mesh.js';
import { Vec3T } from '../src/format/generated/noa/mesh/vec3.js';
import { Vec4T } from '../src/format/generated/noa/mesh/vec4.js';
import { SubmeshT } from '../src/format/generated/noa/mesh/submesh.js';
import { EffectPack } from '../src/pack.js';
import { MeshShapeSampler } from '../src/runtime/mesh-shape.js';
import { sampleShape } from '../src/runtime/shapes.js';
import { minimalDocument } from './helpers.js';
import { constant } from './particle-fixtures.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';
import { Simulation } from '../src/runtime/simulation.js';
import { checkCompatibility } from '../src/runtime/compatibility.js';
import { particleSource } from './particle-fixtures.js';

type Point = { x: number; y: number; z: number };
interface Case {
  placement: number;
  materialIndex: number;
  mode: number;
  normalOffset: number;
  spread: number;
  speed: number;
  useMaterialIndex: boolean;
  useMeshColors: boolean;
  count: number;
  firstTriangleCount: number;
  mean: number[];
  second: number[];
  samples: { position: Point; velocity: Point }[];
}
interface Batch {
  vertices: Point[];
  normals: Point[];
  colors: { r: number; g: number; b: number; a: number }[];
  triangles: number[];
  cases: Case[];
  submeshLengths: number[];
  variants: Batch[];
}
const native = JSON.parse(readNativeFixture('unity-mesh-shape.json')) as Batch;
function packFor(batch: Batch) {
  const mesh = new MeshT();
  mesh.positions = batch.vertices.map((v) => new Vec3T(v.x, v.y, v.z));
  mesh.normals = batch.normals.map((v) => new Vec3T(v.x, v.y, v.z));
  mesh.colors = batch.colors.map((v) => new Vec4T(v.r, v.g, v.b, v.a));
  mesh.indices = batch.triangles;
  let start = 0;
  mesh.submeshes = batch.submeshLengths.map((length) => {
    const submesh = new SubmeshT(start, length);
    start += length;
    return submesh;
  });
  return new EffectPack(
    minimalDocument(),
    { files: [] } as never,
    new Map(),
    new Map([[43, mesh]]),
  );
}
it('applies mesh birth colors and normals, replays deterministically and preflights invalid submeshes', () => {
  const doc = minimalDocument(),
    source = particleSource(),
    mesh = new MeshT();
  mesh.positions = [new Vec3T(0, 0, 0), new Vec3T(1, 0, 0), new Vec3T(0, 1, 0)];
  mesh.normals = [new Vec3T(0, 0, 1), new Vec3T(0, 1, 0), new Vec3T(1, 0, 0)];
  mesh.colors = [new Vec4T(1, 0, 0, 1), new Vec4T(0, 1, 0, 1), new Vec4T(0, 0, 1, 1)];
  mesh.indices = [0, 1, 2];
  mesh.submeshes = [new SubmeshT(0, 3)];
  const definition = new I.MeshShapeT(0, 43, 0, 0.3, true, false, 0, 1, constant(1));
  source.main!.playOnEnable = true;
  source.main!.speed = constant(2);
  source.modules = [
    new I.ParticleModuleT(
      I.ParticleModuleData.ShapeModule,
      new I.ShapeModuleT(
        null,
        I.ShapeGeometry.MeshShape,
        definition,
        structuredClone(doc.nodes[0]!.transform),
      ),
    ),
    new I.ParticleModuleT(
      I.ParticleModuleData.EmissionModule,
      new I.EmissionModuleT(constant(0), constant(0), [new I.BurstT(0, constant(3), 1, 0, 1)]),
    ),
  ];
  doc.features = [new I.FeatureRequirementT('particle.shape.mesh', 1, true)];
  doc.components = [new I.ComponentT(3, 1, true, I.ComponentData.ParticleSystem, source)];
  const pack = new EffectPack(doc, { files: [] } as never, new Map(), new Map([[43, mesh]]));
  const context = {
    maxTextureSize: 4096,
    availableTexturePixels: 4096,
    cachedMaterialIds: new Set<number>(),
    imageBitmapAvailable: true,
    hasScript: () => false,
    disposed: false,
  };
  try {
    expect(checkCompatibility(pack, {}, context).compatible).toBe(true);
    const simulation = new Simulation(pack, { seed: 123 });
    simulation.play();
    const emitter = simulation.emitters.get(3)!;
    expect(emitter.count).toBe(3);
    expect(Array.from(emitter.positions.slice(0, 9))).toEqual([
      0,
      0,
      Math.fround(0.3),
      1,
      Math.fround(0.3),
      0,
      Math.fround(0.3),
      1,
      0,
    ]);
    expect(Array.from(emitter.velocities.slice(0, 9))).toEqual([0, 0, 2, 0, 2, 0, 2, 0, 0]);
    expect(Array.from(emitter.startColors.slice(0, 12))).toEqual([
      1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1,
    ]);
    const initial = emitter.positions.slice();
    simulation.restart();
    expect(emitter.positions).toEqual(initial);
    const badDoc = structuredClone(doc);
    const badShape = (badDoc.components[0]!.data as I.ParticleSystemT).modules[0]!
      .data as I.ShapeModuleT;
    (badShape.geometry as I.MeshShapeT).useMaterialIndex = true;
    (badShape.geometry as I.MeshShapeT).materialIndex = 4;
    const badPack = new EffectPack(
      badDoc,
      { files: [] } as never,
      new Map(),
      new Map([[43, mesh]]),
    );
    try {
      expect(checkCompatibility(badPack, {}, context).issues).toContainEqual(
        expect.objectContaining({
          componentId: 3,
          field: 'modules.0.geometry',
          code: 'CAPABILITY',
        }),
      );
      expect(() => new Simulation(badPack)).toThrow(/submesh/);
    } finally {
      badPack.dispose();
    }
  } finally {
    pack.dispose();
  }
});
for (const [variant, batch] of (native.cases.length
  ? [native, ...(native.variants ?? [])]
  : []
).entries())
  it(
    'matches native mesh placement, area weighting, normals, colors and spawn sweeps ' + variant,
    () => {
      const pack = packFor(batch),
        out = new Float64Array(10);
      let maxMean = 0,
        maxSecond = 0,
        maxFrequency = 0,
        maxSweep = 0;
      try {
        for (const c of batch.cases) {
          const definition = new I.MeshShapeT(
            0,
            43,
            c.placement,
            c.normalOffset,
            c.useMeshColors,
            c.useMaterialIndex,
            c.materialIndex,
            c.mode,
            constant(c.speed),
            c.spread,
          );
          const sampler = new MeshShapeSampler(pack, definition);
          expect(c.count).toBe(c.mode ? 32 : 8192);
          const shape = new I.ShapeModuleT(null, I.ShapeGeometry.MeshShape, definition);
          const means = new Float64Array(10),
            second = new Float64Array(10);
          let firstTriangle = 0;
          for (let i = 0; i < c.count; i++) {
            sampleShape(shape, 12345, i, 0, i, c.count, out, c.mode ? i * 0.125 : 0, 4, sampler);
            if (out[0]! < 2) firstTriangle++;
            for (let axis = 0; axis < 10; axis++) {
              means[axis]! += out[axis]! / c.count;
              second[axis]! += out[axis]! ** 2 / c.count;
            }
            if (c.mode && c.placement !== 2) {
              const expected = c.samples[i]!;
              for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
                maxSweep = Math.max(
                  maxSweep,
                  Math.abs(out[axis]! - expected.position[key]),
                  Math.abs(out[axis + 3]! - expected.velocity[key]),
                );
              }
            }
          }
          if (c.mode) continue;
          for (let axis = 0; axis < 10; axis++) {
            maxMean = Math.max(
              maxMean,
              Math.abs(means[axis]! - c.mean[axis]!) / Math.max(1, Math.abs(c.mean[axis]!)),
            );
            maxSecond = Math.max(
              maxSecond,
              Math.abs(second[axis]! - c.second[axis]!) / Math.max(1, Math.abs(c.second[axis]!)),
            );
          }
          const frequency = c.firstTriangleCount / c.count;
          maxFrequency = Math.max(
            maxFrequency,
            Math.abs(firstTriangle / c.count - frequency) / Math.max(1 / c.count, frequency),
          );
        }
        recordError('shape.mesh.mean', maxMean, 'normalized', `variant ${variant}`);
        recordError('shape.mesh.second', maxSecond, 'normalized', `variant ${variant}`);
        recordError('shape.mesh.frequency', maxFrequency, 'relative', `variant ${variant}`);
        recordError('shape.mesh.sweep', maxSweep, 'scene unit / direction', `variant ${variant}`);
        expect(maxMean).toBeLessThan(0.06);
        expect(maxSecond).toBeLessThan(0.06);
        expect(maxFrequency).toBeLessThan(0.1);
        expect(maxSweep).toBeLessThan(1e-4);
      } finally {
        pack.dispose();
      }
    },
  );

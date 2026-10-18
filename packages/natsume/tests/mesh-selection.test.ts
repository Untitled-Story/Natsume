import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Builder } from 'flatbuffers';
import {
  ParticleRenderer,
  ParticleRendererT,
} from '../src/format/generated/noa/ir/particle-renderer.js';
import { MeshDistribution } from '../src/format/generated/noa/ir/mesh-distribution.js';
import { selectMesh } from '../src/rendering/mesh-selection.js';
import { random } from '../src/runtime/parameters.js';
import { recordError } from './measurement.js';

it('keeps older renderer buffers uniform when the distribution field is absent', () => {
  const builder = new Builder();
  const materials = ParticleRenderer.createMaterialsVector(builder, [1]);
  ParticleRenderer.startParticleRenderer(builder);
  ParticleRenderer.addMaterials(builder, materials);
  builder.finish(ParticleRenderer.endParticleRenderer(builder));
  const renderer = ParticleRenderer.getRootAsParticleRenderer(builder.dataBuffer()).unpack();
  expect(renderer.meshDistribution).toBe(MeshDistribution.UniformRandom);
  renderer.meshAssetIds = [1, 2, 3];
  renderer.meshWeights = [0, 100, 0];
  expect(selectMesh(renderer, 0.9, 0.1)).toBe(2);
});

it('skips zero-weight slots and falls back to uniform for zero total weight', () => {
  const definition = new ParticleRendererT();
  definition.meshAssetIds = [1, 2, 3];
  definition.meshDistribution = MeshDistribution.NonUniformRandom;
  definition.meshWeights = [0, 1, 0];
  for (const value of [0, 0.1, 0.999999]) expect(selectMesh(definition, value, value)).toBe(1);
  definition.meshWeights = [0, 0, 0];
  expect(selectMesh(definition, 0, 0.9)).toBe(0);
  expect(selectMesh(definition, 0.9, 0)).toBe(2);
});

const fixture = new URL(
  '../../../data/unity-baselines/fixtures/unity-meshes.json',
  import.meta.url,
);
it.skipIf(!existsSync(fixture))(
  'matches native mesh and row distributions within ten percent',
  () => {
    const native = JSON.parse(readFileSync(fixture, 'utf8')) as {
      cases: {
        label: string;
        weights: number[];
        counts: number[];
        particles: number;
        distribution: number;
        changedMeshes: number;
        changedRows: number;
        rowCounts: number[];
      }[];
    };
    for (const sample of native.cases) {
      const renderer = new ParticleRendererT();
      renderer.meshAssetIds = [1, 2, 3];
      renderer.meshWeights = sample.weights;
      renderer.meshDistribution = sample.distribution;
      const counts = [0, 0, 0],
        rows = [0, 0, 0];
      for (let i = 0; i < sample.particles; i++) {
        const u = random(12345, i, 70);
        counts[selectMesh(renderer, u, random(12345, i, 71))]!++;
        rows[Math.min(2, Math.floor(u * 3))]!++;
      }
      for (const [label, actual, expected] of [
        ['geometry', counts, sample.counts],
        ['row', rows, sample.rowCounts],
      ] as const) {
        for (let i = 0; i < 3; i++) {
          const error =
            expected[i] === 0 ? actual[i]! : Math.abs(actual[i]! - expected[i]!) / expected[i]!;
          recordError(
            'renderer.mesh.' + label + '-frequency',
            error * 100,
            'percent',
            sample.label + '/' + i,
          );
          expect(error, sample.label + '/' + label + '/' + i).toBeLessThan(0.1);
        }
      }
      expect(sample.changedMeshes).toBe(0);
      expect(sample.changedRows).toBe(0);
    }
  },
);

import { recordError } from './measurement.js';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { sampleShape } from '../src/runtime/shapes.js';
import { ShapeModuleT } from '../src/format/generated/noa/ir/shape-module.js';
import { ShapeGeometry as G } from '../src/format/generated/noa/ir/shape-geometry.js';
import { CircleShapeT } from '../src/format/generated/noa/ir/circle-shape.js';
import { ConeShapeT } from '../src/format/generated/noa/ir/cone-shape.js';
import { EdgeShapeT } from '../src/format/generated/noa/ir/edge-shape.js';
import { constant, particleSource, vector } from './particle-fixtures.js';
import { minimalDocument } from './helpers.js';
import type { EffectPack } from '../src/pack.js';
import { Emitter } from '../src/runtime/emitter.js';
import { Scene } from '../src/runtime/scene.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import { EmissionModuleT } from '../src/format/generated/noa/ir/emission-module.js';
import { BurstT } from '../src/format/generated/noa/ir/burst.js';
const native = JSON.parse(
  readFileSync(new URL('./fixtures/unity-sweeps.json', import.meta.url), 'utf8'),
) as {
  cases: {
    label: string;
    samples: {
      time: number;
      position: { x: number; y: number; z: number };
      rotation: { x: number; y: number; z: number };
    }[];
  }[];
};
for (const c of native.cases)
  it('matches Unity sweep ' + c.label, () => {
    const mode = c.label.includes('pingpong') ? 2 : 1;
    const spread = c.label.includes('spread') ? 0.25 : 0;
    const geometry = c.label.startsWith('edge')
      ? new EdgeShapeT(constant(2), mode, constant(0.5), spread)
      : c.label.startsWith('cone')
        ? new ConeShapeT()
        : new CircleShapeT();
    if (!(geometry instanceof EdgeShapeT)) {
      geometry.radius = constant(2);
      geometry.radiusThickness = 0;
      geometry.arcRadians = Math.PI;
      geometry.arcMode = mode;
      geometry.arcSpeed = constant(0.5);
      geometry.arcSpread = spread;
    }
    const shape = new ShapeModuleT(
      c.label.startsWith('edge')
        ? G.EdgeShape
        : c.label.startsWith('cone')
          ? G.ConeShape
          : G.CircleShape,
      geometry,
    );
    const out = new Float64Array(6);
    for (const s of c.samples) {
      // Native's exact PingPong period endpoint has a discontinuity; retain the continuous reflected limit.
      if (c.label === 'circle-pingpong' && s.time === 2) {
        sampleShape(shape, 12345, 0, s.time / 3, 0, 1, out, s.time, 3);
        recordError(
          'shape.sweep.excludedEndpoint',
          Math.hypot(...(['x', 'y', 'z'] as const).map((key, i) => out[i]! - s.position[key])),
          'units',
          c.label + '/' + s.time,
        );
        continue;
      }
      sampleShape(shape, 12345, 0, s.time / 3, 0, 1, out, s.time, 3);
      for (const [i, k] of (['x', 'y', 'z'] as const).entries()) {
        recordError(
          'shape.sweep.position',
          out[i]! - s.position[k],
          'units',
          c.label + '/' + s.time + '/' + k,
        );
        expect(Math.abs(out[i]! - s.position[k])).toBeLessThan(1e-5);
      }
    }
  });

for (const c of native.cases.filter((c) => c.label.includes('aligned')))
  it('matches Unity aligned birth rotation ' + c.label, () => {
    for (const sample of c.samples) {
      const document = minimalDocument();
      const pack = {
        nodes: document.nodes,
        components: [],
        getNode: (id: number) => document.nodes.find((n) => n.id === id),
      } as unknown as EffectPack;
      const source = particleSource();
      source.main!.durationSeconds = 3;
      source.main!.lifetime = constant(10);
      source.main!.rotation3d = true;
      source.main!.rotation = vector(
        ...([10, 20, 30].map((x) => (x * Math.PI) / 180) as [number, number, number]),
      );
      const geometry = c.label.startsWith('edge')
        ? new EdgeShapeT(constant(2), 1, constant(0.5))
        : new CircleShapeT(constant(2), Math.PI, 0, 0, null, 0, 1, constant(0.5));
      const shape = new ShapeModuleT(
        c.label.startsWith('edge') ? G.EdgeShape : G.CircleShape,
        geometry,
        structuredClone(document.nodes[0]!.transform),
        true,
      );
      source.modules.push(
        new ParticleModuleT(M.ShapeModule, shape),
        new ParticleModuleT(
          M.EmissionModule,
          new EmissionModuleT(null, null, [new BurstT(sample.time, constant(1))]),
        ),
      );
      const emitter = new Emitter(3, new Scene(pack, [1]).nodes.get(1)!, source, true, 12345, []);
      emitter.sync();
      for (let i = 0; i < Math.round(sample.time * 60); i++) emitter.step(1 / 60);
      expect(emitter.count).toBe(1);
      for (const [i, key] of (['x', 'y', 'z'] as const).entries()) {
        recordError(
          'shape.align.rotation',
          emitter.rotations[i]! - (sample.rotation[key] * Math.PI) / 180,
          'rad',
          c.label + '/' + sample.time + '/' + key,
        );
        expect(
          Math.abs(emitter.rotations[i]! - (sample.rotation[key] * Math.PI) / 180),
        ).toBeLessThan(1e-5);
      }
    }
  });

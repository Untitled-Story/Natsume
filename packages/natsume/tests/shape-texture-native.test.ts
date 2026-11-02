import { expect, it } from 'vitest';
import * as I from '../src/format/generated/noa/ir.js';
import { MeshT } from '../src/format/generated/noa/mesh/mesh.js';
import { Vec3T } from '../src/format/generated/noa/mesh/vec3.js';
import { Vec4T } from '../src/format/generated/noa/mesh/vec4.js';
import { TexCoordT } from '../src/format/generated/noa/mesh/tex-coord.js';
import { SubmeshT } from '../src/format/generated/noa/mesh/submesh.js';
import { EffectPack } from '../src/pack.js';
import { Simulation } from '../src/runtime/simulation.js';
import { minimalDocument } from './helpers.js';
import { particleSource, constant } from './particle-fixtures.js';
import { readNativeFixture } from './native-fixture.js';
import { ShapeTextureSampler } from '../src/runtime/shape-texture.js';
const native = JSON.parse(readNativeFixture('unity-shape-texture.json')) as {
  pngBase64: string;
  vertices: Point[];
  uv: Point[];
  cases: Case[];
};
it.skipIf(!native.cases.length)(
  'matches primitive texture projections against native birth colors',
  () => {
    const pack = new EffectPack(
      minimalDocument(),
      { files: [{ path: 'a.png', asset_id: 44, kind: 'image' }] } as never,
      new Map([['a.png', Uint8Array.from(Buffer.from(native.pngBase64, 'base64'))]]),
      new Map(),
    );
    try {
      for (const c of native.cases.filter((c) => c.geometry !== 0 && (c.color || c.alpha))) {
        const sampler = new ShapeTextureSampler(
          pack,
          new I.ShapeTextureT(
            44,
            c.channel,
            c.threshold,
            c.uvChannel,
            c.color,
            c.alpha,
            c.bilinear,
          ),
        );
        for (const s of c.samples) {
          const { x, y, z } = s.position,
            out = new Float64Array(12);
          out[10] = c.geometry === 1 || c.geometry === 4 ? x + 0.5 : x / 2 + 0.5;
          out[11] = c.geometry === 1 || c.geometry === 4 ? y + 0.5 : y / 2 + 0.5;
          if (c.geometry === 3) {
            out[10] = (((Math.atan2(y, x) / (2 * Math.PI)) % 1) + 1) % 1;
            out[11] = 0.5 + (z / Math.hypot(x, y, z)) * 0.5;
          }
          if (c.geometry === 5) {
            const r = Math.hypot(x, y);
            out[10] = 0.5 + x * r * 0.5;
            out[11] = 0.5 + y * r * 0.5;
          }
          if (c.geometry === 6) out[11] = 0;
          if (c.geometry === 7) {
            out[10] = 0.5 + (Math.hypot(x, y) - 1) / 0.5;
            out[11] = 0.5 + z / 0.5;
          }
          out.set([0.8, 0.6, 0.4, 191 / 255], 6);
          sampler.sample(out);
          for (const [i, key] of (['r', 'g', 'b', 'a'] as const).entries())
            expect(
              Math.abs(Math.round(out[6 + i]! * 255) / 255 - s.color[key]),
              JSON.stringify({ ...c, samples: undefined, position: s.position }) + '/' + key,
            ).toBeLessThanOrEqual(1 / 255 + 1e-7);
        }
      }
    } finally {
      pack.dispose();
    }
  },
);
type Point = { x: number; y: number; z: number };
interface Case {
  requestedCount?: number;
  geometry: number;
  channel: number;
  uvChannel: number;
  threshold: number;
  bilinear: boolean;
  color: boolean;
  alpha: boolean;
  count: number;
  samples: { position: Point; color: { r: number; g: number; b: number; a: number } }[];
}
it.skipIf(!native.cases.length)(
  'compares mesh texture births with native UV channels, colors and clipping',
  () => {
    for (const c of native.cases.filter((c) => c.geometry === 0)) {
      const doc = minimalDocument(),
        mesh = new MeshT(),
        source = particleSource();
      mesh.positions = native.vertices.map((p) => new Vec3T(p.x, p.y, p.z));
      mesh.normals = native.vertices.map(() => new Vec3T(0, 0, 1));
      mesh.indices = mesh.positions.flatMap((_, i) => [i, i, i]);
      mesh.submeshes = [new SubmeshT(0, mesh.indices.length)];
      mesh.texcoords = [0, 1].map(
        (channel) =>
          new TexCoordT(
            channel,
            2,
            native.uv.map((p) => new Vec4T(channel ? 1 - p.x : p.x, channel ? 1 - p.y : p.y)),
          ),
      );
      source.main!.color = new I.ColorParameterT(
        I.ColorMode.Constant,
        new I.ColorT(0.8, 0.6, 0.4, 191 / 255),
        new I.ColorT(0.8, 0.6, 0.4, 191 / 255),
      );
      source.modules = [
        new I.ParticleModuleT(
          I.ParticleModuleData.ShapeModule,
          new I.ShapeModuleT(
            new I.ShapeTextureT(
              44,
              c.channel,
              c.threshold,
              c.uvChannel,
              c.color,
              c.alpha,
              c.bilinear,
            ),
            I.ShapeGeometry.MeshShape,
            new I.MeshShapeT(0, 43, 0, 0, false, false, 0, 1, constant(1)),
            structuredClone(doc.nodes[0]!.transform),
          ),
        ),
        new I.ParticleModuleT(
          I.ParticleModuleData.EmissionModule,
          new I.EmissionModuleT(constant(0), constant(0), [
            new I.BurstT(0, constant(c.requestedCount ?? mesh.positions.length), 1, 0, 1),
          ]),
        ),
      ];
      doc.components = [new I.ComponentT(3, 1, true, I.ComponentData.ParticleSystem, source)];
      const pack = new EffectPack(
        doc,
        { files: [{ path: 'a.png', asset_id: 44, kind: 'image' }] } as never,
        new Map([['a.png', Uint8Array.from(Buffer.from(native.pngBase64, 'base64'))]]),
        new Map([[43, mesh]]),
      );
      try {
        const sim = new Simulation(pack);
        sim.play();
        const e = sim.emitters.get(3)!;
        const label = JSON.stringify({ ...c, samples: undefined });
        expect(e.count, label).toBe(c.count);
        const order = (a: Point, b: Point) => a.y - b.y || a.x - b.x;
        const actual = Array.from({ length: e.count }, (_, i) => ({
          position: {
            x: e.positions[i * 3]!,
            y: e.positions[i * 3 + 1]!,
            z: e.positions[i * 3 + 2]!,
          },
          color: Array.from(e.startColors.slice(i * 4, i * 4 + 4)),
        })).sort((a, b) => order(a.position, b.position));
        const expected = c.samples.slice().sort((a, b) => order(a.position, b.position));
        actual.forEach((a, i) => {
          expect(a.position, label).toEqual(expected[i]!.position);
          for (const [j, key] of (['r', 'g', 'b', 'a'] as const).entries())
            expect(
              Math.abs(a.color[j]! - expected[i]!.color[key]),
              label + '/' + key + '/' + JSON.stringify(a) + '/' + JSON.stringify(expected[i]),
            ).toBeLessThanOrEqual(1 / 255 + 1e-7);
        });
      } finally {
        pack.dispose();
      }
    }
  },
);

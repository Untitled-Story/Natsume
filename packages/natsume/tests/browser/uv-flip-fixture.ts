import { Application, Texture } from 'pixi.js';
import * as I from '../../src/format/generated/noa/ir.js';
import { MeshT } from '../../src/format/generated/noa/mesh/mesh.js';
import { Vec3T } from '../../src/format/generated/noa/mesh/vec3.js';
import { Vec4T } from '../../src/format/generated/noa/mesh/vec4.js';
import { TexCoordT } from '../../src/format/generated/noa/mesh/tex-coord.js';
import { SubmeshT } from '../../src/format/generated/noa/mesh/submesh.js';
import { EffectPack } from '../../src/pack.js';
import { ParticleMesh } from '../../src/rendering/particle-mesh.js';
import { Scene } from '../../src/runtime/scene.js';
import { Emitter } from '../../src/runtime/emitter.js';
import { minimalDocument } from '../helpers.js';
import { particleSource, constant } from '../particle-fixtures.js';
interface V {
  x: number;
  y: number;
}
export interface FlipCase {
  mode: number;
  mask: number;
  u: number;
  v: number;
  count: number;
  flippedU: number;
  flippedV: number;
  flippedBoth: number;
  vertices: (V & { z: number })[];
  uv: V[];
}
export interface FlipNative {
  spriteVertices: V[];
  spriteUV: V[];
  spriteIndices: number[];
  cases: FlipCase[];
}
export async function measureUVFlips(native: FlipNative) {
  const app = new Application();
  await app.init({ preference: 'webgl', preferWebGLVersion: 2, autoStart: false });
  const doc = minimalDocument(),
    geometry = new MeshT();
  geometry.positions = native.spriteVertices.map((v) => new Vec3T(v.x, v.y, 0));
  geometry.indices = native.spriteIndices;
  geometry.submeshes = [new SubmeshT(0, geometry.indices.length)];
  geometry.texcoords = [
    new TexCoordT(
      0,
      2,
      native.spriteUV.map((v) => new Vec4T(v.x, v.y)),
    ),
  ];
  const sprite = new I.SpriteAssetT();
  sprite.meshAssetId = 40;
  sprite.rect = new I.Vec4T(4, 4, 8, 8);
  sprite.pivot = new I.Vec2T(0.5, 0.5);
  sprite.pixelsPerUnit = 8;
  doc.assets = [new I.AssetT(20, 4, sprite)];
  const pack = new EffectPack(doc, { files: [] } as never, new Map(), new Map([[40, geometry]]));
  const results = [];
  try {
    const scene = new Scene(pack, [1]);
    for (const c of native.cases) {
      const source = particleSource();
      source.main!.maxParticles = c.count;
      const sheet = new I.TextureSheetModuleT();
      sheet.mode = c.mode;
      sheet.columns = 4;
      sheet.rows = 2;
      sheet.uvChannelMask = c.mask;
      sheet.spriteAssetIds = [20];
      sheet.frameOverTime = constant(0);
      sheet.startFrame = constant(0);
      sheet.flipUProbability = c.u;
      sheet.flipVProbability = c.v;
      source.modules.push(new I.ParticleModuleT(I.ParticleModuleData.TextureSheetModule, sheet));
      const e = new Emitter(
        3,
        scene.nodes.get(1)!,
        source,
        true,
        12345,
        [],
        undefined,
        undefined,
        pack,
      );
      e.count = c.count;
      e.lifetimes.fill(1);
      e.startSizes.fill(1);
      e.startColors.fill(1);
      for (let i = 0; i < c.count; i++) e.serials[i] = i;
      const d = new I.ParticleRendererT();
      d.maxSize = 100;
      d.vertexStreams = [
        new I.VertexStreamT(0, 3),
        new I.VertexStreamT(2, 4),
        new I.VertexStreamT(3, 2),
        ...Array.from({ length: 33 }, (_, i) => i)
          .filter((i) => ![0, 2, 3].includes(i))
          .map((i) => new I.VertexStreamT(i, 1)),
      ];
      const material = new I.MaterialT();
      material.model = 2;
      material.renderState = new I.RenderStateT();
      const mesh = new ParticleMesh(e, d, material, Texture.WHITE, pack);
      try {
        mesh.sync([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 'gamma');
        const buffer = mesh.geometry.getBuffer('aPosition').data as Float32Array;
        const quad = (i: number) =>
          Array.from({ length: 4 }, (_, j) => {
            const k = (i * 4 + j) * 16;
            return {
              x: buffer[k]!,
              y: buffer[k + 1]!,
              z: buffer[k + 2]!,
              u: buffer[k + 3]!,
              v: 1 - buffer[k + 4]!,
            };
          });
        let fu = 0,
          fv = 0,
          fb = 0;
        for (let i = 0; i < c.count; i++) {
          const q = quad(i).sort((a, b) => a.y - b.y || a.x - b.x),
            u = q[1]!.u < q[0]!.u,
            v = q[2]!.v < q[0]!.v;
          if (u) fu++;
          if (v) fv++;
          if (u && v) fb++;
        }
        const first = quad(0);
        mesh.sync([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 'gamma');
        results.push({
          vertices: first,
          flippedU: fu,
          flippedV: fv,
          flippedBoth: fb,
          stable: first.every((v, i) => v.u === quad(0)[i]!.u && v.v === quad(0)[i]!.v),
          stride: buffer.length / (c.count * 4),
        });
      } finally {
        mesh.destroy();
      }
    }
  } finally {
    pack.dispose();
    app.destroy();
  }
  return results;
}

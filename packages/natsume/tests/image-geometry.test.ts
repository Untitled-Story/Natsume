import { existsSync, readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { EffectPack } from '../src/pack.js';
import { minimalDocument } from './helpers.js';
import { imageGeometry } from '../src/rendering/image-geometry.js';
import { AssetT } from '../src/format/generated/noa/ir/asset.js';
import { SpriteAssetT } from '../src/format/generated/noa/ir/sprite-asset.js';
import { UIImageT } from '../src/format/generated/noa/ir/uiimage.js';
import { MeshT } from '../src/format/generated/noa/mesh/mesh.js';
import { Vec3T } from '../src/format/generated/noa/mesh/vec3.js';
import { Vec4T } from '../src/format/generated/noa/mesh/vec4.js';
import { TexCoordT } from '../src/format/generated/noa/mesh/tex-coord.js';
const path = new URL('../../../data/unity-baselines/fixtures/unity-images.json', import.meta.url);
it.skipIf(!existsSync(path))(
  'matches native tiled Graphic vertex limits and border-only geometry',
  () => {
    const native = JSON.parse(readFileSync(path, 'utf8')),
      doc = minimalDocument(),
      source = new MeshT();
    source.positions = native.vertices.map((p: { x: number; y: number }) => new Vec3T(p.x, p.y, 0));
    source.indices = native.triangles;
    source.texcoords = [
      new TexCoordT(
        0,
        2,
        native.uv.map((p: { x: number; y: number }) => new Vec4T(p.x, p.y, 0, 0)),
      ),
    ];
    doc.assets = [
      new AssetT(
        3,
        4,
        Object.assign(new SpriteAssetT(), {
          meshAssetId: 2,
          rect: { x: 0, y: 0, z: 16, w: 8 },
          pivot: { x: 0.25, y: 1.25 },
          border: { x: 2, y: 1, z: 3, w: 2 },
          pixelsPerUnit: 100,
        }),
      ),
    ];
    const pack = new EffectPack(
      doc,
      {
        format: 'noa-package',
        version: 1,
        noir_version: [2, 0],
        document: 'scene.noir',
        files: [],
      },
      new Map(),
      new Map([[2, source]]),
    );
    for (const c of native.largeCases) {
      const image = Object.assign(new UIImageT(), {
        spriteAssetId: 3,
        type: 2,
        fillCenter: c.center,
      });
      const actual = imageGeometry(pack, image, c.size.x, c.size.y, { x: 0.25, y: 0.75 });
      expect(actual.positions.length, JSON.stringify(c.size) + '/' + c.center).toBe(c.vertices);
      for (const [key, expected] of [
        ['x', c.xs],
        ['y', c.ys],
      ] as const) {
        const values = [...new Set(actual.positions.map((p) => Math.fround(p[key])))]
          .sort((a, b) => a - b)
          .slice(0, 12);
        values.forEach((v, i) =>
          expect(Math.abs(v - expected[i])).toBeLessThan(Math.max(c.size.x, c.size.y) * 2e-7),
        );
      }
    }
    const tight = new MeshT();
    tight.positions = native.meshVertices.map(
      (p: { x: number; y: number }) => new Vec3T(p.x, p.y, 0),
    );
    tight.indices = native.meshTriangles;
    tight.texcoords = [
      new TexCoordT(
        0,
        2,
        native.meshUV.map((p: { x: number; y: number }) => new Vec4T(p.x, p.y, 0, 0)),
      ),
    ];
    const tightDoc = minimalDocument();
    tightDoc.assets = [
      new AssetT(
        3,
        4,
        Object.assign(new SpriteAssetT(), {
          meshAssetId: 2,
          rect: native.meshRect,
          textureRect: native.meshTextureRect,
          textureRectOffset: native.meshOffset,
          pivot: native.meshPivot,
          border: { x: 12, y: 20, z: 12, w: 20 },
          pixelsPerUnit: 100,
        }),
      ),
    ];
    const tightPack = new EffectPack(tightDoc, pack.manifest, new Map(), new Map([[2, tight]]));
    for (const c of native.meshCases) {
      const image = Object.assign(new UIImageT(), {
        spriteAssetId: 3,
        type: c.type,
        fillCenter: c.center,
        useSpriteMesh: c.sourceMesh,
        preserveAspect: c.aspect,
      });
      const actual = imageGeometry(tightPack, image, c.size.x, c.size.y, c.pivot);
      const sort = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        a.x - b.x || a.y - b.y;
      const a = actual.positions.slice().sort(sort),
        b = c.vertices.slice().sort(sort);
      expect(a.length).toBe(b.length);
      a.forEach((p, i) => {
        expect(p.x).toBeCloseTo(b[i].x, 4);
        expect(p.y).toBeCloseTo(b[i].y, 4);
      });
      const actualUV = actual.texcoords[0]!.values;
      actual.positions.forEach((p, i) => {
        const match = c.vertices.findIndex(
          (q: { x: number; y: number }, j: number) =>
            Math.abs(q.x - p.x) < 1e-4 &&
            Math.abs(q.y - p.y) < 1e-4 &&
            Math.abs(c.uv[j].x - actualUV[i]!.x) < 1e-5 &&
            Math.abs(c.uv[j].y - actualUV[i]!.y) < 1e-5,
        );
        expect(match, c.label + ' vertex/UV ' + i).toBeGreaterThanOrEqual(0);
      });
    }
    tightPack.dispose();
    pack.dispose();
  },
);

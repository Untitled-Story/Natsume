import {
  Application,
  Texture,
  BufferImageSource,
  Container,
  RenderTexture,
  type WebGLRenderer,
} from 'pixi.js';
import { EffectPack } from '../../src/pack.js';
import { minimalDocument } from '../helpers.js';
import { particleSource, linear, constant } from '../particle-fixtures.js';
import { AssetT } from '../../src/format/generated/noa/ir/asset.js';
import { SpriteAssetT } from '../../src/format/generated/noa/ir/sprite-asset.js';
import { MeshT } from '../../src/format/generated/noa/mesh/mesh.js';
import { Vec3T } from '../../src/format/generated/noa/mesh/vec3.js';
import { Vec4T } from '../../src/format/generated/noa/mesh/vec4.js';
import { TexCoordT } from '../../src/format/generated/noa/mesh/tex-coord.js';
import { ParticleModuleT } from '../../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../../src/format/generated/noa/ir/particle-module-data.js';
import { TextureSheetModuleT } from '../../src/format/generated/noa/ir/texture-sheet-module.js';
import { ParticleRendererT } from '../../src/format/generated/noa/ir/particle-renderer.js';
import { VertexStreamT } from '../../src/format/generated/noa/ir/vertex-stream.js';
import { MaterialT } from '../../src/format/generated/noa/ir/material.js';
import { RenderStateT } from '../../src/format/generated/noa/ir/render-state.js';
import { Scene } from '../../src/runtime/scene.js';
import { Emitter } from '../../src/runtime/emitter.js';
import { ParticleMesh } from '../../src/rendering/particle-mesh.js';
export async function measureSpriteSheets(ages: number[]) {
  const app = new Application();
  await app.init({ preference: 'webgl', preferWebGLVersion: 2, autoStart: false });
  const doc = minimalDocument(),
    meshes = new Map<number, MeshT>();
  for (let i = 0; i < 2; i++) {
    const mesh = new MeshT();
    const points =
      i === 0
        ? [
            [-1, -0.5],
            [3, -0.5],
            [3, -2.5],
            [-1, -2.5],
          ]
        : [
            [-1, 1],
            [1, 1],
            [1, -1],
            [-1, -1],
          ];
    mesh.positions = points.map((p) => new Vec3T(p[0], p[1], 0));
    mesh.indices = [0, 1, 2, 0, 2, 3];
    const uv =
      i === 0
        ? [
            [0, 0.5],
            [1, 0.5],
            [1, 0],
            [0, 0],
          ]
        : [
            [0.5, 1],
            [1, 1],
            [1, 0.5],
            [0.5, 0.5],
          ];
    mesh.texcoords = [
      new TexCoordT(
        0,
        2,
        uv.map((p) => new Vec4T(p[0], p[1], 0, 0)),
      ),
    ];
    meshes.set(10 + i, mesh);
    const sprite = new SpriteAssetT();
    sprite.meshAssetId = 10 + i;
    sprite.pixelsPerUnit = 4;
    sprite.rect = { x: 0, y: 0, z: i === 0 ? 16 : 8, w: 8 } as typeof sprite.rect;
    doc.assets.push(new AssetT(20 + i, 4, sprite));
  }
  const pack = new EffectPack(
    doc,
    { format: 'noa-package', version: 1, noir_version: [2, 0], document: 'scene.noir', files: [] },
    new Map(),
    meshes,
  );
  const source = particleSource();
  source.main!.lifetime = constant(1);
  const sheet = new TextureSheetModuleT();
  sheet.mode = 1;
  sheet.spriteAssetIds = [20, 21];
  sheet.frameOverTime = linear(0, 1);
  sheet.startFrame = constant(0);
  source.modules.push(new ParticleModuleT(M.TextureSheetModule, sheet));
  const scene = new Scene(pack, [1]);
  const e = new Emitter(3, scene.ordered[0]!, source, true, 12345, [], undefined, undefined, pack);
  e.count = 1;
  e.lifetimes[0] = 1;
  e.startSizes.fill(1);
  e.startColors.fill(1);
  const d = new ParticleRendererT();
  d.maxSize = 100;
  d.vertexStreams = [new VertexStreamT(0, 3), new VertexStreamT(2, 4), new VertexStreamT(3, 2)];
  const mat = new MaterialT();
  mat.model = 6;
  mat.renderState = new RenderStateT();
  const mesh = new ParticleMesh(e, d, mat, Texture.WHITE, pack);
  const result = ages.map((age) => {
    e.ages[0] = age;
    mesh.sync([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 'gamma');
    const v = mesh.geometry.getBuffer('aPosition').data as Float32Array;
    return Array.from({ length: 4 }, (_, j) => ({
      x: v[j * 16],
      y: v[j * 16 + 1],
      z: v[j * 16 + 2],
      u: v[j * 16 + 3],
      v: 1 - v[j * 16 + 4]!,
    }));
  });
  mesh.destroy();
  const textures = [
    [255, 0, 0, 128],
    [0, 0, 255, 128],
  ].map(
    (c) =>
      new Texture({
        source: new BufferImageSource({
          resource: Uint8Array.from(c),
          width: 1,
          height: 1,
          alphaMode: 'no-premultiply-alpha',
          minFilter: 'nearest',
          magFilter: 'nearest',
        }),
      }),
  );
  e.count = 2;
  e.ages[0] = 0;
  e.ages[1] = 0.75;
  e.lifetimes[1] = 1;
  mat.model = 6;
  mat.renderState!.srcRgb = mat.renderState!.srcAlpha = 1;
  mat.renderState!.dstRgb = mat.renderState!.dstAlpha = 5;
  const colored = new ParticleMesh(e, d, mat, Texture.WHITE, pack, undefined, undefined, textures);
  const container = new Container();
  container.addChild(colored);
  const target = RenderTexture.create({ width: 32, height: 32, antialias: false });
  const pixels: number[][] = [];
  const renderer = app.renderer as WebGLRenderer;
  const { ensureMaterialPipe } = await import('../../src/rendering/material-pipe.js');
  ensureMaterialPipe(renderer);
  for (const sort of [0, 3]) {
    d.sort = sort;
    colored.sync([16, 0, 0, 0, 0, -16, 0, 0, 0, 0, 1, 0, 16, 16, 0, 1], 'gamma');
    renderer.render({ container, target, clear: true, clearColor: [0, 0, 0, 0] });
    const data = renderer.extract.pixels({ target }).pixels;
    pixels.push(Array.from(data.slice((18 * 32 + 17) * 4, (18 * 32 + 17) * 4 + 4)));
  }
  colored.destroy();
  container.destroy();
  target.destroy(true);
  textures.forEach((t) => t.destroy(true));
  pack.dispose();
  app.destroy();
  return { result, pixels };
}

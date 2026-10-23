import { NatsumeRuntime } from '../../src/runtime/runtime.js';
import { AssetT } from '../../src/format/generated/noa/ir/asset.js';
import { ComponentT } from '../../src/format/generated/noa/ir/component.js';
import { ComponentData } from '../../src/format/generated/noa/ir/component-data.js';
import {
  Application,
  BufferImageSource,
  Container,
  RenderTexture,
  Texture,
  type WebGLRenderer,
} from 'pixi.js';
import { EffectPack } from '../../src/pack.js';
import { minimalDocument } from '../helpers.js';
import { SpriteAssetT } from '../../src/format/generated/noa/ir/sprite-asset.js';
import { SpriteRendererT } from '../../src/format/generated/noa/ir/sprite-renderer.js';
import { MeshRendererT } from '../../src/format/generated/noa/ir/mesh-renderer.js';
import { MeshT } from '../../src/format/generated/noa/mesh/mesh.js';
import { Vec3T } from '../../src/format/generated/noa/mesh/vec3.js';
import { Vec4T } from '../../src/format/generated/noa/mesh/vec4.js';
import { TexCoordT } from '../../src/format/generated/noa/mesh/tex-coord.js';
import { SubmeshT } from '../../src/format/generated/noa/mesh/submesh.js';
import { Scene } from '../../src/runtime/scene.js';
import { SceneMesh } from '../../src/rendering/scene-mesh.js';
import { spriteGeometry } from '../../src/rendering/sprite-geometry.js';
import { ensureMaterialPipe } from '../../src/rendering/material-pipe.js';
import { MaterialT } from '../../src/format/generated/noa/ir/material.js';
import { RenderStateT } from '../../src/format/generated/noa/ir/render-state.js';
import { TextureBindingT } from '../../src/format/generated/noa/ir/texture-binding.js';
import type { ColorT } from '../../src/format/generated/noa/ir/color.js';
import type { Vec2T } from '../../src/format/generated/noa/ir/vec2.js';
import type { Vec4T as IRVec4T } from '../../src/format/generated/noa/ir/vec4.js';

export interface SpriteSample {
  label: string;
  drawMode: number;
  tileMode: number;
  flipX: boolean;
  flipY: boolean;
  size: Vec2T;
  pivot: Vec2T;
  border: IRVec4T;
  color: ColorT;
  tint: ColorT;
  vertices: Vec2T[];
  uv: Vec2T[];
  triangles: number[];
  pixels: number[];
}
export async function measureSpriteRendering(native: { texture: number[]; cases: SpriteSample[] }) {
  const app = new Application();
  await app.init({
    preference: 'webgl',
    preferWebGLVersion: 2,
    width: 64,
    height: 64,
    autoStart: false,
    antialias: false,
  });
  const renderer = app.renderer as WebGLRenderer;
  ensureMaterialPipe(renderer);
  const target = RenderTexture.create({ width: 64, height: 64, antialias: false }),
    container = new Container();
  const data = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++)
    data.set(native.texture.slice(y * 16 * 4, (y + 1) * 16 * 4), (15 - y) * 16 * 4);
  const texture = new Texture({
    source: new BufferImageSource({
      resource: data,
      width: 16,
      height: 16,
      alphaMode: 'no-premultiply-alpha',
      minFilter: 'linear',
      magFilter: 'linear',
      addressMode: 'clamp-to-edge',
    }),
  });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  canvas.getContext('2d')!.putImageData(new ImageData(Uint8ClampedArray.from(data), 16, 16), 0, 0);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
  const png = new Uint8Array(await blob.arrayBuffer());
  const runtime = new NatsumeRuntime(renderer);
  const result: Record<string, number[]> = {};
  const publicResult: Record<string, number[]> = {};
  for (const c of native.cases) {
    const source = new MeshT();
    source.positions = c.vertices.map((p) => new Vec3T(p.x, p.y, 0));
    source.indices = c.triangles;
    source.texcoords = [
      new TexCoordT(
        0,
        2,
        c.uv.map((p) => new Vec4T(p.x, p.y, 0, 0)),
      ),
    ];
    source.submeshes = [new SubmeshT(0, source.indices.length)];
    const doc = minimalDocument();
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
    const sprite = new SpriteAssetT();
    sprite.meshAssetId = 2;
    sprite.rect = { x: 0, y: 0, z: 16, w: 8 } as IRVec4T;
    sprite.pivot = c.pivot;
    sprite.border = c.border;
    sprite.pixelsPerUnit = 4;
    const d = Object.assign(new SpriteRendererT(), c);
    const geometry = spriteGeometry(pack, sprite, d);
    const material = new MaterialT();
    material.model = 6;
    material.tint = c.tint;
    material.renderState = new RenderStateT();
    material.renderState.srcRgb = material.renderState.srcAlpha = 1;
    material.renderState.dstRgb = material.renderState.dstAlpha = 5;
    const binding = new TextureBindingT();
    binding.colorSpace = 2;
    material.textures = [binding];
    const scene = new Scene(pack, [1]);
    const mesh = new SceneMesh(
      scene.nodes.get(1)!,
      new MeshRendererT(),
      material,
      geometry,
      0,
      texture,
      pack,
    );
    mesh.rendererColor = () => c.color;
    container.addChild(mesh);
    mesh.sync([8, 0, 0, 0, 0, -8, 0, 0, 0, 0, 0.001, 0, 32, 32, 0, 1], 'gamma');
    renderer.render({ container, target, clear: true, clearColor: [0, 0, 0, 0] });
    result[c.label] = Array.from(renderer.extract.pixels({ target }).pixels);
    container.removeChild(mesh);
    mesh.destroy();
    pack.dispose();
    sprite.imageAssetId = 4;
    sprite.colorSpace = 2;
    d.spriteAssetId = 3;
    d.materials = [5];
    const publicDoc = minimalDocument();
    material.id = 5;
    material.textures = [];
    publicDoc.assets = [new AssetT(3, 4, sprite)];
    publicDoc.materials = [material];
    publicDoc.components = [new ComponentT(6, 1, true, ComponentData.SpriteRenderer, d)];
    const publicPack = new EffectPack(
      publicDoc,
      {
        format: 'noa-package',
        version: 1,
        noir_version: [2, 0],
        document: 'scene.noir',
        files: [
          {
            path: 'image.png',
            kind: 'image',
            asset_id: 4,
            byte_length: png.length,
            sha256: '0'.repeat(64),
          },
        ],
      },
      new Map([['image.png', png]]),
      new Map([[2, source]]),
    );
    const effect = await runtime.instantiate(publicPack, {
      displayMatrix: [8, 0, 0, 0, 0, -8, 0, 0, 0, 0, 0.001, 0, 32, 32, 0, 1],
    });
    effect.play();
    renderer.render({ container: effect.container, target, clear: true, clearColor: [0, 0, 0, 0] });
    publicResult[c.label] = Array.from(renderer.extract.pixels({ target }).pixels);
    effect.destroy();
    publicPack.dispose();
  }
  runtime.destroy();
  const glError = renderer.gl.getError();
  texture.destroy(true);
  target.destroy(true);
  container.destroy();
  app.destroy();
  return { result, publicResult, glError };
}

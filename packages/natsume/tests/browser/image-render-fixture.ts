import {
  Application,
  BufferImageSource,
  Texture,
  Container,
  RenderTexture,
  type WebGLRenderer,
} from 'pixi.js';
import { EffectPack } from '../../src/pack.js';
import { minimalDocument } from '../helpers.js';
import { SpriteAssetT } from '../../src/format/generated/noa/ir/sprite-asset.js';
import { AssetT } from '../../src/format/generated/noa/ir/asset.js';
import { UIImageT } from '../../src/format/generated/noa/ir/uiimage.js';
import { MeshT } from '../../src/format/generated/noa/mesh/mesh.js';
import { Vec3T } from '../../src/format/generated/noa/mesh/vec3.js';
import { Vec4T } from '../../src/format/generated/noa/mesh/vec4.js';
import { TexCoordT } from '../../src/format/generated/noa/mesh/tex-coord.js';
import { imageGeometry } from '../../src/rendering/image-geometry.js';
import { MaterialT } from '../../src/format/generated/noa/ir/material.js';
import { RenderStateT } from '../../src/format/generated/noa/ir/render-state.js';
import { MeshRendererT } from '../../src/format/generated/noa/ir/mesh-renderer.js';
import { SceneMesh } from '../../src/rendering/scene-mesh.js';
import { Scene } from '../../src/runtime/scene.js';
import { ensureMaterialPipe } from '../../src/rendering/material-pipe.js';
interface Point {
  x: number;
  y: number;
}
export interface ImageSample {
  label: string;
  type: number;
  method: number;
  origin: number;
  clockwise: boolean;
  aspect: boolean;
  center: boolean;
  sourceMesh: boolean;
  amount: number;
  multiplier: number;
  size: Point;
  pivot: Point;
  color: { r: number; g: number; b: number; a: number };
  pixels: number[];
}
export async function measureImages(native: {
  vertices: Point[];
  uv: Point[];
  triangles: number[];
  texture: number[];
  cases: ImageSample[];
}) {
  const app = new Application();
  await app.init({
    preference: 'webgl',
    preferWebGLVersion: 2,
    width: 128,
    height: 96,
    autoStart: false,
    antialias: false,
    backgroundAlpha: 0,
  });
  const renderer = app.renderer as WebGLRenderer;
  ensureMaterialPipe(renderer);
  const target = RenderTexture.create({ width: 128, height: 96, antialias: false }),
    container = new Container();
  const data = new Uint8Array(1024);
  for (let y = 0; y < 16; y++) data.set(native.texture.slice(y * 64, (y + 1) * 64), (15 - y) * 64);
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
  const doc = minimalDocument(),
    source = new MeshT();
  source.positions = native.vertices.map((p) => new Vec3T(p.x, p.y, 0));
  source.indices = native.triangles;
  source.texcoords = [
    new TexCoordT(
      0,
      2,
      native.uv.map((p) => new Vec4T(p.x, p.y, 0, 0)),
    ),
  ];
  const sprite = Object.assign(new SpriteAssetT(), {
    meshAssetId: 2,
    rect: { x: 0, y: 0, z: 16, w: 8 },
    pixelsPerUnit: 100,
    pivot: { x: 0.25, y: 1.25 },
    border: { x: 2, y: 1, z: 3, w: 2 },
  });
  doc.assets = [new AssetT(3, 4, sprite)];
  const pack = new EffectPack(
    doc,
    { format: 'noa-package', version: 1, noir_version: [2, 0], document: 'scene.noir', files: [] },
    new Map(),
    new Map([[2, source]]),
  );
  const scene = new Scene(pack, [1]),
    results: Record<string, number[]> = {};
  for (const c of native.cases) {
    const image = Object.assign(new UIImageT(), {
      spriteAssetId: 3,
      type: c.type,
      fillMethod: c.method,
      fillOrigin: c.origin,
      fillClockwise: c.clockwise,
      fillAmount: c.amount,
      preserveAspect: c.aspect,
      fillCenter: c.center,
      useSpriteMesh: c.sourceMesh,
      pixelsPerUnitMultiplier: c.multiplier,
    });
    const geometry = imageGeometry(pack, image, c.size.x, c.size.y, c.pivot);
    const material = new MaterialT();
    material.model = 7;
    material.renderState = new RenderStateT();
    material.renderState.cull = 0;
    material.renderState.srcRgb = material.renderState.srcAlpha = 1;
    const mesh = new SceneMesh(
      scene.ordered[0]!,
      new MeshRendererT(),
      material,
      geometry,
      0,
      texture,
      pack,
    );
    mesh.rendererColor = () => c.color;
    mesh.uiContext = () => ({ gamma: false, alphaClip: false });
    container.addChild(mesh);
    mesh.sync([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0.001, 0, 64, 48, 0, 1], 'gamma');
    renderer.render({ container, target, clear: true, clearColor: [0, 0, 0, 0] });
    results[c.label] = Array.from(renderer.extract.pixels({ target }).pixels);
    container.removeChild(mesh);
    mesh.destroy();
  }
  const error = renderer.gl.getError();
  pack.dispose();
  texture.destroy(true);
  target.destroy(true);
  container.destroy();
  app.destroy();
  return { results, error };
}

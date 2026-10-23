import { SpriteMaskT } from '../../src/format/generated/noa/ir/sprite-mask.js';
import { Application, Container, Graphics, RenderTexture, type WebGLRenderer } from 'pixi.js';
import { NatsumeRuntime } from '../../src/runtime/runtime.js';
import { EffectPack } from '../../src/pack.js';
import { minimalDocument } from '../helpers.js';
import { AssetT } from '../../src/format/generated/noa/ir/asset.js';
import { ComponentT } from '../../src/format/generated/noa/ir/component.js';
import { ComponentData as C } from '../../src/format/generated/noa/ir/component-data.js';
import { NodeT } from '../../src/format/generated/noa/ir/node.js';
import { CanvasT } from '../../src/format/generated/noa/ir/canvas.js';
import { CanvasGroupT } from '../../src/format/generated/noa/ir/canvas-group.js';
import { CanvasRendererT } from '../../src/format/generated/noa/ir/canvas-renderer.js';
import { RectLayoutT } from '../../src/format/generated/noa/ir/rect-layout.js';
import { UIImageT } from '../../src/format/generated/noa/ir/uiimage.js';
import { UIMaskT } from '../../src/format/generated/noa/ir/uimask.js';
import { RectMask2DT } from '../../src/format/generated/noa/ir/rect-mask2-d.js';
import { SpriteAssetT } from '../../src/format/generated/noa/ir/sprite-asset.js';
import { Vec2T } from '../../src/format/generated/noa/ir/vec2.js';
import { Vec3T } from '../../src/format/generated/noa/ir/vec3.js';
import { Vec4T } from '../../src/format/generated/noa/ir/vec4.js';
import { ColorT } from '../../src/format/generated/noa/ir/color.js';
import { MeshT } from '../../src/format/generated/noa/mesh/mesh.js';
import { Vec3T as MVec3 } from '../../src/format/generated/noa/mesh/vec3.js';
import { Vec4T as MVec4 } from '../../src/format/generated/noa/mesh/vec4.js';
import { TexCoordT } from '../../src/format/generated/noa/mesh/tex-coord.js';
import type { ImageSample } from './image-render-fixture.js';
export interface MaskSample {
  label: string;
  depth: number;
  rectMode: number;
  showGraphic: boolean;
  maskable: boolean;
  ignoreGroup: boolean;
  cull: boolean;
  groupAlpha: number;
  pixels: number[];
  nested?: boolean;
  nestedOrder?: number;
}
export async function measureUIMasks(
  native: { cases: MaskSample[] },
  image: {
    texture: number[];
    vertices: { x: number; y: number }[];
    uv: { x: number; y: number }[];
    triangles: number[];
    cases: ImageSample[];
  },
) {
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
  const renderer = app.renderer as WebGLRenderer,
    runtime = new NatsumeRuntime(renderer);
  const target = RenderTexture.create({ width: 128, height: 96, antialias: false });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const bytes = new Uint8ClampedArray(1024);
  for (let y = 0; y < 16; y++) bytes.set(image.texture.slice(y * 64, (y + 1) * 64), (15 - y) * 64);
  canvas.getContext('2d')!.putImageData(new ImageData(bytes, 16, 16), 0, 0);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
  const png = new Uint8Array(await blob.arrayBuffer());
  const results: Record<string, number[]> = {},
    hostResults: Record<string, number[]> = {};
  let steady: { draws: number; uploads: number; updateMs: number; submitMs: number } | undefined;
  for (const c of native.cases) {
    const doc = minimalDocument();
    // Reserve the Sprite Mask bit even when its optional sprite is empty.
    doc.components.push(new ComponentT(9000, 1, true, C.SpriteMask, new SpriteMaskT()));
    let serial = 10;
    const component = (id: number, type: C, data: ComponentT['data']) => {
      const v = new ComponentT(serial++, id, true, type, data);
      doc.components.push(v);
      return v.id;
    };
    const rect = (parent: number, w: number, h: number, x = 0, y = 0) => {
      const id = serial++;
      doc.nodes.push(new NodeT(id, 'rect', parent, true, structuredClone(doc.nodes[0]!.transform)));
      component(
        id,
        C.RectLayout,
        new RectLayoutT(
          new Vec2T(0.5, 0.5),
          new Vec2T(0.5, 0.5),
          new Vec2T(0.5, 0.5),
          new Vec3T(x, y, 0),
          new Vec2T(w, h),
        ),
      );
      return id;
    };
    const graphic = (node: number, color: ColorT, maskable = true, cull = false) => {
      component(node, C.CanvasRenderer, new CanvasRendererT(cull));
      return component(
        node,
        C.UIImage,
        Object.assign(new UIImageT(), { spriteAssetId: 3, color, maskable }),
      );
    };
    component(
      1,
      C.RectLayout,
      new RectLayoutT(
        new Vec2T(0.5, 0.5),
        new Vec2T(0.5, 0.5),
        new Vec2T(0.5, 0.5),
        new Vec3T(),
        new Vec2T(128, 96),
      ),
    );
    component(1, C.Canvas, Object.assign(new CanvasT(), { mode: 2 }));
    component(1, C.CanvasGroup, new CanvasGroupT(c.groupAlpha));
    let parent = 1;
    for (let i = 0; i < c.depth; i++) {
      parent = rect(parent, 68 - i * 16, 48 - i * 10, i === 0 ? -4 : 8, i === 0 ? 0 : 2);
      const id = graphic(parent, new ColorT(0.3, 0.8, 0.4, 0.7));
      component(parent, C.UIMask, new UIMaskT(id, c.showGraphic));
    }
    if (c.rectMode > 0) {
      parent = rect(parent, 38, 26, 3, -2);
      component(
        parent,
        C.RectMask2D,
        new RectMask2DT(new Vec4T(1, 2, 3, 4), c.rectMode >= 2 ? new Vec2T(2, 3) : new Vec2T()),
      );
      if (c.rectMode === 3) {
        parent = rect(parent, 28, 22, -2, 3);
        component(parent, C.RectMask2D, new RectMask2DT(new Vec4T(0, 1, 2, 0), new Vec2T(4, 1)));
      }
    }
    if (c.nested) {
      parent = rect(parent, 128, 96);
      component(
        parent,
        C.Canvas,
        Object.assign(new CanvasT(), {
          mode: 2,
          overrideSorting: true,
          sortingOrder: c.nestedOrder,
        }),
      );
    }
    parent = rect(parent, 128, 96);
    component(parent, C.CanvasGroup, new CanvasGroupT(0.7, c.ignoreGroup));
    graphic(rect(parent, 82, 56, 6, 1), new ColorT(0.9, 0.6, 0.8, 0.63), c.maskable, c.cull);
    const source = new MeshT();
    source.positions = image.vertices.map((p) => new MVec3(p.x, p.y, 0));
    source.indices = image.triangles;
    source.texcoords = [
      new TexCoordT(
        0,
        2,
        image.uv.map((p) => new MVec4(p.x, p.y, 0, 0)),
      ),
    ];
    const sprite = Object.assign(new SpriteAssetT(), {
      imageAssetId: 4,
      meshAssetId: 2,
      rect: new Vec4T(0, 0, 16, 8),
      pixelsPerUnit: 100,
      pivot: new Vec2T(0.25, 1.25),
      border: new Vec4T(2, 1, 3, 2),
      colorSpace: 2,
    });
    doc.assets = [new AssetT(3, 4, sprite)];
    const pack = new EffectPack(
      doc,
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
    const effect = await runtime.instantiate(pack, {
      displayMatrix: [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0.001, 0, 64, 48, 0, 1],
    });
    effect.play();
    renderer.render({ container: effect.container, target, clear: true, clearColor: [0, 0, 0, 0] });
    results[c.label] = Array.from(renderer.extract.pixels({ target }).pixels);
    if (c.label === '2-3-True-True') {
      const gl = renderer.gl,
        draw = gl.drawElements,
        upload = gl.bufferSubData;
      let draws = 0,
        uploads = 0;
      gl.drawElements = function (...args) {
        draws++;
        return draw.apply(this, args);
      };
      gl.bufferSubData = new Proxy(upload, {
        apply(fn, receiver, args) {
          uploads++;
          return Reflect.apply(fn, receiver, args);
        },
      });
      const start = performance.now();
      effect.update(0);
      const middle = performance.now();
      renderer.render({
        container: effect.container,
        target,
        clear: true,
        clearColor: [0, 0, 0, 0],
      });
      steady = { draws, uploads, updateMs: middle - start, submitMs: performance.now() - middle };
      gl.drawElements = draw;
      gl.bufferSubData = upload;
    }
    if (c.label === '2-3-True-True' || c.label === '1-0-False-False') {
      const host = new Container(),
        mask = new Graphics().rect(0, 0, 64, 96).fill(0xffffff),
        sibling = new Graphics().rect(112, 8, 8, 8).fill(0xff0000);
      host.addChild(effect.container, mask, sibling);
      effect.container.mask = mask;
      renderer.render({ container: host, target, clear: true, clearColor: [0, 0, 0, 0] });
      hostResults[c.label] = Array.from(renderer.extract.pixels({ target }).pixels);
      effect.container.mask = null;
      host.removeChild(effect.container);
      host.destroy({ children: true });
    }
    effect.destroy();
    pack.dispose();
  }
  const error = renderer.gl.getError();
  runtime.destroy();
  target.destroy(true);
  app.destroy();
  return { results, hostResults, error, steady };
}

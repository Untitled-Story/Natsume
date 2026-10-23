import { Application, RenderTexture, Container, Graphics, type WebGLRenderer } from 'pixi.js';
import { mat4 } from 'gl-matrix';
import { EffectPack } from '../../src/pack.js';
import { NatsumeRuntime } from '../../src/runtime/runtime.js';
import { minimalDocument } from '../helpers.js';
import { CanvasT } from '../../src/format/generated/noa/ir/canvas.js';
import { CanvasRendererT } from '../../src/format/generated/noa/ir/canvas-renderer.js';
import { UIImageT } from '../../src/format/generated/noa/ir/uiimage.js';
import { ComponentT } from '../../src/format/generated/noa/ir/component.js';
import { ComponentData as C } from '../../src/format/generated/noa/ir/component-data.js';
import { RectLayoutT } from '../../src/format/generated/noa/ir/rect-layout.js';
import { Vec2T } from '../../src/format/generated/noa/ir/vec2.js';
import { Vec3T } from '../../src/format/generated/noa/ir/vec3.js';
import { ColorT } from '../../src/format/generated/noa/ir/color.js';
import { canvasLayout } from '../../src/rendering/canvas-layout.js';
import { eulerQuaternion } from '../../src/runtime/animation-bindings.js';
const matrix = (m: Record<string, number>) =>
  Array.from({ length: 16 }, (_, i) => m['e' + (i % 4) + Math.floor(i / 4)]!);
export interface CanvasSample {
  label: string;
  mode: number;
  orthographic: boolean;
  plane: number;
  viewport: { x: number; y: number; width: number; height: number };
  view: Record<string, number>;
  projection: Record<string, number>;
  pixels: number[];
}
export async function measureCanvas(native: { cases: CanvasSample[] }) {
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
    runtime = new NatsumeRuntime(renderer),
    target = RenderTexture.create({ width: 128, height: 96, antialias: false }),
    results: Record<string, number[]> = {};
  let atomic = false;
  let overlay = false;
  for (const c of native.cases) {
    if (c.mode === 0 || (c.mode === 2 && !c.orthographic)) continue;
    const doc = minimalDocument(),
      root = doc.nodes[0]!,
      q = eulerQuaternion([10, 20, 30].map((v) => (v * Math.PI) / 180));
    Object.assign(root.transform!.rotation!, { x: q[0], y: q[1], z: q[2], w: q[3] });
    Object.assign(root.transform!.scale!, { x: 0.2, y: 0.3, z: 0.4 });
    const canvas = Object.assign(new CanvasT(), {
      mode: c.mode,
      planeDistance: c.plane,
      hostCameraSlot: 'main-camera',
    });
    doc.components = [
      new ComponentT(
        3,
        1,
        true,
        C.RectLayout,
        new RectLayoutT(
          new Vec2T(0.5, 0.5),
          new Vec2T(0.5, 0.5),
          new Vec2T(0.25, 0.75),
          new Vec3T(4, 5, 3),
          new Vec2T(160, 120),
        ),
      ),
      new ComponentT(4, 1, true, C.Canvas, canvas),
      new ComponentT(5, 1, true, C.CanvasRenderer, new CanvasRendererT()),
      new ComponentT(
        6,
        1,
        true,
        C.UIImage,
        Object.assign(new UIImageT(), { color: new ColorT(0.8, 0.4, 0.2, 0.6) }),
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
      new Map(),
    );
    const env = {
      displays: { 0: { width: 128, height: 96 } },
      mainCamera: {
        viewMatrix: matrix(c.view),
        projectionMatrix: matrix(c.projection),
        viewport: c.viewport,
      },
    };
    const display = canvasLayout(
      Object.assign(new CanvasT(), { mode: 1, planeDistance: 1 }),
      env,
    ).display;
    const effect = await runtime.instantiate(pack, {
      canvasEnvironment: env,
      displayMatrix: c.mode === 2 ? display : mat4.create(),
    });
    effect.play();
    const host = new Container();
    host.addChild(effect.container);
    if (c.mode === 2) {
      const v = c.viewport,
        mask = new Graphics()
          .rect(v.x * 128, (1 - v.y - v.height) * 96, v.width * 128, v.height * 96)
          .fill(0xffffff);
      host.addChild(mask);
      effect.container.mask = mask;
    }
    renderer.render({ container: host, target, clear: true, clearColor: [0, 0, 0, 0] });
    results[c.label] = Array.from(renderer.extract.pixels({ target }).pixels);
    const before = Array.from(effect.simulation.scene.nodes.get(1)!.worldMatrix);
    try {
      effect.setCanvasEnvironment({ ...env, displays: { 0: { width: 0, height: 96 } } });
    } catch {
      atomic = before.every((v, i) => v === effect.simulation.scene.nodes.get(1)!.worldMatrix[i]);
    }
    if (c.mode === 1) {
      effect.setCanvasEnvironment({ ...env, displays: { 0: { width: 256, height: 192 } } });
      const size = effect.simulation.scene.layoutSize!;
      if (Math.abs(size.width - 256 * c.viewport.width) > 1e-4)
        throw new Error('Display resize did not update Canvas layout');
    }
    effect.container.mask = null;
    host.removeChild(effect.container);
    host.destroy({ children: true });
    effect.destroy();
    pack.dispose();
  }
  const doc = minimalDocument();
  doc.components = [
    new ComponentT(
      3,
      1,
      true,
      C.RectLayout,
      new RectLayoutT(
        new Vec2T(0.5, 0.5),
        new Vec2T(0.5, 0.5),
        new Vec2T(0.5, 0.5),
        new Vec3T(),
        new Vec2T(1, 1),
      ),
    ),
    new ComponentT(4, 1, true, C.Canvas, new CanvasT()),
    new ComponentT(5, 1, true, C.CanvasRenderer, new CanvasRendererT()),
    new ComponentT(
      6,
      1,
      true,
      C.UIImage,
      Object.assign(new UIImageT(), { color: new ColorT(1, 0, 0, 1) }),
    ),
  ];
  const pack = new EffectPack(
    doc,
    { format: 'noa-package', version: 1, noir_version: [2, 0], document: 'scene.noir', files: [] },
    new Map(),
    new Map(),
  );
  const report = runtime.checkCompatibility(pack);
  let rejected = false;
  try {
    await runtime.instantiate(pack);
  } catch {
    rejected = true;
  }
  const effect = await runtime.instantiate(pack, {
    canvasEnvironment: { displays: { 0: { width: 128, height: 96 } } },
  });
  effect.play();
  renderer.render({ container: effect.container, target, clear: true, clearColor: [0, 0, 0, 0] });
  const pixels = renderer.extract.pixels({ target }).pixels;
  overlay =
    rejected &&
    !report.compatible &&
    pixels.every((v, i) => v === (i % 4 === 0 || i % 4 === 3 ? 255 : 0));
  effect.setCanvasEnvironment({ displays: { 0: { width: 64, height: 48 } } });
  renderer.render({ container: effect.container, target, clear: true, clearColor: [0, 0, 0, 0] });
  const resized = renderer.extract.pixels({ target }).pixels;
  overlay &&= resized.every(
    (v, i) =>
      v ===
      (Math.floor(i / 4) % 128 < 64 && Math.floor(i / 512) < 48 && (i % 4 === 0 || i % 4 === 3)
        ? 255
        : 0),
  );
  effect.destroy();
  pack.dispose();
  const error = renderer.gl.getError();
  runtime.destroy();
  target.destroy(true);
  app.destroy();
  return { results, error, atomic, overlay };
}

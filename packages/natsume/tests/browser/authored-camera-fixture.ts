import { Application, RenderTexture, type WebGLRenderer } from 'pixi.js';
import * as I from '../../src/format/generated/noa/ir.js';
import { MeshT } from '../../src/format/generated/noa/mesh/mesh.js';
import { Vec3T } from '../../src/format/generated/noa/mesh/vec3.js';
import { Vec4T } from '../../src/format/generated/noa/mesh/vec4.js';
import { SubmeshT } from '../../src/format/generated/noa/mesh/submesh.js';
import { EffectPack, NatsumeRuntime } from '../../src/index.js';
import { minimalDocument } from '../helpers.js';
import { linear } from '../particle-fixtures.js';

function fixture(clear: number, partial: boolean, reverse: boolean) {
  const doc = minimalDocument();
  doc.entries[0]!.cameraPolicy = 1;
  doc.entries[0]!.cameraComponentId = 11;
  const material = new I.MaterialT(
    30,
    'opaque',
    I.MaterialModel.TextureVertexColor,
    new I.ColorT(1, 1, 1, 1),
  );
  material.renderQueue = 2000;
  material.renderState = new I.RenderStateT();
  material.renderState.depthWrite = true;
  material.renderState.srcRgb = material.renderState.srcAlpha = 1;
  material.renderState.dstRgb = material.renderState.dstAlpha = 0;
  doc.materials = [material];
  const meshes = new Map<number, MeshT>();
  for (let i = 0; i < 2; i++) {
    const node = new I.NodeT(
      3 + i,
      'mesh',
      1,
      true,
      structuredClone(doc.nodes[0]!.transform),
      1 << i,
    );
    node.transform!.position!.z = i;
    doc.nodes.push(node);
    const mesh = new MeshT();
    mesh.positions = [
      new Vec3T(-1, -1, 0),
      new Vec3T(1, -1, 0),
      new Vec3T(1, 1, 0),
      new Vec3T(-1, 1, 0),
    ];
    mesh.colors = mesh.positions.map(() => new Vec4T(i === 0 ? 1 : 0, 0, i === 1 ? 1 : 0, 1));
    mesh.indices = [0, 1, 2, 0, 2, 3];
    mesh.submeshes = [new SubmeshT(0, 6)];
    meshes.set(40 + i, mesh);
    doc.components.push(
      new I.ComponentT(
        20 + i * 2,
        node.id,
        true,
        I.ComponentData.MeshFilter,
        new I.MeshFilterT(40 + i),
      ),
      new I.ComponentT(
        21 + i * 2,
        node.id,
        true,
        I.ComponentData.MeshRenderer,
        new I.MeshRendererT(20 + i * 2, [30]),
      ),
    );
    const cameraNode = new I.NodeT(
      10 + i * 2,
      'camera',
      1,
      true,
      structuredClone(doc.nodes[0]!.transform),
    );
    cameraNode.transform!.position!.z = -5;
    doc.nodes.push(cameraNode);
    const c = new I.CameraT();
    c.projection = 1;
    c.orthoHalfHeight = 2;
    c.nearPlane = 0.1;
    c.farPlane = 100;
    c.viewport = new I.Vec4T(0, 0, 1, 1);
    c.clear = i === 0 ? 1 : clear;
    c.background = new I.ColorT(0, i === 0 ? 1 : 0.5, 0, 1);
    c.cullingMask = 1 << i;
    c.order = reverse ? (i === 0 ? 0.25 : -0.5) : i === 0 ? -0.5 : 0.25;
    if (partial && i === 1) c.viewport = new I.Vec4T(0.25, 0.25, 0.5, 0.5);
    doc.components.push(
      new I.ComponentT(11 + i * 2, cameraNode.id, true, I.ComponentData.Camera, c),
    );
  }
  return new EffectPack(doc, { files: [] } as never, new Map(), meshes);
}
export async function measureCameraCanvas() {
  const app = new Application();
  await app.init({
    preference: 'webgl',
    preferWebGLVersion: 2,
    width: 64,
    height: 48,
    autoStart: false,
    antialias: false,
  });
  const runtime = new NatsumeRuntime(app.renderer as WebGLRenderer);
  const base = fixture(1, false, false),
    doc = structuredClone(base.document) as I.DocumentT;
  base.dispose();
  doc.features.push(
    ...['camera.authored', 'camera.embedded', 'animation.camera'].map(
      (name) => new I.FeatureRequirementT(name, 1, true),
    ),
  );
  const camera = doc.components.find((c) => c.id === 11)!.data as I.CameraT;
  const node = new I.NodeT(50, 'canvas', 1, true, structuredClone(doc.nodes[0]!.transform));
  node.layerMask = 1;
  doc.nodes.push(node);
  const canvas = new I.CanvasT();
  canvas.mode = 1;
  canvas.planeDistance = 1;
  doc.components.push(
    new I.ComponentT(51, 50, true, I.ComponentData.Canvas, canvas),
    new I.ComponentT(
      52,
      50,
      true,
      I.ComponentData.RectLayout,
      new I.RectLayoutT(
        new I.Vec2T(0.5, 0.5),
        new I.Vec2T(0.5, 0.5),
        new I.Vec2T(0.5, 0.5),
        new I.Vec3T(),
        new I.Vec2T(10, 10),
      ),
    ),
    new I.ComponentT(53, 50, true, I.ComponentData.CanvasRenderer, new I.CanvasRendererT()),
    new I.ComponentT(
      54,
      50,
      true,
      I.ComponentData.UIImage,
      Object.assign(new I.UIImageT(), { color: new I.ColorT(1, 1, 0, 1) }),
    ),
  );
  // One active source view makes pixel evidence independent of a second clear pass.
  doc.components.find((c) => c.id === 13)!.enabled = false;
  doc.animations = [
    new I.AnimationT(60, 'camera', 1, false, [
      new I.TrackT(
        new I.BindingT(null, 11, I.AnimationProperty.CameraOrthoSize),
        I.TrackData.FloatTrack,
        new I.FloatTrackT(linear(2, 4).curveMax),
      ),
      new I.TrackT(
        new I.BindingT(null, 11, I.AnimationProperty.CameraActive),
        I.TrackData.BoolTrack,
        new I.BoolTrackT([
          new I.BoolKeyT(0, true),
          new I.BoolKeyT(0.5, false),
          new I.BoolKeyT(0.75, true),
        ]),
      ),
    ]),
  ];
  doc.entries[0]!.actions = [new I.ActionT(I.ActionKind.PlayClip, 0, 60)];
  // Scene geometry is not required by this UI-only fixture.
  doc.components = doc.components.filter(
    (c) => c.dataType !== I.ComponentData.MeshFilter && c.dataType !== I.ComponentData.MeshRenderer,
  );
  const pack = new EffectPack(doc, { files: [] } as never, new Map(), new Map());
  const target = RenderTexture.create({ width: 64, height: 48, antialias: false });
  try {
    const effect = await runtime.instantiate(pack, {
      cameraEnvironment: { targetDisplay: 0, width: 64, height: 48, mainCameraId: 11 },
      sourceColorSpace: 'gamma',
    });
    try {
      const sample = () => {
        app.renderer.render({
          container: effect.container,
          target,
          clear: true,
          clearColor: [0, 0, 0, 0],
        });
        return Array.from(
          (app.renderer as WebGLRenderer).extract
            .pixels({ target })
            .pixels.slice((24 * 64 + 32) * 4, (24 * 64 + 32) * 4 + 4),
        );
      };
      const advance = () => {
        for (let i = 0; i < 15; i++) effect.update(1 / 60);
      };
      effect.play();
      const initial = sample();
      advance();
      const animatedSize = effect.simulation.bindings.cameras.get(11)!.orthoHalfHeight;
      const layout = { ...effect.simulation.scene.nodes.get(50)!.layout! };
      advance();
      const inactive = sample();
      advance();
      const endpoint = sample();
      effect.update(1 / 60);
      const active = sample();
      effect.setCameraEnvironment({ targetDisplay: 0, width: 128, height: 48, mainCameraId: 11 });
      const resized = { ...effect.simulation.scene.nodes.get(50)!.layout! };
      effect.restart();
      const restarted = effect.simulation.bindings.cameras.get(11)!.orthoHalfHeight;
      return {
        initial,
        inactive,
        endpoint,
        active,
        animatedSize,
        layout,
        resized,
        restarted,
        original: camera.orthoHalfHeight,
      };
    } finally {
      effect.destroy();
    }
  } finally {
    target.destroy(true);
    pack.dispose();
    runtime.destroy();
    app.destroy();
  }
}
export async function measureAuthoredCameras() {
  const app = new Application();
  await app.init({
    preference: 'webgl',
    preferWebGLVersion: 2,
    autoStart: false,
    width: 64,
    height: 48,
    antialias: false,
  });
  const renderer = app.renderer as WebGLRenderer,
    runtime = new NatsumeRuntime(renderer);
  const target = RenderTexture.create({ width: 64, height: 48, antialias: false });
  const cases = [];
  for (const sourceColorSpace of ['gamma', 'linear'] as const)
    for (const clear of [0, 1, 2, 3])
      for (const partial of [false, true])
        for (const reverse of [false, true]) {
          const pack = fixture(clear, partial, reverse);
          const missing = runtime.checkCompatibility(pack);
          if (missing.compatible) throw new Error('Missing camera environment accepted');
          const effect = await runtime.instantiate(pack, {
            cameraEnvironment: { targetDisplay: 0, width: 64, height: 48, mainCameraId: 11 },
            sourceColorSpace,
          });
          try {
            effect.play();
            const sample = () => {
              renderer.render({
                container: effect.container,
                target,
                clear: true,
                clearColor: [0, 0, 0, 0],
              });
              const pixels = renderer.extract.pixels({ target }).pixels;
              const at = (x: number, y: number) =>
                Array.from(pixels.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4));
              return {
                center: at(32, 24),
                corner: at(2, 2),
                edge: at(20, 24),
                raw: Array.from(pixels),
              };
            };
            const pixels = sample();
            effect.setCameraEnvironment({ targetDisplay: 1, width: 64, height: 48 });
            const otherDisplay = sample();
            effect.setCameraEnvironment({ targetDisplay: 0, width: 64, height: 48 });
            let rejected = false;
            try {
              effect.setCameraEnvironment({ targetDisplay: 0, width: 0, height: 48 });
            } catch {
              rejected = true;
            }
            if (!rejected) throw new Error('Invalid camera size accepted');
            const restored = sample();
            effect.restart();
            const restarted = sample();
            cases.push({
              sourceColorSpace,
              clear,
              partial,
              reverse,
              pixels,
              otherDisplay,
              restored,
              restarted,
            });
          } finally {
            effect.destroy();
            pack.dispose();
          }
        }
  target.destroy(true);
  runtime.destroy();
  app.destroy();
  return cases;
}

export async function measureNativeCameraCanvases(
  cases: { mode: number; observer: number; masked: boolean; enabled: boolean }[],
) {
  const app = new Application();
  await app.init({
    preference: 'webgl',
    preferWebGLVersion: 2,
    width: 64,
    height: 48,
    autoStart: false,
    antialias: false,
  });
  const runtime = new NatsumeRuntime(app.renderer as WebGLRenderer),
    target = RenderTexture.create({ width: 64, height: 48, antialias: false });
  const results = [];
  try {
    for (const c of cases) {
      const base = fixture(1, false, false),
        doc = structuredClone(base.document) as I.DocumentT;
      base.dispose();
      doc.components = doc.components.filter((c) => c.dataType === I.ComponentData.Camera);
      for (const component of doc.components) {
        const camera = component.data as I.CameraT;
        camera.cullingMask = c.masked ? 0 : ~0;
        camera.background = new I.ColorT(0, 0, 0, 0);
        camera.clear = 1;
        component.enabled = component.id === 11 ? c.observer === 0 || c.enabled : c.observer === 1;
      }
      const node = new I.NodeT(50, 'canvas', 1, true, structuredClone(doc.nodes[0]!.transform));
      doc.nodes.push(node);
      const canvas = new I.CanvasT();
      canvas.mode = c.mode;
      canvas.cameraComponentId = 11;
      canvas.planeDistance = 1;
      doc.components.push(
        new I.ComponentT(51, 50, true, I.ComponentData.Canvas, canvas),
        new I.ComponentT(
          52,
          50,
          true,
          I.ComponentData.RectLayout,
          new I.RectLayoutT(
            new I.Vec2T(0.5, 0.5),
            new I.Vec2T(0.5, 0.5),
            new I.Vec2T(0.5, 0.5),
            new I.Vec3T(),
            new I.Vec2T(4, 4),
          ),
        ),
        new I.ComponentT(53, 50, true, I.ComponentData.CanvasRenderer, new I.CanvasRendererT()),
        new I.ComponentT(
          54,
          50,
          true,
          I.ComponentData.UIImage,
          Object.assign(new I.UIImageT(), { color: new I.ColorT(1, 1, 0, 1) }),
        ),
      );
      const pack = new EffectPack(doc, { files: [] } as never, new Map(), new Map());
      try {
        const effect = await runtime.instantiate(pack, {
          sourceColorSpace: 'gamma',
          cameraEnvironment: { targetDisplay: 0, width: 64, height: 48 },
        });
        try {
          effect.play();
          app.renderer.render({
            container: effect.container,
            target,
            clear: true,
            clearColor: [0, 0, 0, 0],
          });
          results.push(
            Array.from(
              (app.renderer as WebGLRenderer).extract
                .pixels({ target })
                .pixels.slice((24 * 64 + 32) * 4, (24 * 64 + 32) * 4 + 4),
            ),
          );
        } finally {
          effect.destroy();
        }
      } finally {
        pack.dispose();
      }
    }
  } finally {
    target.destroy(true);
    runtime.destroy();
    app.destroy();
  }
  return results;
}

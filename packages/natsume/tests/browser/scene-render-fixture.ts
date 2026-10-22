import { TextureBindingT } from '../../src/format/generated/noa/ir/texture-binding.js';
import { Vec2T } from '../../src/format/generated/noa/ir/vec2.js';
import { SceneNode } from '../../src/runtime/scene.js';
import { StencilStateT } from '../../src/format/generated/noa/ir/stencil-state.js';
import { StencilFaceT } from '../../src/format/generated/noa/ir/stencil-face.js';
import {
  Application,
  BufferImageSource,
  Container,
  RenderTexture,
  Texture,
  type WebGLRenderer,
} from 'pixi.js';
import { loadPack, NatsumeRuntime } from '../../src/index.js';
import { ensureMaterialPipe } from '../../src/rendering/material-pipe.js';
import { SceneMesh, sceneMaterialPasses } from '../../src/rendering/scene-mesh.js';
import { Scene } from '../../src/runtime/scene.js';
import { MeshRendererT } from '../../src/format/generated/noa/ir/mesh-renderer.js';
import { MaterialT } from '../../src/format/generated/noa/ir/material.js';
import { RenderStateT } from '../../src/format/generated/noa/ir/render-state.js';
import { ColorT } from '../../src/format/generated/noa/ir/color.js';
import { RenderEnvironmentT } from '../../src/format/generated/noa/ir/render-environment.js';

interface Slots {
  label: string;
  slots: number[];
  shadow: number;
  pixels: number[];
}
interface Pass {
  label: string;
  src: number;
  dst: number;
  srcAlpha: number;
  dstAlpha: number;
  op: number;
  alphaOp: number;
  compare: number;
  cull: number;
  mask: number;
  premultiply: boolean;
  scale: number[];
  textured: boolean;
  uvSet: number;
  mipmaps: boolean;
  bias: number;
  st: number[];
  tint: number[];
  color: number[];
  pixels: number[];
}
export async function measureSceneMaterials(
  bytes: number[],
  samples: Slots[],
  states: Pass[],
  layers: {
    label: string;
    draws: (Pass & {
      depth: number;
      write: boolean;
      stencilCompare: number;
      stencilReference: number;
      stencilPass: number;
      stencilFail: number;
      stencilDepthFail: number;
      readMask: number;
      writeMask: number;
    })[];
    pixels: number[];
  }[],
) {
  const app = new Application();
  await app.init({
    preference: 'webgl',
    preferWebGLVersion: 2,
    width: 64,
    height: 64,
    autoStart: false,
    antialias: false,
    backgroundAlpha: 0,
  });
  const renderer = app.renderer as WebGLRenderer;
  ensureMaterialPipe(renderer);
  const pack = await loadPack(Uint8Array.from(bytes));
  const scene = new Scene(pack, pack.document.entries[0]!.roots);
  const node = scene.ordered[0]!,
    geometry = pack.getMesh(pack.document.assets.find((a) => a.kind === 2)!.id)!;
  const target = RenderTexture.create({ width: 64, height: 64, antialias: false });
  const container = new Container();
  const matrix = [16, 0, 0, 0, 0, -16, 0, 0, 0, 0, 0.001, 0, 32, 32, 0, 1];
  const colors = [
    [1, 0, 0, 1],
    [0, 1, 0, 1],
    [0, 0, 1, 0.5],
    [1, 1, 0, 0.5],
  ];
  const results: Record<string, number[]> = {};
  const read = () => {
    renderer.render({ container, target, clear: true });
    const pixels = renderer.extract.pixels({ target }).pixels;
    return [16, 48].flatMap((x) =>
      Array.from(pixels.slice((32 * 64 + x) * 4, (32 * 64 + x) * 4 + 4)),
    );
  };
  const clear = () => {
    for (const m of container.removeChildren()) m.destroy();
  };
  for (const sample of samples) {
    const definition = new MeshRendererT();
    definition.materials = sample.slots.map((s) => (s < 0 ? 0 : s + 1));
    definition.environment = new RenderEnvironmentT(sample.shadow);
    for (const pass of sceneMaterialPasses(definition, geometry)) {
      const c = colors[sample.slots[pass.slot]!]!;
      const material = new MaterialT();
      material.model = 6;
      material.tint = new ColorT(...(c as [number, number, number, number]));
      material.renderState = new RenderStateT();
      material.renderState.srcRgb = material.renderState.srcAlpha = 1;
      const mesh = new SceneMesh(
        node,
        definition,
        material,
        geometry,
        pass.submesh,
        Texture.WHITE,
        pack,
      );
      container.addChild(mesh);
      mesh.sync(matrix, 'gamma');
    }
    results[sample.label] = read();
    clear();
  }
  for (const sample of states) {
    const definition = new MeshRendererT();
    const material = new MaterialT();
    material.model = sample.premultiply ? 6 : 1;
    material.tint = new ColorT(...(sample.tint as [number, number, number, number]));
    const state = (material.renderState = new RenderStateT());
    Object.assign(state, {
      srcRgb: sample.src,
      dstRgb: sample.dst,
      srcAlpha: sample.srcAlpha,
      dstAlpha: sample.dstAlpha,
      rgbOp: sample.op,
      alphaOp: sample.alphaOp,
      depthTest: sample.compare,
      cull: sample.cull,
      colorWriteMask: sample.mask,
    });
    const colored = structuredClone(geometry) as typeof geometry;
    Object.assign(colored, {
      colors: geometry.positions.map(() => ({
        x: sample.color[0]!,
        y: sample.color[1]!,
        z: sample.color[2]!,
        w: sample.color[3]!,
      })),
    });
    let texture = Texture.WHITE;
    if (sample.textured) {
      material.model = 8;
      const binding = new TextureBindingT();
      binding.uvSet = sample.uvSet;
      binding.colorSpace = 2;
      binding.scale = new Vec2T(sample.st[0]!, sample.st[1]!);
      binding.offset = new Vec2T(sample.st[2]!, sample.st[3]!);
      material.textures = [binding];
      if (sample.uvSet === 0) {
        const values = [
          [0, 0],
          [0.5, 0],
          [0.5, 0.5],
          [0, 0.5],
          [0, 0],
          [0.5, 0],
          [0.5, 0.5],
          [0, 0.5],
        ].map(([x, y]) => ({ x: x!, y: y!, z: 0, w: 0 }));
        Object.assign(colored, { texcoords: [{ channel: 0, dimension: 2, values }] });
      }
      const data = new Uint8Array(256);
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const c =
            y >= 4
              ? x < 4
                ? [255, 0, 0, 255]
                : [0, 255, 0, 255]
              : x < 4
                ? [0, 0, 255, 255]
                : [255, 255, 0, 255];
          data.set(c, (y * 8 + x) * 4);
        }
      texture = new Texture({
        source: new BufferImageSource({
          resource: data,
          width: 8,
          height: 8,
          alphaMode: 'no-premultiply-alpha',
          autoGenerateMipmaps: sample.mipmaps,
          minFilter: sample.mipmaps ? 'linear' : 'nearest',
          magFilter: sample.mipmaps ? 'linear' : 'nearest',
          mipmapFilter: 'linear',
        }),
      });
    }
    const materialPack = Object.create(pack);
    materialPack.getAssetBytes = () =>
      new TextEncoder().encode(JSON.stringify({ global_mip_bias: sample.mipmaps }));
    const local = new SceneNode(node.source, undefined, undefined);
    local.worldMatrix[0] = sample.scale[0]!;
    local.worldMatrix[5] = sample.scale[1]!;
    local.worldMatrix[10] = sample.scale[2]!;
    const mesh = new SceneMesh(local, definition, material, colored, 0, texture, materialPack);
    const second = new SceneMesh(local, definition, material, colored, 1, texture, materialPack);
    container.addChild(second);
    second.sync(matrix, 'gamma');
    mesh.renderEnvironment = { globalMipBias: sample.bias };
    container.addChild(mesh);
    mesh.sync(matrix, 'gamma');
    renderer.background.color = [0.1, 0.2, 0.3, 0.4];
    renderer.render({ container, target, clear: true, clearColor: [0.1, 0.2, 0.3, 0.4] });
    const pixels = renderer.extract.pixels({ target }).pixels;
    results[sample.label] = Array.from(pixels.slice((32 * 64 + 16) * 4, (32 * 64 + 16) * 4 + 4));
    clear();
    if (texture !== Texture.WHITE) texture.destroy(true);
  }
  for (const sample of layers) {
    for (const d of sample.draws) {
      const definition = new MeshRendererT(),
        material = new MaterialT();
      material.model = 1;
      material.tint = new ColorT(...(d.tint as [number, number, number, number]));
      const state = (material.renderState = new RenderStateT());
      state.srcRgb = state.srcAlpha = 1;
      state.dstRgb = state.dstAlpha = 0;
      state.depthTest = d.compare;
      state.depthWrite = d.write;
      const f = new StencilFaceT(
        d.stencilCompare,
        d.stencilPass,
        d.stencilFail,
        d.stencilDepthFail,
      );
      state.stencil = new StencilStateT(d.stencilReference, d.readMask, d.writeMask, f, f);
      const local = new SceneNode(node.source, undefined, undefined);
      local.worldMatrix[14] = d.depth;
      const mesh = new SceneMesh(local, definition, material, geometry, 0, Texture.WHITE, pack);
      container.addChild(mesh);
      mesh.sync(matrix, 'gamma');
    }
    renderer.render({ container, target, clear: true, clearColor: [0.1, 0.2, 0.3, 0.4] });
    const pixels = renderer.extract.pixels({ target }).pixels;
    results[sample.label] = Array.from(pixels.slice((32 * 64 + 16) * 4, (32 * 64 + 16) * 4 + 4));
    clear();
  }
  const runtime = new NatsumeRuntime(renderer);
  const report = runtime.checkCompatibility(pack);
  const effect = await runtime.instantiate(pack, { displayMatrix: matrix });
  app.stage.addChild(effect.container);
  effect.play();
  effect.update(1 / 60);
  app.render();
  const lifecycle = {
    compatible: report.compatible,
    meshes: effect.container.children.length,
    nodes: effect.renderedNodes.length,
    glError: renderer.gl.getError(),
  };
  effect.pause();
  effect.restart();
  effect.destroy();
  runtime.destroy();
  pack.dispose();
  target.destroy(true);
  container.destroy();
  app.destroy();
  return { results, lifecycle };
}

/** Exercises ordinary-renderer animation through the public instance path. */
export async function exerciseSceneAnimation(bytes: number[]) {
  const { AnimationT } = await import('../../src/format/generated/noa/ir/animation.js');
  const { TrackT } = await import('../../src/format/generated/noa/ir/track.js');
  const { BindingT } = await import('../../src/format/generated/noa/ir/binding.js');
  const { ColorTrackT } = await import('../../src/format/generated/noa/ir/color-track.js');
  const { BoolTrackT } = await import('../../src/format/generated/noa/ir/bool-track.js');
  const { BoolKeyT } = await import('../../src/format/generated/noa/ir/bool-key.js');
  const { ScalarCurveT } = await import('../../src/format/generated/noa/ir/scalar-curve.js');
  const { FloatKeyT } = await import('../../src/format/generated/noa/ir/float-key.js');
  const { ActionT } = await import('../../src/format/generated/noa/ir/action.js');
  const { EffectPack } = await import('../../src/pack.js');
  const app = new Application();
  await app.init({
    preference: 'webgl',
    preferWebGLVersion: 2,
    width: 64,
    height: 64,
    autoStart: false,
    antialias: false,
  });
  const source = await loadPack(Uint8Array.from(bytes));
  const doc = structuredClone(
    source.document,
  ) as import('../../src/format/generated/noa/ir/document.js').DocumentT;
  const renderer = doc.components.find((c) => c.dataType === 7)!;
  const curve = new ScalarCurveT();
  curve.keys = [new FloatKeyT(0, 0.2, 0, 0, 0, 0, 1), new FloatKeyT(1, 0.8, 0, 0, 0, 0, 1)];
  const color = new ColorTrackT();
  color.r = curve;
  const binding = new BindingT(renderer.id, 22);
  binding.propertyName = '_Color';
  const clip = new AnimationT();
  clip.id = 1000000;
  clip.durationSeconds = 1;
  clip.tracks = [
    new TrackT(binding, 4, color),
    new TrackT(
      new BindingT(renderer.id, 13),
      5,
      new BoolTrackT([new BoolKeyT(0, true), new BoolKeyT(0.5, false), new BoolKeyT(0.75, true)]),
    ),
  ];
  doc.animations = [clip];
  doc.entries[0]!.actions = [new ActionT(1, 0, clip.id)];
  const files = new Map(
    source.manifest.files
      .filter((f) => f.asset_id)
      .map((f) => [f.path, source.getAssetBytes(f.asset_id!)!]),
  );
  const meshes = new Map(
    source.document.assets
      .filter((a) => a.kind === 2)
      .map((a) => [
        a.id,
        source.getMesh(a.id)! as import('../../src/format/generated/noa/mesh/mesh.js').MeshT,
      ]),
  );
  const pack = new EffectPack(doc, source.manifest, files, meshes),
    runtime = new NatsumeRuntime(app.renderer as WebGLRenderer);
  const options = { displayMatrix: [16, 0, 0, 0, 0, -16, 0, 0, 0, 0, 0.001, 0, 32, 32, 0, 1] };
  const a = await runtime.instantiate(pack, options),
    b = await runtime.instantiate(pack, options);
  a.play();
  b.play();
  for (let i = 0; i < 12; i++) a.update(1 / 60);
  const aTint = a.simulation.bindings.materials.get(`${renderer.id}:0`)!.tint!.r;
  const bTint = b.simulation.bindings.materials.get(`${renderer.id}:0`)!.tint!.r;
  for (let i = 0; i < 24; i++) a.update(1 / 60);
  const hidden = a.container.children.every((c) => !c.visible);
  a.restart();
  const restored = a.container.children.every((c) => c.visible);
  const sourceUnchanged = source.document.materials[0]!.tint!.r === 1;
  let invalidEnvironmentRejected = false;
  try {
    a.setRenderEnvironment({ globalMipBias: NaN });
  } catch {
    invalidEnvironmentRejected = true;
  }
  a.destroy();
  b.destroy();
  const released =
    (runtime as unknown as { instances: Set<unknown>; textures: Map<unknown, unknown> }).instances
      .size === 0 &&
    (runtime as unknown as { textures: Map<unknown, unknown> }).textures.size === 0;
  runtime.destroy();
  pack.dispose();
  source.dispose();
  app.destroy();
  return {
    isolated: aTint !== bTint,
    hidden,
    restored,
    sourceUnchanged,
    invalidEnvironmentRejected,
    released,
  };
}

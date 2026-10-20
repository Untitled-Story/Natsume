import { TrackData } from '../../src/format/generated/noa/ir/track-data.js';
import { AnimationProperty } from '../../src/format/generated/noa/ir/animation-property.js';
import { ComponentData } from '../../src/format/generated/noa/ir/component-data.js';
import { AnimationBindings } from '../../src/runtime/animation-bindings.js';
import { EffectPack as InstancePack } from '../../src/pack.js';
import { ComponentT } from '../../src/format/generated/noa/ir/component.js';
import { AnimationT } from '../../src/format/generated/noa/ir/animation.js';
import { TrackT } from '../../src/format/generated/noa/ir/track.js';
import { BindingT } from '../../src/format/generated/noa/ir/binding.js';
import { ColorTrackT } from '../../src/format/generated/noa/ir/color-track.js';
import { ScalarCurveT } from '../../src/format/generated/noa/ir/scalar-curve.js';
import { FloatKeyT } from '../../src/format/generated/noa/ir/float-key.js';
import {
  Application,
  Container,
  Graphics,
  Texture,
  RenderTexture,
  BufferImageSource,
} from 'pixi.js';
import { ParticleMesh, ensureParticlePipe } from '../../src/rendering/particle-mesh.js';
import type { ParticleEnvironment } from '../../src/rendering/particle-environment.js';
import { Emitter } from '../../src/runtime/emitter.js';
import { Scene } from '../../src/runtime/scene.js';
import { minimalDocument } from '../helpers.js';
import { particleSource, manualParticle } from '../particle-fixtures.js';
import type { EffectPack } from '../../src/pack.js';
import { MaterialT } from '../../src/format/generated/noa/ir/material.js';
import { MaterialModel as M } from '../../src/format/generated/noa/ir/material-model.js';
import { ParticleRendererT } from '../../src/format/generated/noa/ir/particle-renderer.js';
import { VertexStreamT } from '../../src/format/generated/noa/ir/vertex-stream.js';
import { ColorT } from '../../src/format/generated/noa/ir/color.js';
import { TextureBindingT } from '../../src/format/generated/noa/ir/texture-binding.js';
import { RenderStateT } from '../../src/format/generated/noa/ir/render-state.js';
import { FloatPropertyT } from '../../src/format/generated/noa/ir/float-property.js';
import type { WebGLRenderer } from 'pixi.js';

export interface NativeLegacyCase {
  label: string;
  model: string;
  fog: string;
  backgroundDepth: number;
  particleDepth: number;
  density: number;
  start: number;
  end: number;
  pixels: number[];
}

export async function measureLegacyMaterials(nativeCases: readonly NativeLegacyCase[] = []) {
  const app = new Application();
  await app.init({
    preference: 'webgl',
    preferWebGLVersion: 2,
    autoStart: false,
    width: 64,
    height: 32,
    antialias: false,
  });
  ensureParticlePipe(app.renderer as WebGLRenderer);
  const doc = minimalDocument();
  const pack = {
    nodes: doc.nodes,
    components: [],
    getNode: (id: number) => doc.nodes.find((n) => n.id === id),
  } as unknown as EffectPack;
  const e = new Emitter(3, new Scene(pack, [1]).nodes.get(1)!, particleSource(), true, 1, []);
  manualParticle(e);
  e.positions.set([10, 10, 0.5]);
  e.startSizes.set([16, 16, 1]);
  e.rotations.fill(0);
  e.startColors.set([1, 0, 0, 0.5]);
  const definition = new ParticleRendererT(3, [1]);
  definition.applyActiveColorSpace = false;
  definition.vertexStreams = [
    new VertexStreamT(0, 3),
    new VertexStreamT(2, 4),
    new VertexStreamT(3, 2),
  ];
  const material = new MaterialT();
  material.tint = new ColorT(0.5, 0.5, 0.5, 0.5);
  const binding = new TextureBindingT();
  binding.colorSpace = 1;
  material.textures = [binding];
  material.floats = [new FloatPropertyT('_InvFade', 1)];
  const state = new RenderStateT();
  state.srcRgb = state.srcAlpha = 4;
  state.dstRgb = state.dstAlpha = 5;
  state.colorWriteMask = 7;
  state.depthWrite = false;
  state.depthTest = 3;
  state.cull = 0;
  material.renderState = state;
  const target = RenderTexture.create({ width: 64, height: 32, antialias: false });
  const scene = new Container();
  scene.addChild(new Graphics().rect(0, 0, 64, 32).fill(0x0000ff));
  const holder = new Container();
  scene.addChild(holder);
  const sibling = new Graphics().rect(32, 0, 16, 20).fill({ color: 0x00ff00, alpha: 0.5 });
  scene.addChild(sibling);
  const results: Record<string, number[]> = {};
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const draw = (label: string, model: M, env: ParticleEnvironment, alpha = 0.5) => {
    material.model = model;
    state.dstRgb = state.dstAlpha = model === M.LegacyParticleAdditive ? 1 : 5;
    e.startColors[3] = alpha;
    const mesh = new ParticleMesh(e, definition, material, Texture.WHITE, pack, env);
    holder.addChild(mesh);
    mesh.sync(matrix, 'gamma');
    app.renderer.render({ container: scene, target, clear: true });
    const pixels = app.renderer.extract.pixels({ target }).pixels;
    results[label] = Array.from(pixels.slice((10 * 64 + 10) * 4, (10 * 64 + 10) * 4 + 4));
    results[label + '-sibling'] = Array.from(
      pixels.slice((10 * 64 + 40) * 4, (10 * 64 + 40) * 4 + 4),
    );
    if (label === 'alpha') {
      const d = minimalDocument(),
        r = new ParticleRendererT(3, [1]);
      d.components = [new ComponentT(4, 1, true, ComponentData.ParticleRenderer, r)];
      d.materials = [Object.assign(structuredClone(material), { id: 1 })];
      const curve = new ScalarCurveT();
      curve.keys = [
        Object.assign(new FloatKeyT(), { value: 0.5, interpolation: 1 }),
        Object.assign(new FloatKeyT(), { time: 1, value: 0 }),
      ];
      const track = new TrackT(
        new BindingT(4, AnimationProperty.RendererMaterialTint, 0, '_TintColor'),
        TrackData.ColorTrack,
        new ColorTrackT(curve),
      );
      d.animations = [new AnimationT(5, 'tint', 1, false, [track])];
      const source = new InstancePack(
        d,
        {
          format: 'noa-package',
          version: 1,
          noir_version: [1, 0],
          document: 'scene.noir',
          files: [],
        },
        new Map(),
        new Map(),
      );
      const sceneState = new Scene(source, [1]),
        bindings = new AnimationBindings(source, sceneState);
      const animated = new ParticleMesh(
        e,
        definition,
        bindings.materials.get('4:0')!,
        Texture.WHITE,
        pack,
        { fog: { mode: 'none' } },
      );
      mesh.visible = false;
      holder.addChild(animated);
      animated.animationEnabled = () => bindings.enabled.get(4) ?? false;
      const sample = bindings.compile(track)!;
      for (const [key, time] of [
        ['animated-initial', 0],
        ['animated-end', 1],
      ] as const) {
        sample.sample(time);
        animated.sync(matrix, 'gamma');
        app.renderer.render({ container: scene, target, clear: true });
        const pixels = app.renderer.extract.pixels({ target }).pixels;
        results[key] = Array.from(pixels.slice((10 * 64 + 10) * 4, (10 * 64 + 10) * 4 + 4));
      }
      bindings.enabled.set(4, false);
      animated.sync(matrix, 'gamma');
      app.renderer.render({ container: scene, target, clear: true });
      const pixels = app.renderer.extract.pixels({ target }).pixels;
      results['animated-disabled'] = Array.from(
        pixels.slice((10 * 64 + 10) * 4, (10 * 64 + 10) * 4 + 4),
      );
      animated.destroy();
    }
    mesh.destroy();
  };
  try {
    draw('alpha', M.LegacyParticleAlphaBlend, { fog: { mode: 'none' } });
    draw('additive', M.LegacyParticleAdditive, { fog: { mode: 'none' } });
    draw('soft-quarter', M.LegacyParticleAlphaBlend, {
      fog: { mode: 'none' },
      depth: 0.75,
      softParticles: { depthTexture: Texture.WHITE },
    });
    draw('soft-occluded', M.LegacyParticleAlphaBlend, {
      fog: { mode: 'none' },
      depth: 2,
      softParticles: { depthTexture: Texture.WHITE },
    });
    draw('soft-full', M.LegacyParticleAlphaBlend, {
      fog: { mode: 'none' },
      depth: 0,
      softParticles: { depthTexture: Texture.WHITE },
    });
    holder.zIndex = 0.5;
    draw('fog-fallback', M.LegacyParticleAlphaBlend, {
      fog: { mode: 'linear', color: [0, 1, 0], start: 0, end: 1 },
    });
    draw('fog-additive', M.LegacyParticleAdditive, {
      fog: { mode: 'linear', color: [0, 1, 0], start: 0, end: 1 },
    });
    draw('fog-exp', M.LegacyParticleAlphaBlend, {
      fog: { mode: 'exp', color: [0, 1, 0], density: Math.log(2) },
      depth: 1,
    });
    draw('fog-exp2', M.LegacyParticleAlphaBlend, {
      fog: { mode: 'exp2', color: [0, 1, 0], density: Math.sqrt(Math.log(2)) },
      depth: 1,
    });
    draw('soft-affine-depth', M.LegacyParticleAlphaBlend, {
      fog: { mode: 'none' },
      depth: [0, 0, 1, 0.25],
      softParticles: { depthTexture: Texture.WHITE },
    });
    for (const sample of nativeCases) {
      const depth = new Texture({
        source: new BufferImageSource({
          resource: new Float32Array([sample.backgroundDepth, 0, 0, 1]),
          width: 1,
          height: 1,
          format: 'rgba32float',
          alphaMode: 'no-premultiply-alpha',
          scaleMode: 'nearest',
        }),
      });
      try {
        const fog: ParticleEnvironment['fog'] =
          sample.fog === 'linear'
            ? { mode: 'linear', color: [0, 1, 0], start: sample.start, end: sample.end }
            : sample.fog === 'exp' || sample.fog === 'exp2'
              ? { mode: sample.fog, color: [0, 1, 0], density: sample.density }
              : { mode: 'none' };
        draw(
          sample.label,
          sample.model === 'alpha' ? M.LegacyParticleAlphaBlend : M.LegacyParticleAdditive,
          {
            fog,
            depth: sample.particleDepth,
            ...(sample.fog === 'none' ? { softParticles: { depthTexture: depth } } : {}),
          },
        );
        if (depth.destroyed) throw new Error('Borrowed scene depth was destroyed');
      } finally {
        depth.destroy(true);
      }
    }
    const borrowedAlive = !Texture.WHITE.destroyed;
    return { results, borrowedAlive, glError: (app.renderer as WebGLRenderer).gl.getError() };
  } finally {
    scene.destroy({ children: true });
    target.destroy(true);
    app.destroy();
  }
}

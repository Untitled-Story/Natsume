import { Application, Container, Graphics, Texture, RenderTexture } from 'pixi.js';
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

export async function measureLegacyMaterials() {
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
  const e = new Emitter(
    3,
    new Scene(pack, [1]).nodes.get(1)!,
    particleSource(),
    true,
    1,
    false,
    [],
  );
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
    const borrowedAlive = !Texture.WHITE.destroyed;
    return { results, borrowedAlive, glError: (app.renderer as WebGLRenderer).gl.getError() };
  } finally {
    scene.destroy({ children: true });
    target.destroy(true);
    app.destroy();
  }
}

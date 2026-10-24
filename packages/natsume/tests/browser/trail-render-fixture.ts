import { Application, Container, Texture, RenderTexture, type WebGLRenderer } from 'pixi.js';
import { mat4 } from 'gl-matrix';
import { ensureMaterialPipe } from '../../src/rendering/material-pipe.js';
import { TrailMesh } from '../../src/rendering/trail-mesh.js';
import { ParticleTrails } from '../../src/runtime/particle-trails.js';
import { TrailPointPool } from '../../src/runtime/trail-point-pool.js';
import { Emitter } from '../../src/runtime/emitter.js';
import { Scene } from '../../src/runtime/scene.js';
import { EffectPack } from '../../src/pack.js';
import { minimalDocument } from '../helpers.js';
import { particleSource, constant } from '../particle-fixtures.js';
import { MaterialT } from '../../src/format/generated/noa/ir/material.js';
import { MaterialModel } from '../../src/format/generated/noa/ir/material-model.js';
import { RenderStateT } from '../../src/format/generated/noa/ir/render-state.js';
import { TrailsModuleT } from '../../src/format/generated/noa/ir/trails-module.js';
import { ParticleRendererT } from '../../src/format/generated/noa/ir/particle-renderer.js';
import { ParticleModuleT } from '../../src/format/generated/noa/ir/particle-module.js';
import { ParticleModuleData as M } from '../../src/format/generated/noa/ir/particle-module-data.js';
import { EmissionModuleT } from '../../src/format/generated/noa/ir/emission-module.js';
import { BurstT } from '../../src/format/generated/noa/ir/burst.js';
import { ColorParameterT } from '../../src/format/generated/noa/ir/color-parameter.js';
import { ColorT } from '../../src/format/generated/noa/ir/color.js';

export async function measureTrailRendering() {
  const app = new Application();
  await app.init({
    preference: 'webgl',
    preferWebGLVersion: 2,
    width: 64,
    height: 64,
    resolution: 1,
    antialias: false,
    autoStart: false,
  });
  const renderer = app.renderer as WebGLRenderer;
  ensureMaterialPipe(renderer);
  const pack = new EffectPack(minimalDocument(), { files: [] } as never, new Map(), new Map());
  const scene = new Scene(pack, [1]);
  const source = particleSource();
  source.main!.lifetime = constant(0.5);
  source.modules.push(
    new ParticleModuleT(
      M.EmissionModule,
      new EmissionModuleT(constant(0), constant(0), [new BurstT(0, constant(1), 1, 0, 1)]),
    ),
  );
  const emitter = new Emitter(3, scene.nodes.get(1)!, source, true, 123, []);
  const definition = new TrailsModuleT();
  definition.lifetime = constant(1);
  definition.minVertexDistance = 0.05;
  definition.widthOverTrail = constant(0.2);
  definition.colorOverLifetime = new ColorParameterT(0, null, new ColorT(0, 1, 0, 1));
  const pool = new TrailPointPool(),
    trails = new ParticleTrails(emitter, definition, pool);
  const material = new MaterialT();
  material.id = 5;
  material.model = MaterialModel.ParticleUnlit;
  material.renderState = new RenderStateT();
  const mesh = new TrailMesh(trails, new ParticleRendererT(), material, Texture.WHITE, pack);
  const root = new Container();
  root.addChild(mesh);
  const target = RenderTexture.create({ width: 64, height: 64, resolution: 1 });
  const display = mat4.fromScaling(mat4.create(), [48, 48, 1]);
  display[12] = 8;
  display[13] = 32;
  const draw = () => {
    mesh.sync(display, 'gamma');
    renderer.render({ container: root, target, clear: true });
    const pixels = renderer.extract.pixels({ target }).pixels;
    let green = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 1]! > 200 && pixels[i]! < 10) green++;
    return green;
  };
  emitter.sync();
  emitter.velocities.set([1, 0, 0]);
  const empty = draw();
  for (let i = 0; i < 6; i++) emitter.step(0.05);
  const alive = draw(),
    buffer = mesh.trailGeometry.vertices;
  const repeat = draw(),
    reused = mesh.trailGeometry.vertices === buffer;
  emitter.step(0.25);
  const residual = draw();
  for (let i = 0; i < 10; i++) emitter.step(0.05);
  const expired = draw();
  emitter.reset();
  emitter.sync();
  emitter.velocities.set([1, 0, 0]);
  emitter.step(0.1);
  const replay = draw();
  emitter.clear();
  const cleared = draw();
  const glError = renderer.gl.getError();
  mesh.destroy();
  root.destroy();
  target.destroy(true);
  pack.dispose();
  app.destroy(true);
  return {
    empty,
    alive,
    repeat,
    reused,
    residual,
    expired,
    replay,
    cleared,
    points: pool.count,
    glError,
  };
}

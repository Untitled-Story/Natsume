import {
  Application,
  BufferImageSource,
  Container,
  RenderTexture,
  Texture,
  type WebGLRenderer,
} from 'pixi.js';
import * as I from '../../src/format/generated/noa/ir.js';
import { MeshT, SubmeshT, TexCoordT } from '../../src/format/generated/noa/mesh.js';
import { EffectPack } from '../../src/pack.js';
import { ParticleMesh } from '../../src/rendering/particle-mesh.js';
import { SceneMesh } from '../../src/rendering/scene-mesh.js';
import { ensureMaterialPipe } from '../../src/rendering/material-pipe.js';
import { Scene } from '../../src/runtime/scene.js';
import { Emitter } from '../../src/runtime/emitter.js';
import { minimalDocument } from '../helpers.js';
import { manualParticle, particleSource } from '../particle-fixtures.js';

const recipes = [
  [
    'f4c3959fbb391fd5e4722820c271a04f3d3ced65bd2029429033936e7ae264f9',
    I.MaterialModel.ParticleAddAlpha,
  ],
  [
    'f07136c5ab507bfcb309c1920a6afce6f1d5653f80c1c2f97e8ec0066ba58ac2',
    I.MaterialModel.TextureVertexColor,
  ],
  [
    '09bc049fd22991be3a180c1550dd85a5f3cbdc1a7b764383cca275b3afbcf236',
    I.MaterialModel.TextureVertexColor,
  ],
] as const;
const object = () =>
  new I.SerializedValueT(I.SerializedValueData.ObjectValue, new I.ObjectValueT());

/** Compares preserved recipes against their established mesh and particle execution paths. */
export async function comparePreservedRecipes() {
  const app = new Application();
  await app.init({
    preference: 'webgl',
    preferWebGLVersion: 2,
    autoStart: false,
    width: 8,
    height: 8,
    antialias: false,
  });
  const renderer = app.renderer as WebGLRenderer;
  ensureMaterialPipe(renderer);
  const texture = new Texture({
    source: new BufferImageSource({
      resource: new Uint8Array([128, 64, 32, 128]),
      width: 1,
      height: 1,
      alphaMode: 'no-premultiply-alpha',
      minFilter: 'nearest',
      magFilter: 'nearest',
    }),
  });
  const target = RenderTexture.create({ width: 8, height: 8, antialias: false });
  const container = new Container();
  const results: {
    hash: string;
    kind: string;
    preserved: boolean;
    pixels: number[];
    sourceSurface: number;
    model: number;
  }[] = [];
  for (const [hash, model] of recipes)
    for (const kind of ['mesh', 'particle'])
      for (const preserved of [false, true]) {
        const doc = minimalDocument();
        const material = new I.MaterialT();
        material.id = 4;
        material.model = preserved ? I.MaterialModel.UnityShader : model;
        material.shaderDataAssetId = 3;
        material.sourceData = preserved ? object() : null;
        material.tint = new I.ColorT(1, 1, 1, 1);
        material.renderState = new I.RenderStateT();
        material.renderState.srcRgb = material.renderState.srcAlpha = I.BlendFactor.One;
        material.renderState.dstRgb = material.renderState.dstAlpha = I.BlendFactor.Zero;
        doc.materials = [material];
        const descriptor = new TextEncoder().encode(
          JSON.stringify({ program_sha256: hash, global_mip_bias: hash.startsWith('f071') }),
        );
        const pack = new EffectPack(
          doc,
          {
            format: 'noa-package',
            version: 1,
            noir_version: [1, 0],
            document: 'scene.noir',
            files: [
              {
                path: 'assets/3.shader.json',
                kind: 'shader_data',
                asset_id: 3,
                byte_length: descriptor.length,
                sha256: '0'.repeat(64),
              },
            ],
          },
          new Map([['assets/3.shader.json', descriptor]]),
          new Map(),
        );
        const scene = new Scene(pack, [1]);
        let mesh: SceneMesh | ParticleMesh;
        if (kind === 'mesh') {
          const geometry = new MeshT();
          geometry.positions = [
            new I.Vec3T(-1, -1, 0),
            new I.Vec3T(1, -1, 0),
            new I.Vec3T(1, 1, 0),
            new I.Vec3T(-1, 1, 0),
          ];
          geometry.colors = geometry.positions.map(() => new I.Vec4T(0.5, 0.75, 1, 0.5));
          geometry.texcoords = [
            new TexCoordT(0, 2, [
              new I.Vec4T(),
              new I.Vec4T(1),
              new I.Vec4T(1, 1),
              new I.Vec4T(0, 1),
            ]),
          ];
          geometry.indices = [0, 1, 2, 0, 2, 3];
          geometry.submeshes = [new SubmeshT(0, 6)];
          mesh = new SceneMesh(
            scene.ordered[0]!,
            new I.MeshRendererT(),
            material,
            geometry,
            0,
            texture,
            pack,
          );
          mesh.renderEnvironment = { globalMipBias: 0 };
          mesh.sync([4, 0, 0, 0, 0, -4, 0, 0, 0, 0, 0.001, 0, 4, 4, 0, 1], 'gamma');
        } else {
          const emitter = new Emitter(5, scene.ordered[0]!, particleSource(), true, 1, []);
          manualParticle(emitter);
          emitter.positions.set([4, 4, 0]);
          emitter.startSizes.set([8, 8, 1]);
          emitter.rotations.fill(0);
          emitter.startColors.set([0.5, 0.75, 1, 0.5]);
          const definition = new I.ParticleRendererT();
          definition.applyActiveColorSpace = false;
          definition.vertexStreams = [
            new I.VertexStreamT(I.VertexSemantic.Position, 3),
            new I.VertexStreamT(I.VertexSemantic.Color, 4),
            new I.VertexStreamT(I.VertexSemantic.UV0, 2),
          ];
          mesh = new ParticleMesh(emitter, definition, material, texture, pack, undefined, {
            globalMipBias: 0,
          });
          mesh.renderEnvironment = { globalMipBias: 0 };
          mesh.sync([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 'gamma');
        }
        container.addChild(mesh);
        renderer.render({ container, target, clear: true });
        const pixels = renderer.extract.pixels({ target }).pixels;
        const uniforms = mesh.shader!.resources.colorUniforms.uniforms;
        results.push({
          hash,
          kind,
          preserved,
          pixels: Array.from(pixels.slice((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4)),
          sourceSurface: uniforms.uSourceSurface as number,
          model: uniforms.uModel as number,
        });
        container.removeChild(mesh);
        mesh.destroy();
        pack.dispose();
      }
  target.destroy(true);
  texture.destroy(true);
  app.destroy(true);
  return results;
}

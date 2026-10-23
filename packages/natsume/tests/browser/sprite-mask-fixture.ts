import { VertexStreamT } from '../../src/format/generated/noa/ir/vertex-stream.js';
import { ParticleRendererT } from '../../src/format/generated/noa/ir/particle-renderer.js';
import { particleSource } from '../particle-fixtures.js';
import { Application, Container, Graphics, RenderTexture, type WebGLRenderer } from 'pixi.js';
import { NatsumeRuntime } from '../../src/runtime/runtime.js';
import { EffectPack } from '../../src/pack.js';
import { minimalDocument } from '../helpers.js';
import { AssetT } from '../../src/format/generated/noa/ir/asset.js';
import { ComponentT } from '../../src/format/generated/noa/ir/component.js';
import { ComponentData as C } from '../../src/format/generated/noa/ir/component-data.js';
import { NodeT } from '../../src/format/generated/noa/ir/node.js';
import { SpriteMaskT } from '../../src/format/generated/noa/ir/sprite-mask.js';
import { SpriteRendererT } from '../../src/format/generated/noa/ir/sprite-renderer.js';
import { SpriteAssetT } from '../../src/format/generated/noa/ir/sprite-asset.js';
import { ColorT } from '../../src/format/generated/noa/ir/color.js';
import { MaterialT } from '../../src/format/generated/noa/ir/material.js';
import { RenderStateT } from '../../src/format/generated/noa/ir/render-state.js';
import { SamplerT } from '../../src/format/generated/noa/ir/sampler.js';
import { MeshT } from '../../src/format/generated/noa/mesh/mesh.js';
import { Vec3T } from '../../src/format/generated/noa/mesh/vec3.js';
import { Vec4T } from '../../src/format/generated/noa/mesh/vec4.js';
import { TexCoordT } from '../../src/format/generated/noa/mesh/tex-coord.js';
import { SubmeshT } from '../../src/format/generated/noa/mesh/submesh.js';
export interface SpriteMaskSample {
  label: string;
  particle: boolean;
  interaction: number;
  order: number;
  custom: boolean;
  second: boolean;
  cutoff: number;
  z?: number;
  sortPoint?: number;
  pixels: number[];
}
export async function measureSpriteMasks(native: { cases: SpriteMaskSample[] }) {
  const app = new Application();
  await app.init({
    preference: 'webgl',
    preferWebGLVersion: 2,
    width: 32,
    height: 32,
    autoStart: false,
    antialias: false,
    backgroundAlpha: 0,
  });
  const renderer = app.renderer as WebGLRenderer,
    runtime = new NatsumeRuntime(renderer),
    target = RenderTexture.create({ width: 32, height: 32, antialias: false });
  const png = async (mask: boolean) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 8;
    const data = new Uint8ClampedArray(256);
    for (let i = 0; i < 64; i++)
      data.set([255, 255, 255, mask ? Math.round(((i % 8) * 255) / 7) : 255], i * 4);
    canvas.getContext('2d')!.putImageData(new ImageData(data, 8, 8), 0, 0);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png'),
    );
    return new Uint8Array(await blob.arrayBuffer());
  };
  const maskPng = await png(true),
    white = await png(false),
    results: Record<string, number[]> = {},
    hostResults: Record<string, number[]> = {},
    offsetResults: Record<string, number[]> = {};
  const geometry = (size: number) => {
    const m = new MeshT();
    m.positions = [
      new Vec3T(-size / 2, -size / 2, 0),
      new Vec3T(size / 2, -size / 2, 0),
      new Vec3T(size / 2, size / 2, 0),
      new Vec3T(-size / 2, size / 2, 0),
    ];
    m.indices = [0, 1, 2, 0, 2, 3];
    m.texcoords = [
      new TexCoordT(0, 2, [
        new Vec4T(0, 0, 0, 0),
        new Vec4T(1, 0, 0, 0),
        new Vec4T(1, 1, 0, 0),
        new Vec4T(0, 1, 0, 0),
      ]),
    ];
    m.submeshes = [new SubmeshT(0, 6)];
    return m;
  };
  for (const c of native.cases) {
    const doc = minimalDocument();
    doc.nodes[0]!.transform!.scale!.x = 14;
    doc.nodes[0]!.transform!.scale!.y = 12;
    const m = new MaterialT();
    m.id = 4000;
    m.model = 6;
    m.renderState = new RenderStateT();
    m.renderState.cull = 0;
    m.renderState.srcRgb = m.renderState.srcAlpha = 1;
    doc.materials = [m];
    const source = (meshAssetId: number, imageAssetId: number, size: number) =>
      Object.assign(new SpriteAssetT(), {
        meshAssetId,
        imageAssetId,
        rect: { x: 0, y: 0, z: 8, w: 8 },
        pixelsPerUnit: 8 / size,
        pivot: { x: 0.5, y: 0.5 },
        border: { x: 0, y: 0, z: 0, w: 0 },
        colorSpace: 2,
        sampler: new SamplerT(0, 0),
      });
    doc.assets = [
      new AssetT(1000, 4, source(2000, 3000, 8)),
      new AssetT(1001, 4, source(2001, 3001, 1)),
    ];
    const rendererDef = Object.assign(new SpriteRendererT(), {
      spriteAssetId: 1001,
      materials: [4000],
      color: new ColorT(0.8, 0.4, 0.2, 0.7),
      maskInteraction: c.interaction,
      sortingOrder: c.order,
    });
    doc.components = [new ComponentT(10, 1, true, C.SpriteRenderer, rendererDef)];
    if (c.particle) {
      doc.nodes[0]!.transform!.scale!.x = doc.nodes[0]!.transform!.scale!.y = 1;
      const pr = Object.assign(new ParticleRendererT(), {
        systemComponentId: 9,
        vertexStreams: [new VertexStreamT(0, 3), new VertexStreamT(2, 4), new VertexStreamT(3, 2)],
        materials: [4000],
        maskInteraction: c.interaction,
        sortingOrder: c.order,
      });
      doc.components = [
        new ComponentT(9, 1, true, C.ParticleSystem, particleSource()),
        new ComponentT(10, 1, true, C.ParticleRenderer, pr),
      ];
    }
    for (let i = 0; i < (c.second ? 2 : 1); i++) {
      const tr = structuredClone(minimalDocument().nodes[0]!.transform)!;
      tr.position!.x = i === 0 ? -1 : 3;
      tr.position!.y = i === 0 ? 0 : 2;
      tr.position!.z = c.z ?? 0;
      tr.scale!.x = tr.scale!.y = i === 0 ? 1 : 0.5;
      doc.nodes.push(new NodeT(2 + i, 'mask', 0, true, tr));
      doc.entries[0]!.roots.push(2 + i);
      doc.components.push(
        new ComponentT(
          11 + i,
          2 + i,
          true,
          C.SpriteMask,
          Object.assign(new SpriteMaskT(), {
            spriteAssetId: 1000,
            alphaCutoff: c.cutoff,
            sortPoint: c.sortPoint ?? 0,
            customRange: c.custom,
            backOrder: -1,
            frontOrder: 1,
          }),
        ),
      );
    }
    const files = [
      ['mask.png', 3000, maskPng],
      ['white.png', 3001, white],
    ] as const;
    const pack = new EffectPack(
      doc,
      {
        format: 'noa-package',
        version: 1,
        noir_version: [2, 0],
        document: 'scene.noir',
        files: files.map(([path, asset_id, bytes]) => ({
          path,
          kind: 'image',
          asset_id,
          byte_length: bytes.length,
          sha256: '0'.repeat(64),
        })),
      },
      new Map(files.map(([path, , bytes]) => [path, bytes])),
      new Map([
        [2000, geometry(8)],
        [2001, geometry(1)],
      ]),
    );
    const effect = await runtime.instantiate(pack, {
      displayMatrix: [2, 0, 0, 0, 0, -2, 0, 0, 0, 0, 0.001, 0, 16, 16, 0, 1],
    });
    effect.pause();
    if (c.particle) {
      const e = effect.simulation.emitters.get(9)!;
      e.count = 1;
      e.positions.fill(0);
      e.startSizes.set([14, 12, 1]);
      e.lifetimes.fill(100);
      e.startColors.set([0.8, 0.4, 0.2, 0.7]);
    }
    effect.update(0);
    renderer.render({ container: effect.container, target, clear: true, clearColor: [0, 0, 0, 0] });
    results[c.label] = Array.from(renderer.extract.pixels({ target }).pixels);
    if (
      !c.particle &&
      c.interaction === 1 &&
      c.order === 0 &&
      !c.custom &&
      !c.second &&
      c.cutoff === 0.5
    ) {
      const host = new Container(),
        mask = new Graphics().rect(0, 0, 16, 32).fill(0xffffff);
      host.addChild(effect.container, mask);
      effect.container.mask = mask;
      renderer.render({ container: host, target, clear: true, clearColor: [0, 0, 0, 0] });
      hostResults[c.label] = Array.from(renderer.extract.pixels({ target }).pixels);
      effect.container.mask = null;
      host.removeChild(effect.container);
      host.destroy({ children: true });
      effect.getNode(1)!.setRenderOffset({ x: 4, y: 0 });
      effect.getNode(2)!.setRenderOffset({ x: 4, y: 0 });
      effect.update(0);
      renderer.render({
        container: effect.container,
        target,
        clear: true,
        clearColor: [0, 0, 0, 0],
      });
      offsetResults[c.label] = Array.from(renderer.extract.pixels({ target }).pixels);
    }
    effect.destroy();
    pack.dispose();
  }
  const error = renderer.gl.getError();
  runtime.destroy();
  target.destroy(true);
  app.destroy();
  return { results, hostResults, offsetResults, error };
}

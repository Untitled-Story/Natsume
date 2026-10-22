import { expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { loadPack } from '../src/loader/load.js';
import { validateDocument } from '../src/format/semantics.js';
import { copyEnvironment } from '../src/rendering/particle-environment.js';
import { minimalDocument, encode } from './helpers.js';
import { particleSource } from './particle-fixtures.js';
import { FeatureRequirementT } from '../src/format/generated/noa/ir/feature-requirement.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { ColorContextT } from '../src/format/generated/noa/ir/color-context.js';
import { ParticleModuleT } from '../src/format/generated/noa/ir/particle-module.js';
import { ShapeModuleT } from '../src/format/generated/noa/ir/shape-module.js';
import { BoxShapeT } from '../src/format/generated/noa/ir/box-shape.js';
import { Vec3T } from '../src/format/generated/noa/ir/vec3.js';
import { MaterialT } from '../src/format/generated/noa/ir/material.js';
import { AssetT } from '../src/format/generated/noa/ir/asset.js';
import { RenderStateT } from '../src/format/generated/noa/ir/render-state.js';

it('requires actual shape capabilities and valid region thickness', () => {
  const doc = minimalDocument();
  doc.colorContext = new ColorContextT(0);
  const p = particleSource();
  const box = new BoxShapeT(new Vec3T(0, 0, 0));
  p.modules = [new ParticleModuleT(2, new ShapeModuleT(2, box, doc.nodes[0]!.transform))];
  doc.components = [new ComponentT(3, 1, true, 3, p)];
  doc.features = [new FeatureRequirementT('color.authored', 1, true)];
  expect(() => validateDocument(doc)).toThrow('particle.shape.box');
  doc.features.push(new FeatureRequirementT('particle.shape.box', 1, true));
  expect(() => validateDocument(doc)).not.toThrow();
  box.thickness!.z = 1.01;
  expect(() => validateDocument(doc)).toThrow('thickness');
});

function recipe(additive = true): Record<string, unknown> {
  return {
    format: 'noa-shader-data',
    version: 1,
    revision: 1,
    model: additive ? 'unity-legacy-particle-additive' : 'unity-legacy-particle-alpha-blend',
    source_builtin: {
      guid: '0000000000000000f000000000000000',
      file_id: additive ? '10720' : '10721',
    },
    source_revision: 'unity-2022.3.21f1',
    color_formula: 'c = 2 * vertexColor * TintColor * texture(MainTex, uv); c.a = saturate(c.a)',
    rgb_premultiply: false,
    output_policy: 'primary-color',
    outputs: [0],
    environment: {
      fog: {
        host_slot: 'source-scene-fog',
        required: true,
        target: additive ? 'black' : 'scene-fog-color',
      },
      soft_particles: {
        host_slot: 'source-soft-particles',
        required: true,
        formula: 'vertexColor.a *= saturate(InvFade * (sceneEyeDepth - particleEyeDepth))',
        depth_required_when_enabled: true,
      },
    },
  };
}
async function makePack(r: Record<string, unknown>, model = 4) {
  const doc = minimalDocument();
  const m = new MaterialT();
  m.renderState = new RenderStateT();
  m.id = 3;
  m.model = model;
  m.shaderDataAssetId = 4;
  doc.materials = [m];
  doc.assets = [new AssetT(4, 3)];
  doc.features = [
    new FeatureRequirementT(
      model === 4
        ? 'material.unity-legacy-particle-additive'
        : 'material.unity-legacy-particle-alpha-blend',
      1,
      true,
    ),
    new FeatureRequirementT('host.legacy-particle-environment', 1, true),
  ];
  const scene = encode(doc),
    shader = strToU8(JSON.stringify(r));
  const hash = async (v: Uint8Array) =>
    Buffer.from(await crypto.subtle.digest('SHA-256', Uint8Array.from(v))).toString('hex');
  const manifest = {
    format: 'noa-package',
    version: 1,
    noir_version: [2, 0],
    document: 'scene.noir',
    files: [
      { path: 'scene.noir', kind: 'noir', byte_length: scene.length, sha256: await hash(scene) },
      {
        path: 'assets/4.shader.json',
        kind: 'shader_data',
        asset_id: 4,
        byte_length: shader.length,
        sha256: await hash(shader),
      },
    ],
  };
  return zipSync(
    {
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'scene.noir': scene,
      'assets/4.shader.json': shader,
    },
    { level: 0 },
  );
}
it('loads both exact legacy recipes and reports their host inputs', async () => {
  for (const additive of [true, false]) {
    const pack = await loadPack(await makePack(recipe(additive), additive ? 4 : 5));
    expect(pack.describe().requiredHostInputs).toEqual([
      'main-camera',
      'source-scene-fog',
      'source-soft-particles',
    ]);
    pack.dispose();
  }
});
it('rejects recipe/model mismatches, unknown fields and incorrect environment contracts', async () => {
  await expect(loadPack(await makePack(recipe(false)))).rejects.toThrow('models differ');
  const r = recipe();
  r.injected = true;
  await expect(loadPack(await makePack(r))).rejects.toThrow('recipe');
  const bad = recipe();
  bad.environment = {};
  await expect(loadPack(await makePack(bad))).rejects.toThrow('recipe');
});
it('validates and copies host environment values', () => {
  const fog = {
    mode: 'linear' as const,
    color: [0, 1, 0] as [number, number, number],
    start: 0,
    end: 10,
  };
  const copied = copyEnvironment({ fog, depth: 2 })!;
  fog.color[0] = 1;
  expect(copied.fog).toEqual({ mode: 'linear', color: [0, 1, 0], start: 0, end: 10 });
  expect(() => copyEnvironment({ fog: { ...fog, end: 0 } })).toThrow('end');
  expect(() => copyEnvironment({ fog: { mode: 'exp', color: [0, 0, 0], density: -1 } })).toThrow(
    'density',
  );
  expect(() => copyEnvironment({ fog: { mode: 'none' }, depth: NaN })).toThrow('depth');
});

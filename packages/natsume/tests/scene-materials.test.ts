import { expect, it } from 'vitest';
import { EffectPack } from '../src/pack.js';
import { Scene } from '../src/runtime/scene.js';
import { AnimationBindings } from '../src/runtime/animation-bindings.js';
import { checkCompatibility, type CompatibilityContext } from '../src/runtime/compatibility.js';
import { sceneMaterialPasses } from '../src/rendering/scene-mesh.js';
import { copyRenderEnvironment } from '../src/rendering/render-environment.js';
import { minimalDocument } from './helpers.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { MeshRendererT } from '../src/format/generated/noa/ir/mesh-renderer.js';
import { MeshFilterT } from '../src/format/generated/noa/ir/mesh-filter.js';
import { MeshT } from '../src/format/generated/noa/mesh/mesh.js';
import { Vec3T } from '../src/format/generated/noa/mesh/vec3.js';
import { SubmeshT } from '../src/format/generated/noa/mesh/submesh.js';
import { MaterialT } from '../src/format/generated/noa/ir/material.js';
import { RenderStateT } from '../src/format/generated/noa/ir/render-state.js';
import { ColorT } from '../src/format/generated/noa/ir/color.js';
import { AnimationT } from '../src/format/generated/noa/ir/animation.js';
import { TrackT } from '../src/format/generated/noa/ir/track.js';
import { BindingT } from '../src/format/generated/noa/ir/binding.js';
import { ColorTrackT } from '../src/format/generated/noa/ir/color-track.js';
import { ScalarCurveT } from '../src/format/generated/noa/ir/scalar-curve.js';
import { FloatKeyT } from '../src/format/generated/noa/ir/float-key.js';
import { AnimationProperty as P } from '../src/format/generated/noa/ir/animation-property.js';
import { RenderEnvironmentT } from '../src/format/generated/noa/ir/render-environment.js';

const context: CompatibilityContext = {
  maxTextureSize: 4096,
  availableTexturePixels: 1e8,
  cachedMaterialIds: new Set(),
  imageBitmapAvailable: false,
  hasScript: () => false,
  disposed: false,
};
function fixture() {
  const doc = minimalDocument(),
    mesh = new MeshT(),
    renderer = new MeshRendererT(3, [5]);
  mesh.positions = [new Vec3T(-1, -1, 0), new Vec3T(1, -1, 0), new Vec3T(0, 1, 0)];
  mesh.indices = [0, 1, 2];
  mesh.submeshes = [new SubmeshT(0, 3), new SubmeshT(0, 3)];
  const material = new MaterialT();
  material.id = 5;
  material.model = 6;
  material.tint = new ColorT(1, 1, 1, 1);
  material.renderState = new RenderStateT();
  material.renderState.srcRgb = 1;
  doc.materials = [material];
  doc.components = [
    new ComponentT(3, 1, true, 12, new MeshFilterT(42)),
    new ComponentT(4, 1, true, 7, renderer),
  ];
  const pack = () =>
    new EffectPack(
      doc,
      {
        format: 'noa-package',
        version: 1,
        noir_version: [2, 0],
        document: 'scene.noir',
        files: [],
      },
      new Map(),
      new Map([[42, mesh]]),
    );
  return { doc, mesh, renderer, material, pack };
}

it('maps native ordinary mesh slots without drawing unassigned submeshes', () => {
  const f = fixture();
  expect(sceneMaterialPasses(f.renderer, f.mesh)).toEqual([{ slot: 0, submesh: 0 }]);
  f.renderer.materials = [5, 0, 5, 5];
  expect(sceneMaterialPasses(f.renderer, f.mesh)).toEqual([
    { slot: 0, submesh: 0 },
    { slot: 2, submesh: 1 },
    { slot: 3, submesh: 1 },
  ]);
  expect(sceneMaterialPasses(f.renderer)).toEqual([]);
  f.renderer.environment = new RenderEnvironmentT(3);
  expect(sceneMaterialPasses(f.renderer, f.mesh)).toEqual([]);
});

it('preflights white fallback without image decoding and blocks dynamic Canvas depth', () => {
  const f = fixture();
  const pack = f.pack();
  expect(checkCompatibility(pack, {}, context).compatible).toBe(true);
  pack.dispose();
  const other = fixture();
  other.material.renderState!.depthTestSource = 1;
  const second = other.pack();
  expect(checkCompatibility(second, {}, context).issues).toContainEqual(
    expect.objectContaining({
      componentId: 4,
      field: 'materials.5.renderState.depthTestSource',
      severity: 'error',
    }),
  );
  second.dispose();
});

it('requires the host mip bias only for the recipe that reads it', () => {
  const f = fixture();
  f.material.model = 8;
  f.material.shaderDataAssetId = 8;
  for (const reads of [true, false]) {
    const data = new TextEncoder().encode(JSON.stringify({ global_mip_bias: reads }));
    const pack = new EffectPack(
      f.doc,
      {
        format: 'noa-package',
        version: 1,
        noir_version: [2, 0],
        document: 'scene.noir',
        files: [
          {
            path: 'assets/8.shader.json',
            asset_id: 8,
            kind: 'shader_data',
            byte_length: data.length,
            sha256: '0'.repeat(64),
          },
        ],
      },
      new Map([['assets/8.shader.json', data]]),
      new Map([[42, f.mesh]]),
    );
    expect(
      checkCompatibility(pack, {}, context).issues.some(
        (i) => i.field === 'renderEnvironment.globalMipBias',
      ),
    ).toBe(reads);
    expect(
      checkCompatibility(pack, { renderEnvironment: { globalMipBias: 0 } }, context).compatible,
    ).toBe(true);
    pack.dispose();
  }
  expect(() => copyRenderEnvironment({ globalMipBias: Infinity })).toThrow(/finite/);
});

it('isolates ordinary renderer material tracks per instance and restores their baseline', () => {
  const f = fixture();
  const binding = new BindingT(4, P.RendererMaterialTint);
  binding.propertyName = '_Color';
  const curve = new ScalarCurveT();
  curve.keys = [new FloatKeyT(0, 0.2), new FloatKeyT(1, 0.8)];
  const color = new ColorTrackT();
  color.r = curve;
  const track = new TrackT(binding, 4, color);
  const clip = new AnimationT();
  clip.tracks = [track];
  f.doc.animations = [clip];
  const pack = f.pack(),
    a = new AnimationBindings(pack, new Scene(pack, [1])),
    b = new AnimationBindings(pack, new Scene(pack, [1]));
  a.compile(track)!.sample(1);
  expect(a.materials.get('4:0')!.tint!.r).toBeCloseTo(0.8);
  expect(b.materials.get('4:0')!.tint!.r).toBe(1);
  expect(pack.document.materials[0]!.tint!.r).toBe(1);
  a.reset();
  expect(a.materials.get('4:0')!.tint!.r).toBe(1);
  pack.dispose();
});

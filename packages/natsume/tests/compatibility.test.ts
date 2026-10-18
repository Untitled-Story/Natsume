import { expect, it, vi } from 'vitest';
import { EffectPack } from '../src/pack.js';
import {
  checkCompatibility,
  NatsumeCompatibilityError,
  type CompatibilityContext,
} from '../src/runtime/compatibility.js';
import { minimalDocument } from './helpers.js';
import { constant, particleSource, linear } from './particle-fixtures.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { ParticleRendererT } from '../src/format/generated/noa/ir/particle-renderer.js';
import { MaterialT } from '../src/format/generated/noa/ir/material.js';
import { TextureBindingT } from '../src/format/generated/noa/ir/texture-binding.js';
import { RenderStateT } from '../src/format/generated/noa/ir/render-state.js';
import { VertexStreamT } from '../src/format/generated/noa/ir/vertex-stream.js';
import { ColorContextT } from '../src/format/generated/noa/ir/color-context.js';
import { NodeT } from '../src/format/generated/noa/ir/node.js';
import { ColorSpace } from '../src/format/generated/noa/ir/color-space.js';
import { WrapMode } from '../src/format/generated/noa/ir/wrap-mode.js';
import { Alignment } from '../src/format/generated/noa/ir/alignment.js';
import { RenderMode } from '../src/format/generated/noa/ir/render-mode.js';
import { BlendFactor } from '../src/format/generated/noa/ir/blend-factor.js';
import { RectLayoutT } from '../src/format/generated/noa/ir/rect-layout.js';
import { Vec2T } from '../src/format/generated/noa/ir/vec2.js';
import { Vec3T } from '../src/format/generated/noa/ir/vec3.js';

const context: CompatibilityContext = {
  maxTextureSize: 4096,
  availableTexturePixels: 64 * 1024 * 1024,
  cachedMaterialIds: new Set(),
  imageBitmapAvailable: true,
  hasScript: () => false,
  disposed: false,
};

function fixture() {
  const doc = minimalDocument();
  const source = particleSource();
  const renderer = new ParticleRendererT();
  renderer.systemComponentId = 3;
  renderer.materials = [5];
  renderer.vertexStreams = [
    new VertexStreamT(0, 3),
    new VertexStreamT(2, 4),
    new VertexStreamT(3, 2),
  ];
  const material = new MaterialT();
  material.id = 5;
  material.model = 2;
  material.renderState = new RenderStateT();
  material.renderState.srcRgb = BlendFactor.One;
  const texture = new TextureBindingT();
  texture.imageId = 6;
  texture.colorSpace = ColorSpace.SRGB;
  material.textures = [texture];
  doc.materials = [material];
  doc.colorContext = new ColorContextT(ColorSpace.SRGB);
  doc.components = [new ComponentT(3, 1, true, 3, source), new ComponentT(4, 1, true, 4, renderer)];
  const bytes = new Uint8Array(24);
  new DataView(bytes.buffer).setUint32(16, 32);
  new DataView(bytes.buffer).setUint32(20, 32);
  const pack = () =>
    new EffectPack(
      doc,
      {
        format: 'noa-package',
        version: 1,
        noir_version: [1, 0],
        document: 'scene.noir',
        files: [
          {
            path: 'assets/6.png',
            kind: 'image',
            asset_id: 6,
            byte_length: 24,
            sha256: '0'.repeat(64),
          },
        ],
      },
      new Map([['assets/6.png', bytes]]),
      new Map(),
    );
  return { doc, source, renderer, material, pack };
}

it('reports independent blocking fields and preserves every issue in the thrown error', () => {
  const f = fixture();
  f.source.main!.durationSeconds = 0.001;
  f.source.main!.gravityMultiplier = constant(1);
  f.renderer.alignment = Alignment.Facing;
  f.renderer.materials.push(5);
  const pack = f.pack();
  const report = checkCompatibility(pack, {}, context);
  expect(report.compatible).toBe(false);
  expect(
    report.issues.filter((i) => i.severity === 'error').map((i) => [i.componentId, i.field]),
  ).toEqual([
    [3, 'main.gravityMultiplier'],
    [3, 'main.durationSeconds'],
    [4, 'particleEnvironment.viewPosition'],
    [4, 'materials'],
  ]);
  const error = new NatsumeCompatibilityError(report);
  expect(error.code).toBe('HOST');
  expect(error.issues).toBe(report.issues);
  expect(error.message).toContain('root / component 3 / main.durationSeconds=0.001');
  expect(error.message).toContain('component 4 / materials=[5,5]');
});

it('checks dimensions and texture budgets without copying image data', () => {
  const pack = fixture().pack();
  const copy = vi.spyOn(pack, 'getAssetBytes');
  expect(checkCompatibility(pack, {}, context).compatible).toBe(true);
  expect(copy).not.toHaveBeenCalled();
  expect(checkCompatibility(pack, {}, { ...context, maxTextureSize: 16 }).issues).toContainEqual(
    expect.objectContaining({
      code: 'LIMIT',
      componentId: 4,
      field: 'materials.5.textures.0.size',
    }),
  );
  expect(checkCompatibility(pack, {}, { ...context, availableTexturePixels: 0 }).compatible).toBe(
    false,
  );
  expect(
    checkCompatibility(
      pack,
      {},
      { ...context, availableTexturePixels: 0, cachedMaterialIds: new Set([5]) },
    ).compatible,
  ).toBe(true);
});

it('scopes component checks to the entry and includes inactive renderers that can become visible', () => {
  const f = fixture();
  f.doc.nodes.push(new NodeT(20, 'other', 0, false, f.doc.nodes[0]!.transform));
  f.doc.components.push(new ComponentT(21, 20, true, 3, particleSource()));
  (f.doc.components[2]!.data as ReturnType<typeof particleSource>).main!.durationSeconds = 0.001;
  f.renderer.mode = RenderMode.StretchedBillboard;
  f.renderer.freeformStretching = true;
  f.doc.nodes[0]!.active = false;
  const report = checkCompatibility(f.pack(), {}, context);
  expect(report.issues.some((i) => i.componentId === 21)).toBe(false);
  expect(report.issues).toContainEqual(
    expect.objectContaining({
      componentId: 4,
      field: 'particleEnvironment.viewPosition',
      code: 'HOST',
    }),
  );
  const disabled = fixture();
  disabled.renderer.freeformStretching = true;
  disabled.renderer.mode = RenderMode.StretchedBillboard;
  disabled.doc.components[1]!.enabled = false;
  expect(checkCompatibility(disabled.pack(), {}, context).compatible).toBe(true);
});

it('collects both infinity codes on active branches and ignores inactive curves', () => {
  const f = fixture();
  const lifetime = linear(1, 2);
  lifetime.curveMax!.preWrap = lifetime.curveMax!.postWrap = WrapMode.UnitySerialized;
  lifetime.curveMax!.sourcePreInfinity = 6;
  lifetime.curveMax!.sourcePostInfinity = 7;
  f.source.main!.lifetime = lifetime;
  const report = checkCompatibility(f.pack(), {}, context);
  expect(report.issues.filter((i) => i.code === 'CAPABILITY').map((i) => i.field)).toEqual([
    'main.lifetime.curveMax.sourcePreInfinity',
    'main.lifetime.curveMax.sourcePostInfinity',
  ]);
  const inactive = fixture();
  inactive.source.main!.lifetime = structuredClone(lifetime);
  inactive.source.main!.lifetime.mode = 0;
  expect(checkCompatibility(inactive.pack(), {}, context).compatible).toBe(true);
});

it('aggregates invalid host inputs and reports disposal without reading assets', () => {
  const pack = fixture().pack();
  const report = checkCompatibility(
    pack,
    {
      seed: -1,
      particleEnvironment: {
        fog: { mode: 'linear', color: [0, 0, 0], start: 2, end: 1 },
        viewPosition: [NaN, 0, 0],
      },
    },
    context,
  );
  expect(report.issues.filter((i) => i.severity === 'error').map((i) => i.field)).toEqual([
    'seed',
    'particleEnvironment.fog',
    'particleEnvironment.viewPosition',
  ]);
  pack.dispose();
  expect(checkCompatibility(pack, {}, context).issues).toEqual([
    expect.objectContaining({ code: 'DISPOSED', field: 'pack' }),
  ]);
});

it('warns about a default color space while keeping the host inputs editable', () => {
  const f = fixture();
  f.doc.colorContext = new ColorContextT(ColorSpace.Unspecified, 'source-project-color-space');
  const pack = f.pack();
  const options = {
    particleEnvironment: { fog: { mode: 'none' as const }, viewPosition: [1, 2, 3] as const },
  };
  const report = checkCompatibility(pack, options, context);
  expect(report.compatible).toBe(true);
  expect(report.issues).toContainEqual(
    expect.objectContaining({ code: 'DEFAULT_COLOR_SPACE', value: 'gamma' }),
  );
  expect(Object.isFrozen(options.particleEnvironment)).toBe(false);
  expect(
    checkCompatibility(pack, { sourceColorSpace: 'linear' }, context).issues.some(
      (i) => i.code === 'DEFAULT_COLOR_SPACE',
    ),
  ).toBe(false);
});

it('requires a host layout only for roots with external stretched anchors', () => {
  const f = fixture();
  f.doc.components.push(
    new ComponentT(
      7,
      1,
      true,
      1,
      new RectLayoutT(
        new Vec2T(0, 0),
        new Vec2T(1, 1),
        new Vec2T(0.5, 0.5),
        new Vec3T(),
        new Vec2T(10, 20),
      ),
    ),
  );
  const pack = f.pack();
  expect(checkCompatibility(pack, {}, context).issues).toContainEqual(
    expect.objectContaining({ code: 'HOST', componentId: 7, field: 'parentLayout' }),
  );
  expect(
    checkCompatibility(pack, { parentLayout: { width: 0, height: 0 } }, context).compatible,
  ).toBe(true);
});

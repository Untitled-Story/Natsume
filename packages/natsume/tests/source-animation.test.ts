import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as I from '../src/format/generated/noa/ir.js';
import { EffectPack } from '../src/pack.js';
import { crc32 } from '../src/loader/zip.js';
import { loadPack } from '../src/loader/load.js';
import { sourceAnimationMetadata, sourceAnimationTarget } from '../src/runtime/source-animation.js';
import { AnimationBindings } from '../src/runtime/animation-bindings.js';
import { Scene } from '../src/runtime/scene.js';
import { animationSupport } from '../src/runtime/animation.js';
import { minimalDocument } from './helpers.js';
import { constant, particleSource } from './particle-fixtures.js';

const imageGuid = '3cf5a44414476512e00c3e7a2569a919';
const gameGuid = 'f6119863801853a4ec5bef179d67706b';
const hash = (text: string) => crc32(new TextEncoder().encode(text));
function serialized(value: unknown): I.SerializedValueT {
  if (Array.isArray(value))
    return new I.SerializedValueT(
      I.SerializedValueData.ArrayValue,
      new I.ArrayValueT(value.map(serialized)),
    );
  if (value !== null && typeof value === 'object')
    return new I.SerializedValueT(
      I.SerializedValueData.ObjectValue,
      new I.ObjectValueT(
        Object.entries(value).map(([name, v]) => new I.SerializedFieldT(name, null, serialized(v))),
      ),
    );
  if (typeof value === 'bigint')
    return new I.SerializedValueT(I.SerializedValueData.SignedValue, new I.SignedValueT(value));
  if (typeof value === 'number')
    return new I.SerializedValueT(I.SerializedValueData.DoubleValue, new I.DoubleValueT(value));
  return new I.SerializedValueT(
    I.SerializedValueData.StringValue,
    new I.StringValueT(String(value)),
  );
}
function fixture(classId = 1, attribute = 'm_IsActive', guid?: string) {
  const document = minimalDocument();
  document.nodes.push(new I.NodeT(2, 'target', 1), new I.NodeT(3, 'other', 1));
  document.sources = [1, 2, 3].map(
    (id) => new I.SourceRecordT(id, 'fixture.prefab', String(100 + id)),
  );
  const graph = new I.SourceExportT();
  graph.files = [new I.UnitySourceFileT('fixture.prefab')];
  graph.objects = [101n, 102n, 103n].map(
    (id) => new I.UnitySourceObjectT(0, id, 1, false, 'GameObject', serialized({ m_IsActive: 1 })),
  );
  graph.objects.push(
    new I.UnitySourceObjectT(
      0,
      401n,
      4,
      false,
      'Transform',
      serialized({
        m_GameObject: { fileID: 101n },
        m_Children: [{ fileID: 403n }, { fileID: 402n }],
      }),
    ),
    new I.UnitySourceObjectT(
      0,
      402n,
      4,
      false,
      'Transform',
      serialized({ m_GameObject: { fileID: 102n }, m_Children: [] }),
    ),
    new I.UnitySourceObjectT(
      0,
      403n,
      4,
      false,
      'Transform',
      serialized({ m_GameObject: { fileID: 103n }, m_Children: [] }),
    ),
  );
  document.sourceExport = graph;
  const source = new I.UnityAnimationBindingT();
  source.rootNodeId = 1;
  source.sourceRootFileId = 101n;
  source.classId = classId;
  source.path = 'target';
  source.attribute = attribute;
  source.resolution = I.BindingResolution.Deferred;
  if (guid) source.script = new I.SourceReferenceT(guid, 11500000n);
  const binding = new I.BindingT();
  binding.property = I.AnimationProperty.SourceBinding;
  binding.source = source;
  const track = new I.TrackT(binding, I.TrackData.FloatTrack, new I.FloatTrackT());
  const component = new I.ComponentT(4, 2);
  const setObject = (data: Record<string, unknown>) => {
    document.sources.push(new I.SourceRecordT(4, 'fixture.prefab', '1982'));
    graph.objects.push(
      new I.UnitySourceObjectT(0, 1982n, classId, false, 'Source', serialized(data)),
    );
  };
  const pack = () => new EffectPack(document, { files: [] } as never, new Map(), new Map());
  return { document, graph, source, binding, track, component, setObject, pack };
}

it('restores dormant particle color from source integers without changing its mode', () => {
  const f = fixture(198);
  for (const node of f.document.nodes.slice(1))
    node.transform = structuredClone(f.document.nodes[0]!.transform);
  const system = particleSource();
  system.main!.color = new I.ColorParameterT();
  system.main!.color.colorMax = new I.ColorT(1, 1, 1, 1);
  const originalMode = system.main!.color!.mode;
  f.component.dataType = I.ComponentData.ParticleSystem;
  f.component.data = system;
  f.document.components.push(f.component);
  f.setObject({ InitialModule: { startColor: { minColor: { r: 1n, g: 1n, b: 1n, a: 1n } } } });
  const binding = new I.BindingT(null, 4, I.AnimationProperty.ParticleColor);
  binding.propertyName = 'minColor';
  const curve = new I.ScalarCurveT();
  curve.keys = [Object.assign(new I.FloatKeyT(), { value: 0.25 })];
  const track = new I.TrackT(
    binding,
    I.TrackData.ColorTrack,
    new I.ColorTrackT(curve, curve, curve, curve),
  );
  f.document.animations = [new I.AnimationT(20, 'color', 1, false, [track])];
  const pack = f.pack();
  const a = new AnimationBindings(pack, new Scene(pack, [1]));
  const b = new AnimationBindings(pack, new Scene(pack, [1]));
  expect(animationSupport(pack.document.animations[0]!, pack)).toEqual([]);
  const compiled = a.compile(track)!;
  expect(compiled.read()).toEqual([1, 1, 1, 1]);
  compiled.sample(0);
  expect(compiled.read()).toEqual([0.25, 0.25, 0.25, 0.25]);
  a.reset();
  expect(compiled.read()).toEqual([1, 1, 1, 1]);
  compiled.sample(0);
  expect(a.systems.get(4)!.main!.color!.colorMin!.r).toBe(0.25);
  expect(a.systems.get(4)!.main!.color!.mode).toBe(originalMode);
  expect(b.compile(track)!.read()).toEqual([1, 1, 1, 1]);
  expect(system.main!.color!.colorMin).toBeNull();
});

describe('source identities verified with Unity 2022.3', () => {
  it.each([
    ['root/雨/泡泡', 3665487052],
    ['m_Color.a', 304273561],
    ['m_Color.r', 2526845255],
    ['m_Color.g', 4215373228],
    ['m_Color.b', 2334886179],
    ['mode', 2546616235],
    ['EmissionModule.m_Bursts.Array.data[0].countCurve.scalar', 1173142787],
  ])('matches native StringToHash for %s', (name, expected) =>
    expect(hash(String(name))).toBe(expected),
  );

  it('leaves absent paths unbound, including a hashed path', () => {
    const f = fixture();
    f.source.hasPathHash = true;
    f.source.pathHash = hash('absent');
    const target = sourceAnimationTarget(f.pack(), f.track);
    expect(target.kind).toBe('unbound');
    expect(target.issues[0]?.code).toBe('SOURCE_ANIMATION_UNBOUND');
  });

  it('uses authored sibling order for duplicate names instead of entity ID order', () => {
    const f = fixture();
    f.document.nodes[2]!.name = 'target';
    const target = sourceAnimationTarget(f.pack(), f.track);
    expect(target.kind).toBe('active');
    expect(target.nodeId).toBe(3);
    expect(target.issues[0]?.code).toBe('SOURCE_ANIMATION_DUPLICATE_PATH');
  });

  it('keeps ambiguous paths blocked when the original order is unavailable', () => {
    const f = fixture();
    f.document.nodes[2]!.name = 'target';
    f.graph.objects = [];
    expect(sourceAnimationTarget(f.pack(), f.track).kind).toBe('unsupported');
  });

  it.each(['UnityEngine.UI', 'UnityEngine.UI.dll'])(
    'identifies Image color through source identity %s',
    (assembly) => {
      const f = fixture(114, 'script_0x1222D899_SSStRRJ', imageGuid);
      f.source.hasPropertyHash = true;
      f.source.propertyHash = 304273561;
      f.component.dataType = I.ComponentData.UIImage;
      f.component.data = new I.UIImageT();
      f.document.components.push(f.component);
      f.graph.references.push(
        new I.UnitySourceReferenceT(
          0,
          'm_Script',
          f.source.script,
          I.SourceResolution.ScriptMetadata,
          0,
          0,
          new I.ScriptIdentityT(assembly, 'UnityEngine.UI', 'Image'),
        ),
      );
      f.setObject({ m_Color: { r: 0.1, g: 0.2, b: 0.3, a: 0.8 } });
      const pack = f.pack(),
        target = sourceAnimationTarget(pack, f.track);
      expect(target).toMatchObject({ kind: 'image-color', componentId: 4, channel: 'a' });
      expect(sourceAnimationMetadata(pack, f.track, target).baseline).toBe(0.8);
    },
  );

  it('maps the native particle hash to the saved first burst count', () => {
    const f = fixture(198, 'ParticleSystem_0x45ECBD03_jonwrsH');
    f.source.hasPropertyHash = true;
    f.source.propertyHash = 1173142787;
    const system = particleSource();
    system.modules.push(
      new I.ParticleModuleT(
        I.ParticleModuleData.EmissionModule,
        new I.EmissionModuleT(constant(0), constant(0), [new I.BurstT(0, constant(3))]),
      ),
    );
    f.component.dataType = I.ComponentData.ParticleSystem;
    f.component.data = system;
    f.document.components.push(f.component);
    f.setObject({ EmissionModule: { m_Bursts: [{ countCurve: { scalar: 3 } }] } });
    const pack = f.pack(),
      target = sourceAnimationTarget(pack, f.track);
    expect(target).toMatchObject({ kind: 'burst-count', slot: 0 });
    expect(sourceAnimationMetadata(pack, f.track, target).baseline).toBe(3);
  });

  it('reads an inactive custom color baseline without changing its source mode', () => {
    const f = fixture(198, 'CustomDataModule.color0.maxColor.r');
    f.component.dataType = I.ComponentData.ParticleSystem;
    f.component.data = particleSource();
    f.document.components.push(f.component);
    f.setObject({ CustomDataModule: { enabled: 1, mode0: 1, color0: { maxColor: { r: 0.73 } } } });
    const pack = f.pack(),
      target = sourceAnimationTarget(pack, f.track);
    expect(target).toMatchObject({ kind: 'custom-color', slot: 0, channel: 'r' });
    expect(sourceAnimationMetadata(pack, f.track, target).baseline).toBe(0.73);
    expect(pack.document.sourceExport!.objects.at(-1)!.data).toEqual(f.graph.objects.at(-1)!.data);
  });

  it.each([0, 1])(
    'uses explicit integer-curve metadata %i rather than a tiny value',
    (isIntCurve) => {
      const f = fixture(114, 'script_0x97CA47AB_kuPVoqJ', gameGuid);
      f.source.hasPropertyHash = true;
      f.source.propertyHash = 2546616235;
      f.component.dataType = I.ComponentData.CustomComponent;
      f.component.data = new I.CustomComponentT(null, f.source.script, [
        new I.SerializedFieldT('mode', null, serialized(0n)),
      ]);
      f.document.components.push(f.component);
      f.setObject({ mode: 0n });
      f.graph.objects.push(
        new I.UnitySourceObjectT(
          0,
          7400000n,
          74,
          false,
          'AnimationClip',
          serialized({
            m_FloatCurves: [
              {
                path: 'target',
                classID: 114,
                attribute: f.source.attribute,
                script: { guid: gameGuid, fileID: 11500000n },
                flags: 0,
                curve: { m_Curve: [{ time: 0, value: 1.401298464324817e-45 }] },
              },
            ],
            m_ClipBindingConstant: {
              genericBindings: [
                {
                  path: hash('target'),
                  typeID: 114,
                  attribute: 2546616235,
                  script: { guid: gameGuid, fileID: 11500000n },
                  isIntCurve,
                },
              ],
            },
          }),
        ),
      );
      const pack = f.pack();
      expect(sourceAnimationMetadata(pack, f.track)).toEqual({
        baseline: 0,
        isIntCurve: !!isIntCurve,
      });
    },
  );
});

const samples = new URL('../../../data/current-noap/scenario/effect/', import.meta.url);
it.skipIf(!existsSync(new URL('bg_zone_01/bg_zone_01.noap', samples)))(
  'resolves actual Image, dormant color, integer mode and duplicate-target evidence',
  async () => {
    for (const [name, kind, baseline, integer] of [
      ['bg_zone_01/bg_zone_01', 'image-color', undefined, false],
      ['cut_in_rui_01/cut_in_rui_01', 'custom-color', undefined, false],
      ['cut_in_tsukasa_01/cut_in_tsukasa_01', 'script-field', 0, true],
      ['kirakira_02_still/kirakira_02_still', 'active', undefined, false],
    ] as const) {
      const pack = await loadPack(readFileSync(new URL(`${name}.noap`, samples)));
      const tracks = pack.document.animations
        .flatMap((a) => a.tracks)
        .filter((t) => t.binding?.property === I.AnimationProperty.SourceBinding);
      const track = tracks.find((t) => sourceAnimationTarget(pack, t).kind === kind);
      expect(track, name).toBeDefined();
      const metadata = sourceAnimationMetadata(pack, track!);
      if (baseline !== undefined) expect(metadata.baseline).toBe(baseline);
      expect(metadata.isIntCurve).toBe(integer);
      if (kind === 'custom-color') expect(metadata.baseline).toBeDefined();
      if (name.startsWith('kirakira'))
        expect(sourceAnimationTarget(pack, track!).issues[0]?.code).toBe(
          'SOURCE_ANIMATION_DUPLICATE_PATH',
        );
      pack.dispose();
    }
  },
);

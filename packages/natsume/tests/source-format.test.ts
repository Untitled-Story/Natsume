import { expect, it } from 'vitest';
import { ByteBuffer } from 'flatbuffers';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import * as I from '../src/format/generated/noa/ir.js';
import { validateDocument } from '../src/format/semantics.js';
import { verifyBuffer } from '../src/format/verify.js';
import { loadPack } from '../src/loader/load.js';
import { checkCompatibility } from '../src/runtime/compatibility.js';
import { archive, encode, minimalDocument } from './helpers.js';

async function withAssets(d: I.DocumentT, assets: Record<string, Uint8Array>) {
  const files = { ...unzipSync(await archive(encode(d))), ...assets };
  const manifest = JSON.parse(strFromU8(files['manifest.json']!));
  for (const [path, bytes] of Object.entries(assets))
    manifest.files.push({
      path,
      kind: path.endsWith('.bin') ? 'source_data' : 'shader_data',
      asset_id: Number(path.match(/assets\/(\d+)/)![1]),
      byte_length: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(files, { level: 0 });
}

const signed = (n: bigint) =>
  new I.SerializedValueT(I.SerializedValueData.SignedValue, new I.SignedValueT(n));
const string = (s: string) =>
  new I.SerializedValueT(I.SerializedValueData.StringValue, new I.StringValueT(s));
const object = (fields: [string, I.SerializedValueT][]) =>
  new I.SerializedValueT(
    I.SerializedValueData.ObjectValue,
    new I.ObjectValueT(fields.map(([name, value]) => new I.SerializedFieldT(name, null, value))),
  );
function sourceDocument() {
  const d = minimalDocument();
  const id = 9007199254740993n;
  d.features = [new I.FeatureRequirementT('unity.source-graph', 1, false)];
  d.sourceExport = new I.SourceExportT(
    0,
    [new I.UnitySourceFileT('root.prefab')],
    [
      new I.UnitySourceObjectT(
        0,
        id,
        4,
        true,
        'Root',
        object([
          ['link', object([['fileID', signed(id)]])],
          [
            'large',
            new I.SerializedValueT(
              I.SerializedValueData.UnsignedValue,
              new I.UnsignedValueT(18446744073709551615n),
            ),
          ],
          [
            'infinity',
            new I.SerializedValueT(
              I.SerializedValueData.SpecialFloatValue,
              new I.SpecialFloatValueT(I.SpecialFloat.PositiveInfinity),
            ),
          ],
        ]),
      ),
    ],
    [
      new I.UnitySourceReferenceT(
        0,
        'Root.link',
        new I.SourceReferenceT(null, id),
        I.SourceResolution.Object_,
        0,
      ),
    ],
    [],
  );
  return d;
}

it('round-trips source object index zero, bigint, stripped and special floats without executing them', async () => {
  const d = sourceDocument();
  const pack = await loadPack(await archive(encode(d)));
  expect(pack.document.sourceExport).toEqual(d.sourceExport);
  expect(Object.isFrozen(pack.document.sourceExport!.objects[0]!.data)).toBe(true);
  expect(pack.describe().playbackReady).toBe(false);
  pack.dispose();
});

it('rejects the historical identity even when the numeric version is equal', () => {
  const d = minimalDocument();
  d.contractId = 'historical-1.0';
  expect(() => verifyBuffer(encode(d), 'noir')).toThrow(/contract/);
  expect(() => validateDocument(d)).toThrow(/version/);
});

it.each([
  'entry',
  'object',
  'identity',
  'target',
  'omitted',
  'duplicate',
  'status',
  'guid',
  'field',
])('rejects malformed preserved source %s', (kind) => {
  const d = sourceDocument(),
    s = d.sourceExport!;
  if (kind === 'entry') s.entryFileIndex = 1;
  if (kind === 'object') s.objects[0]!.fileIndex = 1;
  if (kind === 'identity') s.objects.push(s.objects[0]!);
  if (kind === 'target') s.references[0]!.targetObjectIndex = 1;
  if (kind === 'omitted') s.references = [];
  if (kind === 'duplicate') s.references.push(s.references[0]!);
  if (kind === 'status') d.dependencies = I.DependencyStatus.Unresolved;
  if (kind === 'guid') s.files[0]!.guid = 'invalid';
  if (kind === 'field')
    (s.objects[0]!.data!.data as I.ObjectValueT).fields.push(
      new I.SerializedFieldT('link', null, signed(1n)),
    );
  expect(() => validateDocument(d)).toThrow();
});

it('retains unresolved references and returns their exact preflight locations', async () => {
  const d = sourceDocument(),
    s = d.sourceExport!,
    guid = 'a'.repeat(32);
  d.dependencies = I.DependencyStatus.Unresolved;
  const link = (s.objects[0]!.data!.data as I.ObjectValueT).fields[0]!.value!
    .data as I.ObjectValueT;
  link.fields.push(new I.SerializedFieldT('guid', null, string(guid)));
  s.references[0]!.source!.guid = guid;
  s.references[0]!.resolution = I.SourceResolution.MissingAsset;
  const pack = await loadPack(await archive(encode(d)));
  const report = checkCompatibility(
    pack,
    {},
    {
      maxTextureSize: 4096,
      availableTexturePixels: 1e8,
      cachedMaterialIds: new Set(),
      imageBitmapAvailable: true,
      hasScript: () => false,
      disposed: false,
    },
  );
  expect(report.compatible).toBe(false);
  expect(
    report.issues.some((i) => i.field === 'sourceExport.references.0' && i.severity === 'error'),
  ).toBe(true);
  expect(pack.document.sourceExport!.references[0]!.source!.guid).toBe(guid);
  pack.dispose();
});

it('requires special floats to stay inside preserved source data', () => {
  const d = minimalDocument();
  d.components = [
    new I.ComponentT(
      3,
      1,
      true,
      I.ComponentData.CustomComponent,
      new I.CustomComponentT(new I.ScriptIdentityT('assembly', '', 'Script'), null, [
        new I.SerializedFieldT(
          'value',
          null,
          new I.SerializedValueT(
            I.SerializedValueData.SpecialFloatValue,
            new I.SpecialFloatValueT(),
          ),
        ),
      ]),
    ),
  ];
  expect(() => validateDocument(d)).toThrow(/Special floats/);
});

it('keeps distinct deferred source binding identities instead of merging zero targets', () => {
  const d = minimalDocument();
  d.normalization = I.NormalizationStatus.SourcePreserved;
  d.features = [new I.FeatureRequirementT('animation.source-binding')];
  const binding = (attribute: string) => {
    const source = new I.UnityAnimationBindingT(1, 1n, '', 114, attribute);
    source.resolution = I.BindingResolution.Deferred;
    const curve = new I.ScalarCurveT();
    curve.keys = [new I.FloatKeyT()];
    return new I.TrackT(
      new I.BindingT(source, 0, I.AnimationProperty.SourceBinding),
      I.TrackData.FloatTrack,
      new I.FloatTrackT(curve),
    );
  };
  d.animations = [new I.AnimationT(3, 'source', 0, false, [binding('first'), binding('second')])];
  expect(() => validateDocument(d)).not.toThrow();
  d.animations[0]!.tracks.push(binding('first'));
  expect(() => validateDocument(d)).toThrow(/Conflicting/);
});

it('preserves generated source values when unpacking directly', () => {
  const d = sourceDocument();
  expect(I.Document.getRootAsDocument(new ByteBuffer(encode(d))).unpack().sourceExport).toEqual(
    d.sourceExport,
  );
});

it('loads opaque assets through the same length, hash and file-set checks as images', async () => {
  const d = sourceDocument();
  d.assets = [new I.AssetT(3, I.AssetKind.SourceData)];
  d.sourceExport!.files.push(new I.UnitySourceFileT('source.texture', 'a'.repeat(32), 3));
  const bytes = new Uint8Array([1, 2, 3, 255]);
  const encoded = await withAssets(d, { 'assets/3.bin': bytes });
  const pack = await loadPack(encoded);
  const returned = pack.getAssetBytes(3)!;
  expect(returned).toEqual(bytes);
  returned[0] = 0;
  expect(pack.getAssetBytes(3)![0]).toBe(1);
  const corrupt = unzipSync(encoded);
  corrupt['assets/3.bin']![0] = 0;
  await expect(loadPack(zipSync(corrupt, { level: 0 }))).rejects.toMatchObject({ code: 'HASH' });
  pack.dispose();
});

it('retains source Shader programs and verifies their content identity before adapter selection', async () => {
  const d = sourceDocument();
  d.normalization = I.NormalizationStatus.SourcePreserved;
  d.features.push(new I.FeatureRequirementT('material.unity-source'));
  d.assets = [new I.AssetT(4, I.AssetKind.ShaderData)];
  const m = new I.MaterialT();
  m.id = 3;
  m.model = I.MaterialModel.UnityShader;
  m.renderState = new I.RenderStateT();
  m.shaderDataAssetId = 4;
  m.sourceData = object([]);
  d.materials = [m];
  const recipe = {
    format: 'noa-shader-data',
    version: 1,
    revision: 1,
    model: 'unity-source',
    program_sha256: createHash('sha256')
      .update(new Uint8Array([0, 1, 2, 3]))
      .digest('hex'),
    source: { compressedBlob: '00010203', platforms: 0 },
  };
  const input = () => withAssets(d, { 'assets/4.shader.json': strToU8(JSON.stringify(recipe)) });
  const pack = await loadPack(await input());
  expect(pack.document.materials[0]!.model).toBe(I.MaterialModel.UnityShader);
  expect(JSON.parse(new TextDecoder().decode(pack.getAssetBytes(4))).source).toEqual(recipe.source);
  pack.dispose();
  recipe.program_sha256 = '0'.repeat(64);
  await expect(loadPack(await input())).rejects.toMatchObject({ code: 'HASH' });
});

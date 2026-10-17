import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { loadPack, NatsumeError } from '../src/index.js';
import { verifyBuffer } from '../src/format/verify.js';
import { validateDocument } from '../src/format/semantics.js';
import { FeatureRequirementT } from '../src/format/generated/noa/ir/feature-requirement.js';
import { ComponentT } from '../src/format/generated/noa/ir/component.js';
import { CustomComponentT } from '../src/format/generated/noa/ir/custom-component.js';
import { SourceReferenceT } from '../src/format/generated/noa/ir/source-reference.js';
import { SerializedFieldT } from '../src/format/generated/noa/ir/serialized-field.js';
import { SerializedValueT } from '../src/format/generated/noa/ir/serialized-value.js';
import { SignedValueT } from '../src/format/generated/noa/ir/signed-value.js';
import { ComponentData } from '../src/format/generated/noa/ir/component-data.js';
import { SerializedValueData } from '../src/format/generated/noa/ir/serialized-value-data.js';
import { archive, encode, minimalDocument } from './helpers.js';

describe('NOAP loader', () => {
  it('loads without Pixi or host inputs and preserves immutable inspection data', async () => {
    const pack = await loadPack(await archive());
    expect(pack.describe().counts.nodes).toBe(1);
    expect(pack.describe().requiredHostInputs).toEqual(['main-camera']);
    expect(Object.isFrozen(pack.document.nodes[0]?.transform)).toBe(true);
    expect(pack.getNode(1)?.name).toBe('root');
    expect(pack.findNodes('missing')).toEqual([]);
    pack.dispose();
    pack.dispose();
    expect(() => pack.getAssetBytes(3)).toThrow(/disposed/);
  });
  it('rejects corrupt ZIP bytes before reading accessors', async () => {
    const bytes = await archive();
    bytes[50] = (bytes[50] ?? 0) ^ 1;
    await expect(loadPack(bytes)).rejects.toBeInstanceOf(NatsumeError);
  });
  it('rejects a SHA mismatch even when ZIP CRC is valid', async () => {
    const entries = unzipSync(await archive());
    const manifest = JSON.parse(strFromU8(entries['manifest.json']!));
    manifest.files[0].sha256 = '0'.repeat(64);
    entries['manifest.json'] = strToU8(JSON.stringify(manifest));
    await expect(loadPack(zipSync(entries, { level: 0 }))).rejects.toMatchObject({ code: 'HASH' });
  });
  it('rejects compressed archives outside NOAP v1', async () => {
    await expect(loadPack(zipSync(unzipSync(await archive()), { level: 6 }))).rejects.toMatchObject(
      { code: 'ZIP' },
    );
  });
  it('rejects archive entries absent from the manifest', async () => {
    const files = unzipSync(await archive());
    files['assets/9.png'] = new Uint8Array();
    await expect(loadPack(zipSync(files, { level: 0 }))).rejects.toMatchObject({
      code: 'MANIFEST',
    });
  });
  it('enforces size limits before parsing', async () => {
    await expect(
      loadPack(await archive(), { limits: { maxPackageBytes: 20 } }),
    ).rejects.toMatchObject({ code: 'LIMIT' });
  });
  it('honors cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadPack(new Uint8Array(), { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
  it('preserves 64-bit source references and signed script integers', async () => {
    const document = minimalDocument();
    const data = new CustomComponentT();
    data.sourceScript = new SourceReferenceT(null, 9223372036854775807n);
    data.fields = [
      new SerializedFieldT(
        'boundary',
        null,
        new SerializedValueT(
          SerializedValueData.SignedValue,
          new SignedValueT(-9223372036854775808n),
        ),
      ),
    ];
    document.components = [new ComponentT(3, 1, true, ComponentData.CustomComponent, data)];
    const pack = await loadPack(await archive(encode(document)));
    const loaded = pack.customComponents[0]?.data as CustomComponentT;
    expect(loaded.sourceScript?.fileId).toBe(9223372036854775807n);
    expect((loaded.fields[0]?.value?.data as SignedValueT).value).toBe(-9223372036854775808n);
  });
});

describe('FlatBuffer validation', () => {
  it('accepts generated schema layouts', () =>
    expect(() => verifyBuffer(encode(minimalDocument()), 'noir')).not.toThrow());
  it('rejects truncated tables, root offsets and identifiers', () => {
    const valid = encode(minimalDocument());
    for (const length of [0, 4, 8, 16, valid.length - 1])
      expect(() => verifyBuffer(valid.slice(0, length), 'noir')).toThrow();
    const invalid = valid.slice();
    invalid.fill(255, 0, 4);
    expect(() => verifyBuffer(invalid, 'noir')).toThrow();
  });
  it('rejects NaN values hidden in valid FlatBuffers', () => {
    const document = minimalDocument();
    document.nodes[0]!.transform!.position!.x = NaN;
    expect(() => verifyBuffer(encode(document), 'noir')).toThrow(/Non-finite/);
  });
  it('rejects duplicate IDs and node cycles', () => {
    const document = minimalDocument();
    document.nodes[0]!.id = 2;
    expect(() => validateDocument(document)).toThrow(/Duplicate/);
    document.nodes[0]!.id = 1;
    document.nodes[0]!.parentId = 1;
    expect(() => validateDocument(document)).toThrow(/cycle/);
  });
  it('rejects unknown required features but preserves optional declarations', () => {
    const document = minimalDocument();
    document.features = [new FeatureRequirementT('future', 1, true)];
    expect(() => validateDocument(document)).toThrow(/Unknown required/);
    document.features[0]!.required = false;
    expect(() => validateDocument(document)).not.toThrow();
  });
  it('rejects missing node TRS', () => {
    const document = minimalDocument();
    document.nodes[0]!.transform!.rotation = null;
    expect(() => validateDocument(document)).toThrow(/rotation/);
  });
});

const sample = new URL('../../../data/kirakira.noap', import.meta.url);
describe.skipIf(!existsSync(sample))('local kirakira integration', () => {
  it('reads the actual Noa handoff and independent mesh', async () => {
    const pack = await loadPack(readFileSync(sample));
    expect(pack.describe().counts).toEqual({
      nodes: 17,
      components: 51,
      animations: 2,
      materials: 2,
      assets: 4,
    });
    expect(pack.describe().components).toMatchObject({
      ParticleSystem: 16,
      ParticleRenderer: 16,
      Animator: 1,
      CustomComponent: 16,
      RectLayout: 2,
    });
    expect(pack.describe().requiredHostInputs).toEqual([
      'main-camera',
      'root-layout',
      'source-project-color-space',
    ]);
    expect(
      pack
        .describe()
        .scripts.map((s) => s.count)
        .sort((a, b) => a - b),
    ).toEqual([1, 15]);
    const meshAsset = pack.document.assets.find((asset) => asset.kind === 2)!;
    expect(pack.getMesh(meshAsset.id)?.positions).toHaveLength(4);
    expect(pack.getMesh(meshAsset.id)?.indices).toHaveLength(6);
    const data = pack.getAssetBytes(meshAsset.id)!;
    data.fill(0);
    expect(pack.getAssetBytes(meshAsset.id)).not.toEqual(data);
    const effector = pack.customComponents.find(
      (c) => (c.data as CustomComponentT).script?.className === 'ScenarioEffector',
    )!;
    const animator = (effector.data as CustomComponentT).fields.find(
      (f) => f.name === 'mainAnimator',
    )!;
    expect(animator.value?.dataType).toBe(SerializedValueData.ReferenceValue);
  });
  it('rejects an unknown component union before accessor unpack', () => {
    const files = unzipSync(readFileSync(sample)),
      scene = files['scene.noir']!.slice();
    // Change the component's type discriminator through its vtable field.
    const view = new DataView(scene.buffer);
    const table = view.getUint32(0, true),
      vt = table - view.getInt32(table, true);
    const vectorField = table + view.getUint16(vt + 18, true);
    const vector = vectorField + view.getUint32(vectorField, true);
    const componentOffset = vector + 4,
      component = componentOffset + view.getUint32(componentOffset, true);
    const cvt = component - view.getInt32(component, true);
    scene[component + view.getUint16(cvt + 10, true)] = 255;
    expect(() => verifyBuffer(scene, 'noir')).toThrow(/union/);
  });
});

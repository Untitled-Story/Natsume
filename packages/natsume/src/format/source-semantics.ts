import { check } from '../errors.js';
import type { DocumentT } from './generated/noa/ir/document.js';
import type { SerializedValueT } from './generated/noa/ir/serialized-value.js';
import type { ObjectValueT } from './generated/noa/ir/object-value.js';
import type { ArrayValueT } from './generated/noa/ir/array-value.js';
import type { SignedValueT } from './generated/noa/ir/signed-value.js';
import type { StringValueT } from './generated/noa/ir/string-value.js';
import type { UnityComponentT } from './generated/noa/ir/unity-component.js';
import { SerializedValueData as V } from './generated/noa/ir/serialized-value-data.js';
import { SourceResolution as R } from './generated/noa/ir/source-resolution.js';
import { ComponentData as C } from './generated/noa/ir/component-data.js';
import { AssetKind as A } from './generated/noa/ir/asset-kind.js';
import { AnimationProperty as P } from './generated/noa/ir/animation-property.js';
import { NormalizationStatus as N } from './generated/noa/ir/normalization-status.js';
import { DependencyStatus as D } from './generated/noa/ir/dependency-status.js';

const guid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-fA-F]{32}$/.test(v);
const builtin = (v: unknown) =>
  ['0000000000000000e000000000000000', '0000000000000000f000000000000000'].includes(String(v));

/** Validate preserved values without treating their fields as executable NOIR. */
export function validateSource(d: DocumentT, required: (name: string) => void): void {
  const s = d.sourceExport;
  const needsSource =
    d.components.some((c) => c.dataType === C.UnityComponent) ||
    d.materials.some((m) => m.model === 9) ||
    d.animations.some((a) => a.tracks.some((t) => t.binding?.property === P.SourceBinding));
  check(
    !needsSource || d.normalization === N.SourcePreserved,
    'SEMANTIC',
    'Source semantics require SourcePreserved',
  );
  check(
    d.dependencies !== D.Unresolved || s,
    'SEMANTIC',
    'Unresolved dependencies require a source graph',
  );
  check(
    s ||
      (!d.components.some((c) => c.dataType === C.UnityComponent) &&
        !d.assets.some((a) => a.kind === A.SourceData)),
    'SEMANTIC',
    'Source components/assets require a source graph',
  );
  const expected = new Map<string, { fileId: bigint; guid: string | null }>();
  const key = (owner: number, path: string) => JSON.stringify([owner, path]);
  const value = (v: SerializedValueT, path: string, owner?: number, depth = 0): void => {
    check(
      depth <= 64 && v?.data && v.dataType !== V.NONE && v.dataType !== V.ReferenceValue,
      'SEMANTIC',
      'Invalid preserved source value',
      path,
    );
    if (v.dataType === V.ArrayValue)
      (v.data as ArrayValueT).values.forEach((v, i) => value(v, `${path}[${i}]`, owner, depth + 1));
    if (v.dataType !== V.ObjectValue) return;
    const fields = (v.data as ObjectValueT).fields;
    check(
      new Set(fields.map((f) => f.name)).size === fields.length,
      'SEMANTIC',
      'Duplicate source field',
      path,
    );
    const fid = fields.find((f) => f.name === 'fileID')?.value;
    const pptr =
      owner !== undefined &&
      fid &&
      fields.every((f) => ['fileID', 'guid', 'type'].includes(String(f.name)));
    if (pptr) {
      check(fid.dataType === V.SignedValue, 'SEMANTIC', 'Source PPtr requires int64 fileID', path);
      const fileId = (fid.data as SignedValueT).value;
      if (fileId !== 0n) {
        const g = fields.find((f) => f.name === 'guid')?.value;
        check(
          !g || (g.dataType === V.StringValue && guid((g.data as StringValueT).value)),
          'SEMANTIC',
          'Invalid source PPtr GUID',
          path,
        );
        const raw = g ? String((g.data as StringValueT).value).toLowerCase() : null;
        expected.set(key(owner, path), { fileId, guid: raw === '0'.repeat(32) ? null : raw });
      }
    }
    for (const f of fields)
      value(f.value!, `${path}.${f.name}`, pptr ? undefined : owner, depth + 1);
  };
  // Material payloads are source values too; regular Bridge values remain typed references.
  for (const m of d.materials) {
    if (m.sourceData) value(m.sourceData, `materials.${m.id}.sourceData`);
    if (m.model === 9) {
      required('material.unity-source');
      check(
        m.sourceData && m.shaderDataAssetId,
        'SEMANTIC',
        'UnityShader requires material source and shader asset',
      );
    }
  }
  if (!s) return;
  check(
    d.features.some((f) => f.name === 'unity.source-graph' && f.revision === 1),
    'SEMANTIC',
    'Source graph requires unity.source-graph@1',
  );
  check(s.entryFileIndex < s.files.length, 'SEMANTIC', 'Invalid source entry file index');
  const paths = new Set<string>(),
    guids = new Map<string, number>();
  const assets = new Map(d.assets.map((a) => [a.id, a.kind]));
  s.files.forEach((f, i) => {
    check(
      typeof f.path === 'string' && f.path.length && !paths.has(f.path),
      'SEMANTIC',
      'Invalid/duplicate source path',
    );
    paths.add(f.path);
    if (f.guid !== null) {
      check(guid(f.guid) && !guids.has(f.guid), 'SEMANTIC', 'Invalid/duplicate source GUID');
      guids.set(String(f.guid), i);
    }
    check(
      !f.assetId || [A.Image, A.SourceData].includes(assets.get(f.assetId) ?? A.Unknown),
      'SEMANTIC',
      'Invalid source file asset',
    );
    if (f.metadata) value(f.metadata, `sourceExport.files.${i}.metadata`);
  });
  const identities = new Set<string>();
  s.objects.forEach((o, i) => {
    const id = `${o.fileIndex}:${o.fileId}`;
    check(
      o.fileIndex < s.files.length && o.fileId !== 0n && o.typeName && !identities.has(id),
      'SEMANTIC',
      'Invalid/duplicate source object',
    );
    identities.add(id);
    value(o.data!, String(o.typeName), i);
  });
  const refs = new Set<string>();
  let missing = false;
  for (const r of s.references) {
    const owner: (typeof s.objects)[number] | undefined = s.objects[r.ownerObjectIndex];
    const source = r.source;
    const k = key(r.ownerObjectIndex, String(r.property)),
      raw = expected.get(k);
    check(
      owner && source && r.property && source.fileId !== 0n && !refs.has(k),
      'SEMANTIC',
      'Invalid/duplicate source reference',
      String(r.property),
    );
    refs.add(k);
    check(source.guid === null || guid(source.guid), 'SEMANTIC', 'Invalid source reference GUID');
    check(
      raw && raw.fileId === source.fileId && raw.guid === source.guid,
      'SEMANTIC',
      'Source reference ledger disagrees with serialized fields',
      String(r.property),
    );
    expected.delete(k);
    const fileIndex =
      !source.guid || source.guid === '0'.repeat(32)
        ? owner.fileIndex
        : guids.get(String(source.guid));
    check(
      r.resolution === R.Object_ || r.targetObjectIndex === 0,
      'SEMANTIC',
      'Unexpected source object target',
    );
    check(
      [R.Asset, R.Builtin].includes(r.resolution) || r.targetAssetId === 0,
      'SEMANTIC',
      'Unexpected source asset target',
    );
    check(
      r.resolution === R.ScriptMetadata || !r.script,
      'SEMANTIC',
      'Unexpected source script identity',
    );
    switch (r.resolution) {
      case R.Object_: {
        const o = s.objects[r.targetObjectIndex];
        check(
          o && o.fileIndex === fileIndex && o.fileId === source.fileId,
          'SEMANTIC',
          'Source object target disagrees with original reference',
        );
        break;
      }
      case R.Asset:
        check(
          fileIndex !== undefined &&
            !!r.targetAssetId &&
            s.files[fileIndex]?.assetId === r.targetAssetId,
          'SEMANTIC',
          'Source asset target disagrees with original reference',
        );
        break;
      case R.ScriptMetadata:
        check(
          r.script?.assembly && r.script.className,
          'SEMANTIC',
          'Missing source script identity',
        );
        break;
      case R.Builtin:
        check(builtin(source.guid), 'SEMANTIC', 'Invalid builtin source reference');
        check(
          !r.targetAssetId ||
            (source.guid === '0000000000000000e000000000000000' &&
              (source.fileId === 10210n || source.fileId === 10202n) &&
              assets.get(r.targetAssetId) === A.Mesh),
          'SEMANTIC',
          'Invalid converted builtin asset',
        );
        break;
      case R.MissingAsset:
        check(fileIndex === undefined, 'SEMANTIC', 'Missing source asset exists');
        missing = true;
        break;
      case R.MissingObject:
        check(
          fileIndex !== undefined &&
            !identities.has(`${fileIndex}:${source.fileId}`) &&
            !s.files[fileIndex]?.assetId,
          'SEMANTIC',
          'Missing source object exists',
        );
        missing = true;
        break;
    }
  }
  check(expected.size === 0, 'SEMANTIC', 'Source reference ledger is incomplete');
  check(
    d.dependencies === (missing ? D.Unresolved : D.Complete),
    'SEMANTIC',
    'Source dependency status disagrees with references',
  );
  for (const c of d.components)
    if (c.dataType === C.UnityComponent) {
      required('unity.source-components');
      required('unity.source-graph');
      const o = s.objects[(c.data as UnityComponentT).sourceObjectIndex];
      const record = d.sources.find((r) => r.entityId === c.id);
      check(
        o && o.fileIndex === s.entryFileIndex && ![1, 4].includes(o.classId),
        'SEMANTIC',
        'Invalid Unity component source index',
      );
      check(
        record?.objectIdentity === String(o.fileId) &&
          record.assetPath === s.files[o.fileIndex]?.path,
        'SEMANTIC',
        'Source component identity mismatch',
      );
    }
  for (const diag of s.diagnostics)
    check(
      diag.code && diag.message && ['warning', 'error'].includes(String(diag.severity)),
      'SEMANTIC',
      'Invalid source diagnostic',
    );
}

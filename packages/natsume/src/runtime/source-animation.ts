import type { EffectPack, DeepReadonly as R } from '../pack.js';
import type { TrackT } from '../format/generated/noa/ir/track.js';
import { ComponentData as C } from '../format/generated/noa/ir/component-data.js';
import { AnimationProperty as P } from '../format/generated/noa/ir/animation-property.js';
import { ParticleModuleData as M } from '../format/generated/noa/ir/particle-module-data.js';
import type { ParticleSystemT } from '../format/generated/noa/ir/particle-system.js';
import type { CustomComponentT } from '../format/generated/noa/ir/custom-component.js';
import { crc32 } from '../loader/zip.js';
import type { SupportIssue } from './support-checks.js';
import type { SerializedValueT } from '../format/generated/noa/ir/serialized-value.js';
import { SerializedValueData as V } from '../format/generated/noa/ir/serialized-value-data.js';

export interface SourceAnimationTarget {
  readonly kind:
    | 'unbound'
    | 'active'
    | 'image-color'
    | 'burst-count'
    | 'custom-color'
    | 'script-field'
    | 'unsupported';
  readonly nodeId: number;
  readonly componentId: number;
  readonly field: string;
  readonly channel?: 'r' | 'g' | 'b' | 'a';
  readonly slot?: number;
  readonly issues: readonly SupportIssue[];
}
const cache = new WeakMap<EffectPack, WeakMap<object, SourceAnimationTarget>>();
const encoder = new TextEncoder();
const hash = (value: string) => crc32(encoder.encode(value));

function field(value: R<SerializedValueT> | null | undefined, name: string) {
  const data = value?.data;
  return value?.dataType === V.ObjectValue && data && 'fields' in data
    ? data.fields.find((f) => f.name === name)?.value
    : undefined;
}
function array(value: R<SerializedValueT> | null | undefined) {
  const data = value?.data;
  return value?.dataType === V.ArrayValue && data && 'values' in data ? data.values : [];
}
function scalar(value: R<SerializedValueT> | null | undefined) {
  const data = value?.data;
  return data && 'value' in data ? data.value : undefined;
}
function sourceObject(pack: EffectPack, entityId: number) {
  const record = pack.document.sources.find((s) => s.entityId === entityId);
  const source = pack.document.sourceExport;
  return (
    record &&
    source?.objects.find(
      (o) =>
        String(o.fileId) === record.objectIdentity &&
        source.files[o.fileIndex]?.path === record.assetPath,
    )
  );
}
function sourceChildren(pack: EffectPack, nodeId: number) {
  const children = pack.nodes.filter((n) => n.parentId === nodeId);
  if (children.length < 2) return children;
  const source = pack.document.sourceExport;
  const parent = sourceObject(pack, nodeId);
  if (!source || !parent) return;
  const transform = source.objects.find(
    (o) =>
      o.fileIndex === parent.fileIndex &&
      (o.classId === 4 || o.classId === 224) &&
      scalar(field(field(o.data, 'm_GameObject'), 'fileID')) === parent.fileId,
  );
  const order = array(field(transform?.data, 'm_Children')).map((child) => {
    const id = scalar(field(child, 'fileID'));
    const t = source.objects.find((o) => o.fileIndex === parent.fileIndex && o.fileId === id);
    return scalar(field(field(t?.data, 'm_GameObject'), 'fileID'));
  });
  const ranks = new Map(
    children.map((child) => [child.id, order.indexOf(sourceObject(pack, child.id)?.fileId)]),
  );
  if ([...ranks.values()].some((rank) => rank < 0)) return;
  return children.sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!);
}

export interface SourceAnimationMetadata {
  readonly baseline?: number;
  readonly isIntCurve?: boolean;
}
/** @internal Reads a dormant source scalar without changing the active module mode. */
export function sourceFieldBaseline(
  pack: EffectPack,
  componentId: number,
  path: string,
): number | undefined {
  let value = sourceObject(pack, componentId)?.data;
  for (const part of path.replace(/\.Array\.data\[(\d+)\]/g, '.$1').split('.'))
    value = /^\d+$/.test(part) ? array(value)[Number(part)] : field(value, part);
  const raw = scalar(value);
  return typeof raw === 'number' && Number.isFinite(raw)
    ? raw
    : typeof raw === 'bigint' && Number.isSafeInteger(Number(raw))
      ? Number(raw)
      : undefined;
}
const metadata = new WeakMap<EffectPack, WeakMap<object, SourceAnimationMetadata>>();

/** Reads stored field values and explicit clip binding types; absent evidence stays undefined. */
export function sourceAnimationMetadata(
  pack: EffectPack,
  track: R<TrackT>,
  target = sourceAnimationTarget(pack, track),
): SourceAnimationMetadata {
  const previous = metadata.get(pack)?.get(track);
  if (previous) return previous;
  const source = track.binding?.source;
  let value = sourceObject(pack, target.componentId || target.nodeId)?.data;
  const parts = target.field.replace(/\.Array\.data\[(\d+)\]/g, '.$1').split('.');
  for (const part of parts)
    value = /^\d+$/.test(part) ? array(value)[Number(part)] : field(value, part);
  const raw = scalar(value);
  const baseline =
    (typeof raw === 'number' && Number.isFinite(raw)) ||
    (typeof raw === 'bigint' && Number.isSafeInteger(Number(raw)))
      ? Number(raw)
      : undefined;
  const types = new Set<boolean>();
  if (source)
    for (const object of pack.document.sourceExport?.objects ?? []) {
      if (object.classId !== 74) continue;
      const curves = array(field(object.data, 'm_FloatCurves'));
      const matches = curves.some(
        (curve) =>
          scalar(field(curve, 'path')) === source.path &&
          Number(scalar(field(curve, 'classID'))) === source.classId &&
          scalar(field(curve, 'attribute')) === source.attribute &&
          Number(scalar(field(curve, 'flags'))) === source.flags &&
          (source.script
            ? scalar(field(field(curve, 'script'), 'guid')) === source.script.guid &&
              scalar(field(field(curve, 'script'), 'fileID')) === source.script.fileId
            : Number(scalar(field(field(curve, 'script'), 'fileID'))) === 0),
      );
      if (!matches) continue;
      const generic = array(field(field(object.data, 'm_ClipBindingConstant'), 'genericBindings'));
      for (const binding of generic) {
        if (
          Number(scalar(field(binding, 'typeID'))) !== source.classId ||
          Number(scalar(field(binding, 'path'))) !==
            (source.hasPathHash ? source.pathHash : hash(String(source.path))) ||
          Number(scalar(field(binding, 'attribute'))) !==
            (source.hasPropertyHash ? source.propertyHash : hash(String(source.attribute)))
        )
          continue;
        const script = field(binding, 'script');
        if (
          source.script
            ? scalar(field(script, 'guid')) !== source.script.guid ||
              scalar(field(script, 'fileID')) !== source.script.fileId
            : Number(scalar(field(script, 'fileID'))) !== 0
        )
          continue;
        const type = scalar(field(binding, 'isIntCurve'));
        if (type === 0 || type === 0n) types.add(false);
        if (type === 1 || type === 1n) types.add(true);
      }
    }
  const result: SourceAnimationMetadata = {
    ...(baseline === undefined ? {} : { baseline }),
    ...(types.size === 1 ? { isIntCurve: [...types][0]! } : {}),
  };
  let entries = metadata.get(pack);
  if (!entries) metadata.set(pack, (entries = new WeakMap()));
  entries.set(track, result);
  return result;
}

/** Resolves preserved identities against actual hierarchy and serialized fields. */
export function sourceAnimationTarget(pack: EffectPack, track: R<TrackT>): SourceAnimationTarget {
  const cached = cache.get(pack)?.get(track);
  if (cached) return cached;
  const b = track.binding!,
    s = b.source!;
  const issues: SupportIssue[] = [];
  const result = (
    kind: SourceAnimationTarget['kind'],
    nodeId = 0,
    componentId = 0,
    field = '',
    extra: Partial<SourceAnimationTarget> = {},
  ): SourceAnimationTarget => {
    const value = { kind, nodeId, componentId, field, issues, ...extra };
    let entries = cache.get(pack);
    if (!entries) cache.set(pack, (entries = new WeakMap()));
    entries.set(track, value);
    return value;
  };
  const unsupported = (message: string) => {
    issues.push({
      severity: 'error',
      code: 'CAPABILITY',
      field: 'binding.source',
      value: s,
      message,
    });
    return result('unsupported');
  };
  if (b.property !== P.SourceBinding || !s) return unsupported('Missing source animation identity');
  if (s.flags !== 0) return unsupported('Source animation flags have not been verified');
  const unbound = () => {
    issues.push({
      severity: 'warning',
      code: 'SOURCE_ANIMATION_UNBOUND',
      field: 'binding.source',
      value: s,
      message:
        'No matching animation target exists under the Animator root; Unity leaves this binding unapplied.',
    });
    return result('unbound');
  };
  const component = pack.getComponent(b.targetId);
  let nodeId = component?.nodeId ?? (pack.getNode(b.targetId) ? b.targetId : 0);
  if (!nodeId) {
    const root = pack.getNode(s.rootNodeId);
    if (!root) return unsupported('Source animation root is unavailable');
    const paths: { id: number; path: string }[] = [];
    let ordered = true;
    const visit = (id: number, path: string) => {
      paths.push({ id, path });
      const children = sourceChildren(pack, id);
      if (!children) ordered = false;
      for (const node of children ?? pack.nodes.filter((n) => n.parentId === id))
        visit(node.id, path ? `${path}/${node.name}` : String(node.name));
    };
    visit(root.id, '');
    const matches = paths.filter(({ path }) =>
      s.hasPathHash ? hash(path) === s.pathHash : path === s.path,
    );
    if (matches.length > 1) {
      if (!ordered)
        return unsupported('Source animation path is ambiguous without source sibling order');
      issues.push({
        severity: 'warning',
        code: 'SOURCE_ANIMATION_DUPLICATE_PATH',
        field: 'binding.source',
        value: s,
        message:
          'Duplicate animation path uses the first matching node in the authored sibling order, as Unity does.',
      });
    }
    nodeId = matches[0]?.id ?? 0;
    if (!nodeId) return unbound();
  }
  const matchesField = (field: string) =>
    s.hasPropertyHash ? hash(field) === s.propertyHash : s.attribute === field;
  if (s.classId === 1) {
    if (matchesField('m_IsActive')) return result('active', nodeId, 0, 'm_IsActive');
    return unsupported('Unknown GameObject animation field');
  }
  const components = pack.getComponents(nodeId).filter((c) => {
    if (s.classId === 198) return c.dataType === C.ParticleSystem;
    if (s.classId !== 114) return false;
    if (c.dataType === C.CustomComponent) {
      const script = (c.data as R<CustomComponentT>).sourceScript;
      return !!s.script && script?.guid === s.script.guid && script.fileId === s.script.fileId;
    }
    if (c.dataType !== C.UIImage || !s.script) return false;
    return (
      pack.document.sourceExport?.references.some(
        (reference) =>
          String(reference.script?.assembly).replace(/\.dll$/, '') === 'UnityEngine.UI' &&
          reference.script?.namespace === 'UnityEngine.UI' &&
          reference.script?.className === 'Image' &&
          reference.source?.guid === s.script!.guid &&
          reference.source.fileId === s.script!.fileId,
      ) ?? false
    );
  });
  if (!components.length) return unbound();
  if (components.length > 1) return unsupported('Source animation component is ambiguous');
  const target = components[0]!;
  if (target.dataType === C.UIImage) {
    for (const channel of ['r', 'g', 'b', 'a'] as const)
      if (matchesField(`m_Color.${channel}`))
        return result('image-color', nodeId, target.id, `m_Color.${channel}`, { channel });
  }
  if (target.dataType === C.ParticleSystem) {
    const system = target.data as R<ParticleSystemT>;
    const emission = system.modules.find((m) => m.dataType === M.EmissionModule)?.data;
    if (emission && 'bursts' in emission)
      for (let slot = 0; slot < emission.bursts.length; slot++) {
        const field = `EmissionModule.m_Bursts.Array.data[${slot}].countCurve.scalar`;
        if (matchesField(field)) return result('burst-count', nodeId, target.id, field, { slot });
      }
    for (let slot = 0; slot < 2; slot++)
      for (const channel of ['r', 'g', 'b', 'a'] as const) {
        const field = `CustomDataModule.color${slot}.maxColor.${channel}`;
        if (matchesField(field))
          return result('custom-color', nodeId, target.id, field, { slot, channel });
      }
  }
  if (target.dataType === C.CustomComponent) {
    const names = (target.data as R<CustomComponentT>).fields
      .map((f) => String(f.name))
      .filter(matchesField);
    if (names.length === 1) return result('script-field', nodeId, target.id, names[0]!);
    if (names.length > 1) return unsupported('Source script field hash is ambiguous');
  }
  return unsupported('Source animation field has no verified execution mapping');
}

import * as I from '../src/format/generated/noa/ir.js';
import { crc32 } from '../src/loader/zip.js';
import { EffectPack } from '../src/pack.js';
import { minimalDocument } from './helpers.js';

export const scriptIdentity = new I.ScriptIdentityT('Tests', '', 'AnimatedFields');
function value(v: unknown): I.SerializedValueT {
  if (Array.isArray(v))
    return new I.SerializedValueT(
      I.SerializedValueData.ArrayValue,
      new I.ArrayValueT(v.map(value)),
    );
  if (v !== null && typeof v === 'object')
    return new I.SerializedValueT(
      I.SerializedValueData.ObjectValue,
      new I.ObjectValueT(
        Object.entries(v).map(([k, v]) => new I.SerializedFieldT(k, null, value(v))),
      ),
    );
  if (typeof v === 'number')
    return new I.SerializedValueT(I.SerializedValueData.DoubleValue, new I.DoubleValueT(v));
  if (typeof v === 'bigint')
    return new I.SerializedValueT(I.SerializedValueData.SignedValue, new I.SignedValueT(v));
  if (typeof v === 'boolean')
    return new I.SerializedValueT(I.SerializedValueData.BooleanValue, new I.BooleanValueT(v));
  return new I.SerializedValueT(I.SerializedValueData.StringValue, new I.StringValueT(String(v)));
}
/** Controlled source metadata with both integer bits and an ordinary numeric curve. */
export function scriptFieldPack() {
  const d = minimalDocument(),
    guid = 'a'.repeat(32),
    sourceScript = new I.SourceReferenceT(guid, 11500000n);
  const component = new I.CustomComponentT(scriptIdentity, sourceScript, [
    new I.SerializedFieldT('mode', null, value(0n)),
    new I.SerializedFieldT('weight', null, value(2)),
    new I.SerializedFieldT('visible', null, value(true)),
  ]);
  d.components = [new I.ComponentT(4, 1, true, I.ComponentData.CustomComponent, component)];
  const fields = [
    ['mode', 1.401298464324817e-45, 1],
    ['weight', 4, 0],
    ['visible', 0, 0],
  ] as const;
  const tracks = fields.map(([name, sample]) => {
    const binding = new I.UnityAnimationBindingT(1, 1n, '', 114, name, sourceScript);
    const curve = new I.ScalarCurveT();
    curve.keys = [Object.assign(new I.FloatKeyT(), { value: sample })];
    return new I.TrackT(
      new I.BindingT(binding, 4, I.AnimationProperty.SourceBinding),
      I.TrackData.FloatTrack,
      new I.FloatTrackT(curve),
    );
  });
  d.animations = [new I.AnimationT(10, 'Fields', 1, false, tracks)];
  d.entries[0]!.actions = [new I.ActionT(I.ActionKind.PlayClip, 0, 10)];
  const source = new I.SourceExportT();
  source.files = [new I.UnitySourceFileT('fields.anim')];
  source.objects = [
    new I.UnitySourceObjectT(
      0,
      7400000n,
      74,
      false,
      'AnimationClip',
      value({
        m_FloatCurves: fields.map(([name]) => ({
          path: '',
          classID: 114,
          attribute: name,
          script: { guid, fileID: 11500000n },
          flags: 0,
        })),
        m_ClipBindingConstant: {
          genericBindings: fields.map(([name, , isIntCurve]) => ({
            path: 0,
            typeID: 114,
            attribute: crc32(new TextEncoder().encode(name)),
            script: { guid, fileID: 11500000n },
            isIntCurve,
          })),
        },
      }),
    ),
  ];
  d.sourceExport = source;
  return new EffectPack(
    d,
    { format: 'noa-package', version: 1, noir_version: [1, 0], document: 'scene.noir', files: [] },
    new Map(),
    new Map(),
  );
}

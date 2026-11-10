import type { DeepReadonly as R } from '../pack.js';
import type { CustomComponentT } from '../format/generated/noa/ir/custom-component.js';
import { check } from '../errors.js';

/** Storage types available to animated Bridge fields. */
export type ScriptFieldType = 'float' | 'int' | 'bool';
export type ScriptFieldValue = number | boolean;

/** @internal Unity scalar conversion, verified with ordinary and encoded field curves. */
export function animatedScriptFieldValue(
  type: ScriptFieldType,
  sample: number,
  integerBits = false,
): ScriptFieldValue {
  const value = type === 'int' && integerBits ? sample : Math.fround(sample);
  if (type === 'bool') return Math.abs(value) > Math.fround(0.001);
  if (type === 'float') return value;
  // Unity's ordinary int field conversion rounds -0.5 to zero; other tested
  // half values round away from zero (both SampleAnimation and Animator).
  const integer = value === -0.5 ? 0 : Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
  check(
    integer >= -2147483648 && integer <= 2147483647,
    'HOST',
    'Animated script int exceeds signed 32-bit range',
  );
  return integer === 0 ? 0 : integer;
}
export interface ScriptDeclaration {
  /** Exact serialized field names; checked without running the factory. */
  readonly animatedFields?: Readonly<Record<string, ScriptFieldType>>;
}
/** Resolves an animated script field's declared type; shared by preflight and instance bindings. */
export type ScriptFieldResolver = (
  component: R<CustomComponentT>,
  name: string,
) => ScriptFieldType | undefined;

/** @internal Reads only numeric/boolean scalars, without losing integer precision. */
export function scriptFieldBaseline(
  component: R<CustomComponentT>,
  name: string,
): ScriptFieldValue | undefined {
  const value = component.fields.find((field) => field.name === name)?.value?.data;
  if (!value || !('value' in value)) return;
  if (typeof value.value === 'boolean') return value.value;
  if (typeof value.value === 'bigint')
    return Number.isSafeInteger(Number(value.value)) ? Number(value.value) : undefined;
  if (typeof value.value === 'number' && Number.isFinite(value.value)) return value.value;
  return;
}

/** @internal Declaration and serialized storage must agree. */
export function validScriptField(
  type: ScriptFieldType | undefined,
  baseline: ScriptFieldValue | undefined,
): boolean {
  return type === 'bool'
    ? typeof baseline === 'boolean'
    : type === 'int'
      ? typeof baseline === 'number' &&
        Number.isInteger(baseline) &&
        baseline >= -2147483648 &&
        baseline <= 2147483647
      : type === 'float' && typeof baseline === 'number';
}

import { check } from '../errors.js';
import type { DeepReadonly as R } from '../pack.js';
import type { ExternalForcesModuleT } from '../format/generated/noa/ir/external-forces-module.js';
import { InfluenceFilter } from '../format/generated/noa/ir/influence-filter.js';

/** Borrowed world-space inputs, valid only during sample(). Do not retain them. */
export interface ParticleForceQuery {
  readonly position: Float64Array;
  readonly velocity: Float64Array;
  readonly deltaSeconds: number;
  readonly timeSeconds: number;
  readonly normalizedAge: number;
  readonly systemId: number;
  readonly particleId: number;
}

/** Host-owned force field. Acceleration is expressed in world units per second squared. */
export interface ParticleForceField {
  readonly layer: number;
  readonly enabled?: boolean;
  /** Write acceleration to out[0..2]. The output is cleared before each call. */
  sample(query: ParticleForceQuery, out: Float64Array): void;
}

/** Bind individual references to one field; bind world-search slots to a field list. */
export type ParticleForceFields = Readonly<
  Record<string, ParticleForceField | readonly ParticleForceField[]>
>;

export function copyForceFields(
  value: ParticleForceFields | undefined,
): ParticleForceFields | undefined {
  if (!value) return;
  const result: Record<string, ParticleForceField | readonly ParticleForceField[]> =
    Object.create(null);
  for (const [slot, binding] of Object.entries(value)) {
    check(slot.length > 0, 'HOST', 'Force field binding requires a slot');
    for (const field of Array.isArray(binding) ? binding : [binding])
      check(
        field &&
          typeof field.sample === 'function' &&
          Number.isInteger(field.layer) &&
          field.layer >= 0 &&
          field.layer < 32 &&
          (field.enabled === undefined || typeof field.enabled === 'boolean'),
        'HOST',
        'Invalid host force field',
      );
    result[slot] = Array.isArray(binding) ? [...binding] : binding;
  }
  return result;
}

/** Resolve active source slots without requiring references ignored by the source filter. */
export function selectForceFields(
  module: R<ExternalForcesModuleT>,
  bindings: ParticleForceFields | undefined,
): readonly ParticleForceField[] {
  const selected = new Set<ParticleForceField>();
  const add = (slot: string, mask: boolean) => {
    const binding = bindings?.[slot];
    check(binding !== undefined, 'HOST', `Missing force field slot ${slot}`);
    for (const field of Array.isArray(binding) ? binding : [binding])
      if (!mask || (module.layerMask & (1 << field.layer)) !== 0) selected.add(field);
  };
  if (module.filter !== InfluenceFilter.List) add(String(module.hostForceFieldsSlot), true);
  if (module.filter !== InfluenceFilter.LayerMask)
    for (const reference of module.influences)
      if (reference.hostSlot) add(String(reference.hostSlot), false);
  return [...selected];
}

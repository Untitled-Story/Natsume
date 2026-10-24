import { check } from '../errors.js';

/** Host material inputs and missing project sorting information. */
export interface RenderEnvironment {
  /** Additive mip level bias; 0 selects the texture's ordinary derivative-based level. */
  readonly globalMipBias?: number;
  /** Sorting layer ID to rank, used when the package has no renderer rank for that layer. */
  readonly sortingLayers?: Readonly<Record<number, number>>;
}

export function copyRenderEnvironment(value?: RenderEnvironment): RenderEnvironment | undefined {
  if (value === undefined) return undefined;
  check(value !== null && typeof value === 'object', 'HOST', 'Invalid renderEnvironment');
  check(
    value.globalMipBias === undefined || Number.isFinite(value.globalMipBias),
    'HOST',
    'globalMipBias must be finite',
  );
  let sortingLayers: Readonly<Record<number, number>> | undefined;
  if (value.sortingLayers !== undefined) {
    const layers = value.sortingLayers;
    check(
      layers !== null &&
        typeof layers === 'object' &&
        !Array.isArray(layers) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(layers)),
      'HOST',
      'sortingLayers must be a layer ID to rank record',
    );
    const copy: Record<number, number> = {};
    for (const [key, rank] of Object.entries(layers)) {
      const id = Number(key);
      check(
        String(id) === key &&
          Number.isInteger(id) &&
          id >= -2147483648 &&
          id <= 2147483647 &&
          typeof rank === 'number' &&
          Number.isFinite(rank),
        'HOST',
        'sortingLayers requires signed 32-bit layer IDs and finite ranks',
      );
      copy[id] = rank;
    }
    sortingLayers = Object.freeze(copy);
  }
  return Object.freeze({
    ...(value.globalMipBias === undefined ? {} : { globalMipBias: value.globalMipBias }),
    ...(sortingLayers ? { sortingLayers } : {}),
  });
}

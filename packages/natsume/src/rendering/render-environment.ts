import { check } from '../errors.js';

/** Host inputs used by source material programs. */
export interface RenderEnvironment {
  /** Additive mip level bias; 0 selects the texture's ordinary derivative-based level. */
  readonly globalMipBias?: number;
}

export function copyRenderEnvironment(value?: RenderEnvironment): RenderEnvironment | undefined {
  if (value === undefined) return undefined;
  check(value !== null && typeof value === 'object', 'HOST', 'Invalid renderEnvironment');
  check(
    value.globalMipBias === undefined || Number.isFinite(value.globalMipBias),
    'HOST',
    'globalMipBias must be finite',
  );
  return Object.freeze({ ...value });
}

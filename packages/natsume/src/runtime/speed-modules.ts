import type { DeepReadonly as R } from '../pack.js';
import type { Vec2T } from '../format/generated/noa/ir/vec2.js';
import type { SizeBySpeedModuleT } from '../format/generated/noa/ir/size-by-speed-module.js';
import { scalar } from './parameters.js';

/** Native collapsed ranges retain the lower endpoint as the inverse width. */
export function speedPhase(speed: number, range: R<Vec2T>): number {
  return range.x === range.y
    ? Math.max(0, Math.min(1, (Math.fround(speed) - range.x) * range.x))
    : Math.max(0, Math.min(1, (speed - range.x) / (range.y - range.x)));
}

export function speedSize(
  module: R<SizeBySpeedModuleT>,
  speed: number,
  factor: number,
  axis: number,
): number {
  const size = module.size;
  const parameter = !module.separateAxes || axis === 0 ? size?.x : axis === 1 ? size?.y : size?.z;
  return scalar(parameter, speedPhase(speed, module.speedRange!), factor, 1);
}

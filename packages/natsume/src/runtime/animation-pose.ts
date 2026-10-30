import { quat } from 'gl-matrix';
import { eulerQuaternion, quaternionEuler, type CompiledBinding } from './animation-bindings.js';

export interface PoseValue {
  readonly binding: CompiledBinding;
  readonly value: readonly number[];
  readonly mask: readonly boolean[];
}
export type AnimationPose = Map<string, PoseValue>;

export function poseValue(
  binding: CompiledBinding,
  value: readonly number[],
  mask = binding.mask,
): PoseValue {
  return {
    binding,
    value: binding.rotation === 'euler' ? Array.from(eulerQuaternion(value)) : [...value],
    mask: binding.rotation ? [true, true, true, true] : mask,
  };
}
export function blendValue(a: PoseValue, b: PoseValue, weight: number): PoseValue {
  let value = [...a.value];
  if (a.binding.discrete) value = [weight > 0.5 ? b.value[0]! : a.value[0]!];
  else if (a.binding.rotation) {
    const target =
      quat.dot(a.value as quat, b.value as quat) < 0 ? b.value.map((v) => -v) : b.value;
    const q = quat.lerp(quat.create(), a.value as quat, target as quat, weight);
    value = Array.from(quat.normalize(q, q));
  } else
    for (let i = 0; i < value.length; i++)
      if (b.mask[i]) value[i] = a.value[i]! + (b.value[i]! - a.value[i]!) * weight;
  return { binding: a.binding, value, mask: a.mask.map((v, i) => v || !!b.mask[i]) };
}
export function mixPoses(a: AnimationPose, b: AnimationPose, weight: number): AnimationPose {
  const result = new Map(a);
  for (const [key, value] of b) {
    const previous = result.get(key);
    result.set(
      key,
      previous
        ? blendValue(previous, value, weight)
        : blendValue(poseValue(value.binding, value.binding.baseline), value, weight),
    );
  }
  return result;
}
export function addPose(
  base: AnimationPose,
  layer: AnimationPose,
  reference: AnimationPose,
  weight: number,
): AnimationPose {
  const result = new Map(base);
  for (const [key, b] of layer) {
    const a = result.get(key) ?? poseValue(b.binding, b.binding.baseline),
      ref = reference.get(key) ?? poseValue(b.binding, b.binding.baseline);
    let value = [...a.value];
    if (b.binding.discrete) {
      value = [Number(a.value[0]! + (b.value[0]! - ref.value[0]!) * weight !== 0)];
    } else if (b.binding.rotation) {
      const delta = quat.multiply(
        quat.create(),
        quat.invert(quat.create(), ref.value as quat),
        b.value as quat,
      );
      const weighted = quat.normalize(quat.create(), [
        delta[0] * weight,
        delta[1] * weight,
        delta[2] * weight,
        delta[3],
      ]);
      value = Array.from(
        quat.normalize(weighted, quat.multiply(weighted, a.value as quat, weighted)),
      );
    } else
      for (let i = 0; i < value.length; i++)
        if (b.mask[i]) value[i] = a.value[i]! + (b.value[i]! - ref.value[i]!) * weight;
    result.set(key, { binding: a.binding, value, mask: a.mask });
  }
  return result;
}
export function writePose(pose: AnimationPose): void {
  for (const { binding, value } of pose.values()) {
    if (binding.rotation === 'euler')
      binding.write(quaternionEuler({ x: value[0]!, y: value[1]!, z: value[2]!, w: value[3]! }));
    else binding.write(value);
  }
}

import { mat4, vec3 } from 'gl-matrix';
import { check } from '../errors.js';
import type { EffectPack } from '../pack.js';
import { ComponentData } from '../format/generated/noa/ir/component-data.js';
import { Space } from '../format/generated/noa/ir/space.js';
import { ScalingMode } from '../format/generated/noa/ir/scaling-mode.js';
import type { SceneNode } from './scene.js';

/** Unity renderer emission uses the source frame, independently of renderer visibility. */
export class RendererShapeTransform {
  unavailable = false;
  private readonly matrix = mat4.create();
  private readonly scale = vec3.create();
  private readonly fallbackDirection = vec3.create();
  private readonly node: SceneNode;
  constructor(
    pack: EffectPack,
    id: number,
    private readonly sprite: boolean,
    private readonly space: Space,
    private readonly scaling: ScalingMode,
    private readonly emitter: SceneNode,
    nodes?: ReadonlyMap<number, SceneNode>,
  ) {
    const component = pack.getComponent(id);
    check(
      component?.dataType === (sprite ? ComponentData.SpriteRenderer : ComponentData.MeshRenderer),
      'CAPABILITY',
      'Shape source renderer is unavailable',
    );
    const node = nodes?.get(component.nodeId);
    check(node, 'CAPABILITY', 'Shape source renderer is outside the instance');
    this.node = node;
  }
  update(): void {
    this.unavailable = this.node.destroyed;
    vec3.set(this.fallbackDirection, 0, 0, 1);
    if (this.space !== Space.Local)
      vec3.transformQuat(
        this.fallbackDirection,
        this.fallbackDirection,
        this.unavailable ? this.emitter.worldRotation : this.node.worldRotation,
      );
    if (this.unavailable) {
      if (this.space === Space.Local) mat4.identity(this.matrix);
      else {
        mat4.fromQuat(this.matrix, this.emitter.worldRotation);
        this.matrix[12] = this.emitter.worldMatrix[12]!;
        this.matrix[13] = this.emitter.worldMatrix[13]!;
        this.matrix[14] = this.emitter.worldMatrix[14]!;
      }
      return;
    }
    const world = this.node.worldMatrix;
    mat4.fromQuat(this.matrix, this.node.worldRotation);
    for (let axis = 0; axis < 3; axis++) {
      const offset = axis * 4;
      this.scale[axis] =
        this.matrix[offset]! * world[offset]! +
        this.matrix[offset + 1]! * world[offset + 1]! +
        this.matrix[offset + 2]! * world[offset + 2]!;
    }
    if (this.space === Space.Local) {
      mat4.identity(this.matrix);
      if (
        this.scaling !== ScalingMode.Hierarchy &&
        (!this.sprite || this.scaling === ScalingMode.Shape)
      )
        mat4.fromScaling(this.matrix, this.scale);
    } else if (this.scaling === ScalingMode.Hierarchy) mat4.copy(this.matrix, world);
    else {
      if (this.sprite && this.scaling === ScalingMode.Local) vec3.set(this.scale, 1, 1, 1);
      mat4.fromRotationTranslationScale(
        this.matrix,
        this.node.worldRotation,
        [world[12]!, world[13]!, world[14]!],
        this.scale,
      );
    }
  }
  transform(out: Float64Array): void {
    const m = this.matrix,
      x = out[0]!,
      y = out[1]!,
      z = out[2]!,
      dx = out[3]!,
      dy = out[4]!,
      dz = out[5]!;
    out[0] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    out[1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    out[2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
    out[3] = m[0]! * dx + m[4]! * dy + m[8]! * dz;
    out[4] = m[1]! * dx + m[5]! * dy + m[9]! * dz;
    out[5] = m[2]! * dx + m[6]! * dy + m[10]! * dz;
    if (this.scaling !== ScalingMode.Hierarchy) {
      const length = Math.hypot(out[3]!, out[4]!, out[5]!);
      if (length > 0) for (let i = 3; i < 6; i++) out[i] = out[i]! / length;
      else for (let i = 0; i < 3; i++) out[i + 3] = this.fallbackDirection[i]!;
    }
  }
}

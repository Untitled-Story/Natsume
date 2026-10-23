import { mat4, vec3, vec4 } from 'gl-matrix';
import { check } from '../errors.js';
import type { DeepReadonly as R } from '../pack.js';
import type { CanvasT } from '../format/generated/noa/ir/canvas.js';
import type { CanvasEnvironment } from './canvas-environment.js';
import { SupportChecks, type SupportIssue } from '../runtime/support-checks.js';

export function canvasEnvironmentSupport(
  canvas: R<CanvasT>,
  environment?: CanvasEnvironment,
): readonly SupportIssue[] {
  const r = new SupportChecks();
  if (canvas.mode === 2) return r.issues;
  r.require(
    environment?.displays[canvas.targetDisplay],
    'HOST',
    `canvasEnvironment.displays.${canvas.targetDisplay}`,
    canvas.targetDisplay,
    'Screen Canvas requires a host display size',
  );
  if (canvas.mode === 1)
    r.require(
      environment?.mainCamera,
      'HOST',
      'canvasEnvironment.mainCamera',
      undefined,
      'ScreenCamera requires host view and projection matrices',
    );
  return r.issues;
}
export interface CanvasLayout {
  readonly width: number;
  readonly height: number;
  readonly world: mat4;
  readonly display: mat4;
  readonly viewport: readonly number[];
}
/** Root screen canvases are driven by display pixels and the host projection. */
export function canvasLayout(canvas: R<CanvasT>, environment: CanvasEnvironment): CanvasLayout {
  const display = environment.displays[canvas.targetDisplay]!;
  const world = mat4.create(),
    matrix = mat4.create();
  if (canvas.mode === 0) {
    world[12] = display.width * 0.5;
    world[13] = display.height * 0.5;
    matrix[5] = -1;
    matrix[13] = display.height;
    matrix[10] = 0;
    return {
      width: display.width,
      height: display.height,
      world,
      display: matrix,
      viewport: [0, 0, display.width, display.height],
    };
  }
  const camera = environment.mainCamera!,
    v = camera.viewport ?? { x: 0, y: 0, width: 1, height: 1 };
  const width = display.width * v.width,
    height = display.height * v.height;
  const inverseView = mat4.invert(mat4.create(), camera.viewMatrix as mat4),
    inverseProjection = mat4.invert(mat4.create(), camera.projectionMatrix as mat4);
  check(inverseView && inverseProjection, 'HOST', 'Canvas observation matrices must be invertible');
  const point = (x: number, y: number) => {
    const a = vec4.transformMat4(vec4.create(), [x, y, -1, 1], inverseProjection);
    const b = vec4.transformMat4(vec4.create(), [x, y, 1, 1], inverseProjection);
    for (let i = 0; i < 3; i++) {
      a[i] = a[i]! / a[3]!;
      b[i] = b[i]! / b[3]!;
    }
    const dz = b[2]! - a[2]!;
    check(Math.abs(dz) > 1e-12, 'HOST', 'Canvas projection rays must cross the view plane');
    const t = (-canvas.planeDistance - a[2]!) / dz;
    return vec3.transformMat4(
      vec3.create(),
      [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, -canvas.planeDistance],
      inverseView,
    );
  };
  const center = point(0, 0),
    right = point(2 / width, 0),
    up = point(0, 2 / height);
  for (let i = 0; i < 3; i++) {
    world[i] = right[i]! - center[i]!;
    world[4 + i] = up[i]! - center[i]!;
    world[12 + i] = center[i]!;
  }
  const scale = Math.hypot(world[4]!, world[5]!, world[6]!);
  for (let i = 0; i < 3; i++) world[8 + i] = -inverseView[8 + i]! * scale;
  const pixels = mat4.fromValues(
    width * 0.5,
    0,
    0,
    0,
    0,
    -height * 0.5,
    0,
    0,
    0,
    0,
    1,
    0,
    display.width * v.x + width * 0.5,
    display.height * (1 - v.y) - height * 0.5,
    0,
    1,
  );
  mat4.multiply(matrix, camera.projectionMatrix as mat4, camera.viewMatrix as mat4);
  mat4.multiply(matrix, pixels, matrix);
  return {
    width,
    height,
    world,
    display: matrix,
    viewport: [
      display.width * v.x,
      display.height * (1 - v.y - v.height),
      display.width * (v.x + v.width),
      display.height * (1 - v.y),
    ],
  };
}

import { mat4 } from 'gl-matrix';
import { check } from '../errors.js';
import type { CameraT } from '../format/generated/noa/ir/camera.js';
import type { DeepReadonly as R } from '../pack.js';
import type { SceneNode } from '../runtime/scene.js';
import type { ParticleEnvironment } from './particle-environment.js';

/** Host display area for package-authored cameras, in Pixi logical pixels. */
export interface CameraEnvironment {
  readonly targetDisplay: number;
  readonly width: number;
  readonly height: number;
  /** Package Camera component ID used by features that require a main camera. */
  readonly mainCameraId?: number;
}

export function copyCameraEnvironment(value?: CameraEnvironment): CameraEnvironment | undefined {
  if (value === undefined) return undefined;
  check(
    value &&
      Number.isInteger(value.targetDisplay) &&
      value.targetDisplay >= 0 &&
      Number.isFinite(value.width) &&
      value.width > 0 &&
      Number.isFinite(value.height) &&
      value.height > 0 &&
      (value.mainCameraId === undefined ||
        (Number.isSafeInteger(value.mainCameraId) && value.mainCameraId > 0)),
    'HOST',
    'Invalid cameraEnvironment',
  );
  return Object.freeze({ ...value });
}

/** Source projection; Unity's FOV axis flag changes Inspector editing, not stored vertical FOV. */
export function cameraProjection(c: R<CameraT>, viewportAspect: number, out = mat4.create()): mat4 {
  if (c.projection === 2) return mat4.copy(out, c.customProjection!.values as mat4);
  const aspect = c.aspectMode === 1 ? c.aspect : viewportAspect;
  const near = Math.max(1e-5, c.nearPlane),
    far = Math.max(near + 1e-5, c.farPlane);
  if (c.projection === 1) {
    const h = Math.max(1e-5, c.orthoHalfHeight);
    return mat4.orthoNO(out, -h * aspect, h * aspect, -h, h, near, far);
  }
  let h = Math.tan(Math.max(Math.PI / 180, Math.min((179 * Math.PI) / 180, c.fovRadians)) * 0.5),
    w = h * aspect;
  let shiftX = 0,
    shiftY = 0;
  if (c.physical) {
    const sx = c.sensorSizeMm!.x / (2 * c.focalLengthMm),
      sy = c.sensorSizeMm!.y / (2 * c.focalLengthMm);
    h = sy;
    w = sx;
    if (c.gateFit === 1) {
      w = h * aspect;
    } else if (c.gateFit === 2) {
      h = w / aspect;
    } else if (c.gateFit === 3) {
      h = Math.min(sy, sx / aspect);
      w = h * aspect;
    } else if (c.gateFit === 4) {
      h = Math.max(sy, sx / aspect);
      w = h * aspect;
    }
    shiftX = (2 * (c.lensShift?.x ?? 0) * sx) / w;
    shiftY = (2 * (c.lensShift?.y ?? 0) * sy) / h;
  }
  mat4.frustum(out, -w * near, w * near, -h * near, h * near, near, far);
  out[8] = shiftX;
  out[9] = shiftY;
  return out;
}

/** Per-pass matrices act on source geometry; camera transform scale is ignored. */
export class AuthoredCamera {
  readonly view = mat4.create();
  readonly projection = mat4.create();
  readonly display = mat4.create();
  readonly viewport = [0, 0, 0, 0];
  readonly position = { x: 0, y: 0, z: 0 };
  private readonly pixels = mat4.create();
  private readonly viewPosition: [number, number, number] = [0, 0, 0];
  private readonly viewVelocity: [number, number, number] = [0, 0, 0];
  private readonly depth: [number, number, number, number] = [0, 0, 0, 0];
  private previousTime = NaN;
  private base: ParticleEnvironment | undefined;
  private environment: ParticleEnvironment | undefined;
  constructor(
    readonly id: number,
    readonly node: SceneNode,
    readonly definition: R<CameraT>,
  ) {}
  particleEnvironment(base: ParticleEnvironment | undefined): ParticleEnvironment {
    if (!this.environment || this.base !== base) {
      this.base = base;
      this.environment = {
        ...(base ?? { fog: { mode: 'none' } }),
        viewPosition: this.viewPosition,
        viewVelocity: this.viewVelocity,
        depth: this.depth,
      };
    }
    return this.environment;
  }
  sync(environment: CameraEnvironment, time = 0): void {
    const c = this.definition,
      v = c.viewport!,
      e = environment;
    const width = e.width * v.z,
      height = e.height * v.w;
    const x = e.width * v.x,
      y = e.height * (1 - v.y - v.w);
    this.viewport[0] = x;
    this.viewport[1] = y;
    this.viewport[2] = x + width;
    this.viewport[3] = y + height;
    const world = this.node.worldMatrix;
    const dt = time - this.previousTime;
    for (let i = 0; i < 3; i++) {
      this.viewVelocity[i] = dt > 0 ? (world[12 + i]! - this.viewPosition[i]!) / dt : 0;
      this.viewPosition[i] = world[12 + i]!;
    }
    this.previousTime = time;
    this.position.x = world[12]!;
    this.position.y = world[13]!;
    this.position.z = world[14]!;
    mat4.fromRotationTranslation(this.view, this.node.worldRotation, [
      world[12]!,
      world[13]!,
      world[14]!,
    ]);
    mat4.invert(this.view, this.view);
    for (let column = 0; column < 4; column++)
      this.view[column * 4 + 2] = -this.view[column * 4 + 2]!;
    for (let i = 0; i < 4; i++) this.depth[i] = -this.view[i * 4 + 2]!;
    cameraProjection(c, width > 0 && height > 0 ? width / height : 1, this.projection);
    mat4.identity(this.pixels);
    this.pixels[0] = width * 0.5;
    this.pixels[5] = -height * 0.5;
    this.pixels[12] = x + width * 0.5;
    this.pixels[13] = y + height * 0.5;
    mat4.multiply(this.display, this.projection, this.view);
    mat4.multiply(this.display, this.pixels, this.display);
  }
}

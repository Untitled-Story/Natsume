import { mat4 } from 'gl-matrix';
import { check } from '../errors.js';

/** Display size in Pixi logical pixels, before device pixel ratio. */
export interface CanvasDisplay {
  readonly width: number;
  readonly height: number;
}

/** Host observation used by Screen Space - Camera canvases. */
export interface CanvasView {
  /** Column-major world-to-view transform in Unity world units. */
  readonly viewMatrix: ArrayLike<number>;
  /** Column-major projection with WebGL clip depth [-1, 1]. */
  readonly projectionMatrix: ArrayLike<number>;
  /** Normalized viewport, bottom-left origin; omitted means the entire display. */
  readonly viewport?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/** Explicit host display and projection inputs. No camera object is retained. */
export interface CanvasEnvironment {
  readonly displays: Readonly<Record<number, CanvasDisplay>>;
  readonly mainCamera?: CanvasView;
}

export function copyCanvasEnvironment(value?: CanvasEnvironment): CanvasEnvironment | undefined {
  if (value === undefined) return undefined;
  check(
    value && typeof value === 'object' && value.displays && typeof value.displays === 'object',
    'HOST',
    'Invalid canvasEnvironment',
  );
  const displays: Record<number, CanvasDisplay> = {};
  for (const [key, display] of Object.entries(value.displays)) {
    check(
      /^\d+$/.test(key) && Number.isSafeInteger(Number(key)),
      'HOST',
      'Display index must be a nonnegative integer',
    );
    check(
      display &&
        Number.isFinite(display.width) &&
        Number.isFinite(display.height) &&
        display.width > 0 &&
        display.height > 0,
      'HOST',
      'Canvas display dimensions must be positive and finite',
    );
    displays[Number(key)] = Object.freeze({ width: display.width, height: display.height });
  }
  let mainCamera: CanvasView | undefined;
  if (value.mainCamera !== undefined) {
    const view = value.mainCamera;
    check(view && typeof view === 'object', 'HOST', 'Invalid Canvas view');
    for (const matrix of [view.viewMatrix, view.projectionMatrix])
      check(
        matrix?.length === 16 && Array.from(matrix).every(Number.isFinite),
        'HOST',
        'Canvas view and projection require 16 finite values',
      );
    check(
      mat4.determinant(view.viewMatrix as mat4) !== 0 &&
        mat4.determinant(view.projectionMatrix as mat4) !== 0,
      'HOST',
      'Canvas view and projection must be invertible',
    );
    check(
      view.viewMatrix[3] === 0 &&
        view.viewMatrix[7] === 0 &&
        view.viewMatrix[11] === 0 &&
        view.viewMatrix[15] === 1,
      'HOST',
      'Canvas view matrix must be affine',
    );
    const v = view.viewport;
    check(
      !v ||
        ([v.x, v.y, v.width, v.height].every(Number.isFinite) &&
          v.x >= 0 &&
          v.y >= 0 &&
          v.width > 0 &&
          v.height > 0 &&
          v.x + v.width <= 1 &&
          v.y + v.height <= 1),
      'HOST',
      'Canvas viewport must lie within the normalized display',
    );
    mainCamera = Object.freeze({
      viewMatrix: Object.freeze(Array.from(view.viewMatrix)),
      projectionMatrix: Object.freeze(Array.from(view.projectionMatrix)),
      ...(v ? { viewport: Object.freeze({ ...v }) } : {}),
    });
  }
  return Object.freeze({
    displays: Object.freeze(displays),
    ...(mainCamera ? { mainCamera } : {}),
  });
}

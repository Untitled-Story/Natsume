import { mat4, vec3 } from 'gl-matrix';
export interface GraphicRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
/** Snaps local edge midpoints in root-Canvas pixels, preserving fractional transform offsets. */
export function pixelAdjustedRect(
  width: number,
  height: number,
  pivot: Readonly<{ x: number; y: number }>,
  relative: ArrayLike<number>,
): GraphicRect {
  const inverse = mat4.invert(mat4.create(), relative as mat4);
  const x = -pivot.x * width,
    y = -pivot.y * height;
  if (!inverse) return { x, y, width, height };
  const corner = (x: number, y: number) => {
    const p = vec3.transformMat4(vec3.create(), [x, y, 0], relative as mat4);
    p[0] = Math.round(p[0]!);
    p[1] = Math.round(p[1]!);
    return vec3.transformMat4(p, p, inverse);
  };
  const left = corner(x, y + height * 0.5),
    right = corner(x + width, y + height * 0.5),
    bottom = corner(x + width * 0.5, y),
    top = corner(x + width * 0.5, y + height);
  return { x: left[0]!, y: bottom[1]!, width: right[0]! - left[0]!, height: top[1]! - bottom[1]! };
}

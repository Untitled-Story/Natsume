import { meshUV } from '../format/mesh-attributes.js';
import type { GraphicRect } from './pixel-adjustment.js';
import { SpriteRendererT } from '../format/generated/noa/ir/sprite-renderer.js';
import { Vec2T } from '../format/generated/noa/ir/vec2.js';
import { MeshT } from '../format/generated/noa/mesh/mesh.js';
import { Vec3T } from '../format/generated/noa/mesh/vec3.js';
import { Vec4T } from '../format/generated/noa/mesh/vec4.js';
import { SubmeshT } from '../format/generated/noa/mesh/submesh.js';
import { TexCoordT } from '../format/generated/noa/mesh/tex-coord.js';
import type { UIImageT } from '../format/generated/noa/ir/uiimage.js';
import type { SpriteAssetT } from '../format/generated/noa/ir/sprite-asset.js';
import type { EffectPack, DeepReadonly as R } from '../pack.js';
import { spriteGeometry, spriteUVTransform } from './sprite-geometry.js';

type Point = readonly [number, number];
/** Builds static Graphic triangles in RectTransform-local Unity coordinates. */
export function imageGeometry(
  pack: EffectPack,
  image: R<UIImageT>,
  width: number,
  height: number,
  pivot: Readonly<{ x: number; y: number }>,
  adjustedRect?: GraphicRect,
): MeshT {
  const id = image.overrideSpriteAssetId || image.spriteAssetId;
  const sprite = pack.document.assets.find((a) => a.id === id)?.sprite;
  const mesh = new MeshT();
  if (width <= 0 || height <= 0) {
    mesh.submeshes = [new SubmeshT(0, 0)];
    return mesh;
  }
  const positions: Vec3T[] = mesh.positions,
    coords: Vec4T[] = [];
  let w = adjustedRect?.width ?? width,
    h = adjustedRect?.height ?? height;
  if (sprite && image.preserveAspect && (image.type === 0 || image.type === 3)) {
    const ratio = sprite.rect!.z / sprite.rect!.w;
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
  }
  let left = adjustedRect ? adjustedRect.x + (adjustedRect.width - w) * pivot.x : -pivot.x * w,
    bottom = adjustedRect ? adjustedRect.y + (adjustedRect.height - h) * pivot.y : -pivot.y * h;
  let unitLeft = 0,
    unitBottom = 0,
    unitWidth = 1,
    unitHeight = 1;
  if (
    sprite &&
    !(image.type === 0 && image.useSpriteMesh) &&
    (image.type === 0 ||
      image.type === 3 ||
      (image.type === 1 && !Object.values(sprite.border!).some(Boolean)))
  ) {
    const rect = sprite.rect!,
      trim = sprite.textureRect,
      offset = sprite.textureRectOffset;
    if (trim && offset) {
      const rotation = (sprite.packingFlags >> 2) & 15;
      const tw = rotation === 4 ? trim.w : trim.z,
        th = rotation === 4 ? trim.z : trim.w;
      const scale = sprite.downscaleMultiplier;
      unitLeft = offset.x / rect.z;
      unitBottom = offset.y / rect.w;
      unitWidth = tw / scale / rect.z;
      unitHeight = th / scale / rect.w;
      left += w * unitLeft;
      bottom += h * unitBottom;
      w *= unitWidth;
      h *= unitHeight;
    }
  }
  const mapping = sprite ? spriteUVTransform(pack, sprite) : [1, 0, 0, 0, 1, 0];
  const vertex = (u: number, v: number) => {
    positions.push(new Vec3T(left + u * w, bottom + v * h, 0));
    coords.push(
      new Vec4T(
        mapping[0]! * (unitLeft + u * unitWidth) +
          mapping[1]! * (unitBottom + v * unitHeight) +
          mapping[2]!,
        mapping[3]! * (unitLeft + u * unitWidth) +
          mapping[4]! * (unitBottom + v * unitHeight) +
          mapping[5]!,
        0,
        0,
      ),
    );
  };
  const polygon = (points: readonly Point[]) => {
    if (points.length < 3) return;
    const start = positions.length;
    points.forEach((p) => vertex(p[0], p[1]));
    for (let i = 1; i + 1 < points.length; i++) mesh.indices.push(start, start + i, start + i + 1);
  };
  if (sprite && image.type === 1 && Object.values(sprite.border!).some(Boolean)) {
    const b = sprite.border!,
      rect = sprite.rect!,
      trim = sprite.textureRect,
      offset = sprite.textureRectOffset;
    const ppu = (sprite.pixelsPerUnit / 100) * image.pixelsPerUnitMultiplier;
    const rotated = ((sprite.packingFlags >> 2) & 15) === 4;
    const pad = [
      offset?.x ?? 0,
      offset?.y ?? 0,
      trim
        ? rect.z - (offset?.x ?? 0) - (rotated ? trim.w : trim.z) / sprite.downscaleMultiplier
        : 0,
      trim
        ? rect.w - (offset?.y ?? 0) - (rotated ? trim.z : trim.w) / sprite.downscaleMultiplier
        : 0,
    ];
    const fx = Math.min(1, w / ((b.x + b.z) / ppu || 1));
    const fy = Math.min(1, h / ((b.y + b.w) / ppu || 1));
    const xs = [pad[0]! / ppu, (b.x / ppu) * fx, w - (b.z / ppu) * fx, w - pad[2]! / ppu];
    const ys = [pad[1]! / ppu, (b.y / ppu) * fy, h - (b.w / ppu) * fy, h - pad[3]! / ppu];
    const us = [pad[0]! / rect.z, b.x / rect.z, 1 - b.z / rect.z, 1 - pad[2]! / rect.z];
    const vs = [pad[1]! / rect.w, b.y / rect.w, 1 - b.w / rect.w, 1 - pad[3]! / rect.w];
    for (let x = 0; x < 3; x++)
      for (let y = 0; y < 3; y++) {
        if (!image.fillCenter && x === 1 && y === 1) continue;
        const start = positions.length;
        for (const [i, j] of [
          [x, y],
          [x, y + 1],
          [x + 1, y + 1],
          [x + 1, y],
        ]) {
          positions.push(new Vec3T(left + xs[i!]!, bottom + ys[j!]!, 0));
          coords.push(
            new Vec4T(
              mapping[0]! * us[i!]! + mapping[1]! * vs[j!]! + mapping[2]!,
              mapping[3]! * us[i!]! + mapping[4]! * vs[j!]! + mapping[5]!,
              0,
              0,
            ),
          );
        }
        mesh.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
      }
  } else if (
    sprite &&
    (image.type === 1 || image.type === 2) &&
    (sprite.border!.x ||
      sprite.border!.y ||
      sprite.border!.z ||
      sprite.border!.w ||
      image.type === 2)
  ) {
    // UI graphics use the Canvas default reference density of 100 pixels per unit.
    const adjusted = {
      ...sprite,
      pixelsPerUnit: (sprite.pixelsPerUnit / 100) * image.pixelsPerUnitMultiplier,
    } as R<SpriteAssetT>;
    const renderer = new SpriteRendererT();
    renderer.drawMode = image.type === 1 ? 1 : 2;
    renderer.size = new Vec2T(w, h);
    const b = sprite.border!,
      ppu = adjusted.pixelsPerUnit;
    const centerW = Math.max(0, w - (b.x + b.z) / ppu),
      centerH = Math.max(0, h - (b.y + b.w) / ppu);
    const tileW = Math.max(0, (sprite.rect!.z - b.x - b.z) / ppu),
      tileH = Math.max(0, (sprite.rect!.w - b.y - b.w) / ppu);
    const columns = tileW > 0 ? Math.ceil(centerW / tileW) : 1,
      rows = tileH > 0 ? Math.ceil(centerH / tileH) : 1;
    let cappedColumns: number | undefined, cappedRows: number | undefined;
    // Native UI's 16-bit mesh budget includes the two border bands on each axis.
    if (image.type === 2) {
      const ratio = (rows + 2) / (columns + 2);
      if (image.fillCenter && (columns + 2) * (rows + 2) > 16250) {
        cappedColumns = Math.min(5414, Math.max(1, Math.floor(Math.sqrt(16250 * ratio)) - 2));
        cappedRows = Math.min(
          Math.floor(16250 / (cappedColumns + 2)) - 2,
          Math.max(1, Math.floor(Math.sqrt(16250 / ratio)) - 2),
        );
      } else if (!image.fillCenter && 2 * columns + 2 * rows + 4 > 16250) {
        cappedColumns = Math.max(1, Math.floor(16246 / (2 * (1 + 1 / ratio))));
        cappedRows = Math.max(1, Math.floor(16246 / (2 * (1 + ratio))));
      }
    }
    const generated = spriteGeometry(
      pack,
      adjusted,
      renderer,
      adjusted.pixelsPerUnit / sprite.pixelsPerUnit,
      {
        fillCenter: image.fillCenter,
        ...(sprite.textureRect && sprite.textureRectOffset
          ? {
              padding: [
                sprite.textureRectOffset.x,
                sprite.textureRectOffset.y,
                sprite.rect!.z -
                  sprite.textureRectOffset.x -
                  (((sprite.packingFlags >> 2) & 15) === 4
                    ? sprite.textureRect.w
                    : sprite.textureRect.z) /
                    sprite.downscaleMultiplier,
                sprite.rect!.w -
                  sprite.textureRectOffset.y -
                  (((sprite.packingFlags >> 2) & 15) === 4
                    ? sprite.textureRect.z
                    : sprite.textureRect.w) /
                    sprite.downscaleMultiplier,
              ],
            }
          : {}),
        ...(cappedColumns ? { columns: cappedColumns } : {}),
        ...(cappedRows ? { rows: cappedRows } : {}),
      },
    );
    const bx = sprite.border!,
      scale = Math.min(1, w / ((bx.x + bx.z) / adjusted.pixelsPerUnit || 1)),
      sy = Math.min(1, h / ((bx.y + bx.w) / adjusted.pixelsPerUnit || 1));
    const centerLeft = left + (bx.x / adjusted.pixelsPerUnit) * scale,
      centerRight = left + w - (bx.z / adjusted.pixelsPerUnit) * scale;
    const centerBottom = bottom + (bx.y / adjusted.pixelsPerUnit) * sy,
      centerTop = bottom + h - (bx.w / adjusted.pixelsPerUnit) * sy;
    const uv = generated.texcoords[0]!.values;
    for (let i = 0; i < generated.positions.length; i += 4) {
      const points = generated.positions
        .slice(i, i + 4)
        .map(
          (p) => [p.x + sprite.pivot!.x * w + left, p.y + sprite.pivot!.y * h + bottom] as const,
        );
      const cx = (points[0]![0] + points[2]![0]) * 0.5,
        cy = (points[0]![1] + points[2]![1]) * 0.5;
      if (
        !image.fillCenter &&
        cx >= centerLeft &&
        cx <= centerRight &&
        cy >= centerBottom &&
        cy <= centerTop
      )
        continue;
      const start = positions.length;
      points.forEach((p, j) => {
        positions.push(new Vec3T(p[0], p[1], 0));
        coords.push(new Vec4T(uv[i + j]!.x, uv[i + j]!.y, 0, 0));
      });
      mesh.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  } else if (sprite && image.type === 0 && image.useSpriteMesh) {
    const source = pack.getMesh(sprite.meshAssetId)!;
    const sourceUV = meshUV(source);
    source.positions.forEach((p, i) => {
      const x = (p.x * sprite.pixelsPerUnit) / sprite.rect!.z,
        y = (p.y * sprite.pixelsPerUnit) / sprite.rect!.w;
      positions.push(
        new Vec3T((x + sprite.pivot!.x - pivot.x) * w, (y + sprite.pivot!.y - pivot.y) * h, 0),
      );
      coords.push(new Vec4T(sourceUV[i]?.x ?? 0, sourceUV[i]?.y ?? 0, 0, 0));
    });
    mesh.indices.push(...source.indices);
  } else if (image.type !== 3 || image.fillAmount >= 1 || !sprite) {
    polygon([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
  } else if (image.fillAmount >= 0.001) {
    const amount = Math.min(1, image.fillAmount),
      origin = image.fillOrigin;
    if (image.fillMethod === 0)
      polygon(
        image.fillOrigin === 1
          ? [
              [1 - amount, 0],
              [1, 0],
              [1, 1],
              [1 - amount, 1],
            ]
          : [
              [0, 0],
              [amount, 0],
              [amount, 1],
              [0, 1],
            ],
      );
    else if (image.fillMethod === 1)
      polygon(
        image.fillOrigin === 1
          ? [
              [0, 1 - amount],
              [1, 1 - amount],
              [1, 1],
              [0, 1],
            ]
          : [
              [0, 0],
              [1, 0],
              [1, amount],
              [0, amount],
            ],
      );
    else {
      const clockwise = image.fillClockwise,
        direction = clockwise ? -1 : 1;
      let center: Point, start: number, angle: number;
      if (image.fillMethod === 2) {
        center = (
          [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
          ] as const
        )[origin]!;
        start = (clockwise ? Math.PI / 2 : 0) - (origin * Math.PI) / 2;
        angle = (Math.PI / 2) * amount;
      } else if (image.fillMethod === 3) {
        center = (
          [
            [0.5, 0],
            [0, 0.5],
            [0.5, 1],
            [1, 0.5],
          ] as const
        )[origin]!;
        start = (clockwise ? Math.PI : 0) - (origin * Math.PI) / 2;
        angle = Math.PI * amount;
      } else {
        center = [0.5, 0.5];
        start = -Math.PI / 2 + (origin * Math.PI) / 2;
        angle = Math.PI * 2 * amount;
      }
      const axisX = image.fillMethod === 3 && origin % 2 === 0 ? 0.5 : 1;
      const axisY = image.fillMethod === 3 && origin % 2 === 1 ? 0.5 : 1;
      const boundary = (a: number): Point => {
        const dx = Math.cos(a) * axisX,
          dy = Math.sin(a) * axisY,
          t = Math.min(
            dx > 1e-9 ? (1 - center[0]) / dx : dx < -1e-9 ? -center[0] / dx : Infinity,
            dy > 1e-9 ? (1 - center[1]) / dy : dy < -1e-9 ? -center[1] / dy : Infinity,
          );
        return [center[0] + dx * t, center[1] + dy * t];
      };
      const corners: Point[] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      const swept = corners
        .filter((p) => p[0] !== center[0] || p[1] !== center[1])
        .map((p) => ({
          p,
          phase:
            ((Math.atan2((p[1] - center[1]) / axisY, (p[0] - center[0]) / axisX) - start) *
              direction +
              Math.PI * 4) %
            (Math.PI * 2),
        }))
        .filter((p) => p.phase > 1e-9 && p.phase < angle - 1e-9)
        .sort((a, b) => a.phase - b.phase);
      polygon([
        center,
        boundary(start),
        ...swept.map((v) => v.p),
        boundary(start + direction * angle),
      ]);
    }
  }
  mesh.texcoords = [new TexCoordT(0, 2, coords)];
  mesh.submeshes = [new SubmeshT(0, mesh.indices.length)];
  return mesh;
}

import type { EffectPack, DeepReadonly as R } from '../pack.js';
import { check } from '../errors.js';
import type { SpriteAssetT } from '../format/generated/noa/ir/sprite-asset.js';
import type { SpriteRendererT } from '../format/generated/noa/ir/sprite-renderer.js';
import { MeshT } from '../format/generated/noa/mesh/mesh.js';
import { Vec3T } from '../format/generated/noa/mesh/vec3.js';
import { Vec4T } from '../format/generated/noa/mesh/vec4.js';
import { TexCoordT } from '../format/generated/noa/mesh/tex-coord.js';
import { SubmeshT } from '../format/generated/noa/mesh/submesh.js';
import { meshUV } from '../format/mesh-attributes.js';

/** Preserves source triangles for Simple and derives sliced/tiled UVs from source geometry. */
export function spriteGeometry(
  pack: EffectPack,
  sprite: R<SpriteAssetT>,
  renderer: R<
    Pick<
      SpriteRendererT,
      'drawMode' | 'size' | 'tileMode' | 'adaptiveModeThreshold' | 'flipX' | 'flipY'
    >
  >,
  uvPositionScale = 1,
  tiling?: {
    readonly fillCenter: boolean;
    readonly columns?: number;
    readonly rows?: number;
    readonly padding?: readonly number[];
  },
): MeshT {
  const source = pack.getMesh(sprite.meshAssetId);
  check(source, 'SEMANTIC', 'Missing Sprite mesh');
  const mesh = new MeshT();
  if (renderer.drawMode === 0) {
    Object.assign(mesh, source);
    mesh.positions = source.positions.map(
      (p) => new Vec3T(renderer.flipX ? -p.x : p.x, renderer.flipY ? -p.y : p.y, p.z),
    );
    return mesh;
  }
  const uv = meshUV(source),
    rect = sprite.rect!,
    pivot = sprite.pivot!,
    border = sprite.border!;
  const ppu = sprite.pixelsPerUnit,
    w = rect.z / ppu,
    h = rect.w / ppu;
  const targetW = Math.max(0, renderer.size!.x),
    targetH = Math.max(0, renderer.size!.y);
  // Solve the source affine UV mapping once, including atlas packing rotation.
  let mapping: number[] | undefined;
  for (let i = 0; i < source.indices.length; i += 3) {
    const a = source.indices[i]!,
      b = source.indices[i + 1]!,
      c = source.indices[i + 2]!;
    const p = source.positions[a]!,
      q = source.positions[b]!,
      r = source.positions[c]!;
    const det = (q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y);
    if (Math.abs(det) < 1e-12 || !uv[a] || !uv[b] || !uv[c]) continue;
    mapping = [];
    for (const key of ['x', 'y'] as const) {
      const u = uv[a]![key],
        v = uv[b]![key] - u,
        t = uv[c]![key] - u;
      const x = (v * (r.y - p.y) - t * (q.y - p.y)) / det,
        y = ((q.x - p.x) * t - (r.x - p.x) * v) / det;
      mapping.push(x, y, u - x * p.x - y * p.y);
    }
    break;
  }
  check(mapping, 'CAPABILITY', 'Sliced or tiled Sprite requires a nondegenerate source UV mapping');
  const ranges = (size: number, original: number, lo: number, hi: number) => {
    const factor = Math.min(1, size / (lo + hi || 1));
    return {
      target: [0, lo * factor, size - hi * factor, size],
      source: [0, lo, original - hi, original],
    };
  };
  const xs = ranges(targetW, w, border.x / ppu, border.z / ppu),
    ys = ranges(targetH, h, border.y / ppu, border.w / ppu);
  if (tiling?.padding) {
    xs.source[0] = tiling.padding[0]! / ppu;
    ys.source[0] = tiling.padding[1]! / ppu;
    xs.source[3] = w - tiling.padding[2]! / ppu;
    ys.source[3] = h - tiling.padding[3]! / ppu;
  }
  const texcoords: Vec4T[] = [];
  const append = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    sx0: number,
    sy0: number,
    sx1: number,
    sy1: number,
  ) => {
    if (x1 <= x0 || y1 <= y0) return;
    check(
      mesh.positions.length + 4 <= 1_000_000,
      'LIMIT',
      'Sprite tiled geometry exceeds vertex budget',
    );
    const offset = mesh.positions.length;
    for (const [x, y, sx, sy] of [
      [x0, y0, sx0, sy0],
      [x1, y0, sx1, sy0],
      [x1, y1, sx1, sy1],
      [x0, y1, sx0, sy1],
    ]) {
      const px = x! - pivot.x * targetW,
        py = y! - pivot.y * targetH;
      mesh.positions.push(new Vec3T(renderer.flipX ? -px : px, renderer.flipY ? -py : py, 0));
      const ux = (sx! - pivot.x * w) * uvPositionScale,
        uy = (sy! - pivot.y * h) * uvPositionScale;
      texcoords.push(
        new Vec4T(
          mapping![0]! * ux + mapping![1]! * uy + mapping![2]!,
          mapping![3]! * ux + mapping![4]! * uy + mapping![5]!,
          0,
          0,
        ),
      );
    }
    mesh.indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  };
  const segments = (
    lo: number,
    hi: number,
    slo: number,
    shi: number,
    tile: boolean,
    originalSize: number,
    targetSize: number,
    forcedCount?: number,
  ) => {
    const length = hi - lo,
      source = shi - slo;
    if (!tile || source <= 0 || length <= 0) return [[lo, hi, slo, shi]];
    let count = length / source;
    const adaptive = renderer.tileMode === 1;
    if (adaptive)
      count = Math.max(1, Math.ceil(targetSize / originalSize - renderer.adaptiveModeThreshold));
    const step = forcedCount ? length / forcedCount : adaptive ? length / count : source,
      result: number[][] = [];
    check(
      Math.ceil(length / step - 1e-10) <= 250_000,
      'LIMIT',
      'Sprite tile count exceeds geometry budget',
    );
    for (let i = 0; i < Math.ceil(length / step - 1e-10); i++) {
      const end = Math.min(hi, lo + (i + 1) * step);
      result.push([lo + i * step, end, slo, slo + (source * (end - lo - i * step)) / step]);
    }
    return result;
  };
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++) {
      if (x === 1 && y === 1 && tiling?.fillCenter === false) continue;
      const xr = segments(
        xs.target[x]!,
        xs.target[x + 1]!,
        xs.source[x]!,
        xs.source[x + 1]!,
        renderer.drawMode === 2 && x === 1,
        w,
        targetW,
        tiling?.columns,
      );
      const yr = segments(
        ys.target[y]!,
        ys.target[y + 1]!,
        ys.source[y]!,
        ys.source[y + 1]!,
        renderer.drawMode === 2 && y === 1,
        h,
        targetH,
        tiling?.rows,
      );
      check(
        xr.length * yr.length * 4 + mesh.positions.length <= 1_000_000,
        'LIMIT',
        'Sprite tiled geometry exceeds vertex budget',
      );
      for (const [x0, x1, sx0, sx1] of xr)
        for (const [y0, y1, sy0, sy1] of yr) append(x0!, y0!, x1!, y1!, sx0!, sy0!, sx1!, sy1!);
    }
  mesh.texcoords = [new TexCoordT(0, 2, texcoords)];
  mesh.submeshes = [new SubmeshT(0, mesh.indices.length)];
  return mesh;
}

/** Maps unit-rectangle coordinates into authored atlas UVs, including rotation. */
export function spriteUVTransform(pack: EffectPack, sprite: R<SpriteAssetT>): readonly number[] {
  const source = pack.getMesh(sprite.meshAssetId)!;
  const uv = meshUV(source),
    rect = sprite.rect!,
    pivot = sprite.pivot!,
    ppu = sprite.pixelsPerUnit;
  for (let i = 0; i < source.indices.length; i += 3) {
    const a = source.indices[i]!,
      b = source.indices[i + 1]!,
      c = source.indices[i + 2]!;
    const p = source.positions[a]!,
      q = source.positions[b]!,
      r = source.positions[c]!;
    const det = (q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y);
    if (Math.abs(det) < 1e-12 || !uv[a] || !uv[b] || !uv[c]) continue;
    const result: number[] = [];
    for (const key of ['x', 'y'] as const) {
      const u = uv[a]![key],
        v = uv[b]![key] - u,
        t = uv[c]![key] - u;
      const x = (v * (r.y - p.y) - t * (q.y - p.y)) / det,
        y = ((q.x - p.x) * t - (r.x - p.x) * v) / det;
      result.push(
        (x * rect.z) / ppu,
        (y * rect.w) / ppu,
        u - x * p.x - y * p.y - (x * pivot.x * rect.z) / ppu - (y * pivot.y * rect.w) / ppu,
      );
    }
    return result;
  }
  check(false, 'CAPABILITY', 'Sprite requires a nondegenerate source UV mapping');
}

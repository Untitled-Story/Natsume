import { check } from '../errors.js';
import type { DeepReadonly as R, EffectPack } from '../pack.js';
import type { SpriteShapeT } from '../format/generated/noa/ir/sprite-shape.js';
import type { MeshT } from '../format/generated/noa/mesh/mesh.js';

/** Sprite emission uses source vertices and triangle edges, including shared edges. */
export class SpriteShapeSampler {
  readonly mesh: R<MeshT> | undefined;
  constructor(
    pack: EffectPack,
    readonly definition: R<SpriteShapeT>,
  ) {
    const sprite = pack.document.assets.find((a) => a.id === definition.spriteAssetId)?.sprite;
    const mesh = sprite && pack.getMesh(sprite.meshAssetId);
    check(
      !definition.spriteAssetId || (mesh && mesh.positions.length && mesh.indices.length),
      'CAPABILITY',
      'Sprite emission requires nonempty source geometry',
    );
    this.mesh = mesh ?? undefined;
  }
  sample(
    selection: number,
    a: number,
    b: number,
    serial: number,
    out: Float64Array,
    progress = 0,
  ): void {
    const d = this.definition,
      mesh = this.mesh;
    if (!mesh) {
      out.fill(0, 0, 5);
      out[5] = 1;
      return;
    }
    let i = 0,
      j = 0,
      k = 0,
      u = 1,
      v = 0,
      w = 0;
    if (d.placement === 0) {
      i =
        d.spawnMode === 0
          ? Math.min(mesh.positions.length - 1, Math.floor(selection * mesh.positions.length))
          : d.spawnMode === 1
            ? serial % mesh.positions.length
            : Math.min(
                serial % (mesh.positions.length * 2),
                mesh.positions.length * 2 - 1 - (serial % (mesh.positions.length * 2)),
              );
      if (i < 0) i = 0;
      j = k = i;
    } else {
      const triangle =
        Math.min(mesh.indices.length / 3 - 1, Math.floor((selection * mesh.indices.length) / 3)) *
        3;
      if (d.placement === 1) {
        const sample = progress * mesh.indices.length;
        const edgeIndex =
          d.spawnMode === 0
            ? triangle + Math.min(2, Math.floor(a * 3))
            : Math.min(mesh.indices.length - 1, Math.floor(sample));
        const start = edgeIndex - (edgeIndex % 3),
          edge = edgeIndex % 3;
        i = mesh.indices[start + edge]!;
        j = mesh.indices[start + ((edge + 1) % 3)]!;
        k = j;
        v = d.spawnMode === 0 ? b : sample - edgeIndex;
        u = 1 - v;
      } else {
        i = mesh.indices[triangle]!;
        j = mesh.indices[triangle + 1]!;
        k = mesh.indices[triangle + 2]!;
        const root = Math.sqrt(a);
        u = 1 - root;
        v = root * (1 - b);
        w = root * b;
      }
    }
    const p = mesh.positions[i]!,
      q = mesh.positions[j]!,
      r = mesh.positions[k]!;
    out[0] = p.x * u + q.x * v + r.x * w;
    out[1] = p.y * u + q.y * v + r.y * w;
    out[2] = p.z * u + q.z * v + r.z * w + d.normalOffset;
    out[3] = out[4] = 0;
    out[5] = 1;
    if (d.useMeshColors && mesh.colors.length && out.length >= 10) {
      const p = mesh.colors[i]!,
        q = mesh.colors[j]!,
        r = mesh.colors[k]!;
      for (const [axis, key] of (['x', 'y', 'z', 'w'] as const).entries())
        out[6 + axis] = p[key] * u + q[key] * v + r[key] * w;
    }
  }
}

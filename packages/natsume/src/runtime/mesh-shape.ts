import { check } from '../errors.js';
import type { DeepReadonly as R, EffectPack } from '../pack.js';
import type { MeshShapeT } from '../format/generated/noa/ir/mesh-shape.js';
import type { MeshT } from '../format/generated/noa/mesh/mesh.js';

const COLOR_AXES = ['x', 'y', 'z', 'w'] as const;

/** Cached source geometry and area distribution; sampling allocates no particle objects. */
export class MeshShapeSampler {
  readonly mesh: R<MeshT>;
  private readonly indices: readonly number[];
  private readonly vertices: readonly number[];
  private readonly areas: Float64Array;
  private readonly totalArea: number;
  constructor(
    pack: EffectPack,
    readonly definition: R<MeshShapeT>,
  ) {
    const mesh = pack.getMesh(definition.meshAssetId);
    check(mesh && mesh.positions.length, 'CAPABILITY', 'Mesh emission requires source geometry');
    this.mesh = mesh;
    const submesh = mesh.submeshes[definition.materialIndex];
    check(
      !definition.useMaterialIndex || submesh,
      'CAPABILITY',
      'Mesh emission submesh is unavailable',
    );
    this.indices = definition.useMaterialIndex
      ? mesh.indices.slice(submesh!.firstIndex, submesh!.firstIndex + submesh!.indexCount)
      : mesh.indices;
    // Sequential Vertex emission traverses the full vertex buffer, even with a material filter.
    this.vertices = mesh.positions.map((_, i) => i);
    check(this.vertices.length, 'CAPABILITY', 'Mesh emission submesh has no vertices');
    check(
      definition.placement === 0 || this.indices.length >= 3,
      'CAPABILITY',
      'Mesh emission requires triangles',
    );
    this.areas = new Float64Array(this.indices.length / 3);
    let sum = 0;
    for (let t = 0; t < this.areas.length; t++) {
      const p = mesh.positions[this.indices[t * 3]!]!,
        q = mesh.positions[this.indices[t * 3 + 1]!]!,
        r = mesh.positions[this.indices[t * 3 + 2]!]!;
      const ax = q.x - p.x,
        ay = q.y - p.y,
        az = q.z - p.z,
        bx = r.x - p.x,
        by = r.y - p.y,
        bz = r.z - p.z;
      sum += Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) * 0.5;
      this.areas[t] = sum;
    }
    this.totalArea = sum;
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
    let i: number,
      j: number,
      k: number,
      u = 1,
      v = 0,
      w = 0;
    if (d.placement === 0) {
      const count = this.vertices.length;
      const randomVertices = this.indices.length ? this.indices : this.vertices;
      const index =
        d.spawnMode === 0
          ? Math.min(randomVertices.length - 1, Math.floor(selection * randomVertices.length))
          : d.spawnMode === 1
            ? serial % count
            : Math.min(serial % (count * 2), count * 2 - 1 - (serial % (count * 2)));
      i = j = k = d.spawnMode === 0 ? randomVertices[index]! : this.vertices[index]!;
    } else {
      // Unity weights triangles by area for both Edge and Triangle placement.
      const coordinate = d.placement === 1 && d.spawnMode !== 0 ? progress : selection;
      const distance = coordinate * this.totalArea;
      let lo = 0,
        hi = this.areas.length - 1;
      while (lo < hi) {
        const middle = (lo + hi) >>> 1;
        if (distance < this.areas[middle]!) hi = middle;
        else lo = middle + 1;
      }
      const triangle = this.totalArea > 0 ? lo : 0;
      const start = triangle * 3;
      if (d.placement === 1) {
        const previous = triangle ? this.areas[triangle - 1]! : 0;
        const area = this.areas[triangle]! - previous;
        const cursor =
          d.spawnMode === 0 ? a * 3 : (area > 0 ? (distance - previous) / area : 0) * 3;
        const edge = Math.min(2, Math.floor(cursor));
        i = this.indices[start + edge]!;
        j = k = this.indices[start + ((edge + 1) % 3)]!;
        v = d.spawnMode === 0 ? b : cursor - edge;
        u = 1 - v;
      } else {
        i = this.indices[start]!;
        j = this.indices[start + 1]!;
        k = this.indices[start + 2]!;
        const root = Math.sqrt(a);
        u = 1 - root;
        v = root * (1 - b);
        w = root * b;
      }
    }
    const p = mesh.positions[i]!,
      q = mesh.positions[j]!,
      r = mesh.positions[k]!;
    const np = mesh.normals[i],
      nq = mesh.normals[j],
      nr = mesh.normals[k];
    const nx = np && nq && nr ? np.x * u + nq.x * v + nr.x * w : 0,
      ny = np && nq && nr ? np.y * u + nq.y * v + nr.y * w : 0,
      nz = np && nq && nr ? np.z * u + nq.z * v + nr.z * w : 1;
    // Offset uses the interpolated normal before normalization.
    out[0] = p.x * u + q.x * v + r.x * w + nx * d.normalOffset;
    out[1] = p.y * u + q.y * v + r.y * w + ny * d.normalOffset;
    out[2] = p.z * u + q.z * v + r.z * w + nz * d.normalOffset;
    out[3] = nx;
    out[4] = ny;
    out[5] = nz;
    if (out.length >= 10) {
      out.fill(1, 6, 10);
      if (d.useMeshColors && mesh.colors.length) {
        const p = mesh.colors[i]!,
          q = mesh.colors[j]!,
          r = mesh.colors[k]!;
        for (let axis = 0; axis < 4; axis++) {
          const key = COLOR_AXES[axis]!;
          out[6 + axis] =
            Math.floor(
              Math.max(0, Math.min(1, p[key] * u + q[key] * v + r[key] * w)) * 255 + 1e-6,
            ) / 255;
        }
      }
    }
  }
}

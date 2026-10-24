import type { ParticleTrails, TrailRecord } from '../runtime/particle-trails.js';
import { trailAppearance, trailUV } from '../runtime/trail-parameters.js';
import { random } from '../runtime/parameters.js';
import { TrailTextureMode } from '../format/generated/noa/ir/trail-texture-mode.js';

/** Reusable world-space strips. Extra stream data is generated even for unlit materials. */
export class TrailGeometry {
  vertices = new Float32Array(0);
  indices = new Uint32Array(0);
  /** Per vertex: normal(3), tangent(4), previous center(3), next center(3), percentage, width. */
  streams = new Float32Array(0);
  vertexCount = 0;
  indexCount = 0;
  private points = new Float64Array(0);
  private readonly records: TrailRecord[] = [];
  private readonly strips: [number, number][] = [];
  private readonly tint = new Float32Array(4);
  private readonly scratch = new Float32Array(4);

  update(trails: ParticleTrails, viewPosition?: readonly number[]): void {
    this.vertexCount = this.indexCount = 0;
    this.records.length = this.strips.length = 0;
    let count = 0,
      start = 0;
    trails.visit((record, point, x, y, z) => {
      if (point < 0) {
        if (count - start > 1) this.strips.push([start, count]);
        start = count;
        return;
      }
      this.reservePoints(count + 1);
      const offset = count * 4;
      this.points[offset] = x;
      this.points[offset + 1] = y;
      this.points[offset + 2] = z;
      this.points[offset + 3] = 0;
      this.records.push(record);
      count++;
    });
    this.reserveVertices(count * 2);
    const definition = trails.definition,
      seed = trails.emitter.seed;
    for (const [first, end] of this.strips) {
      let length = 0;
      for (let i = first + 1; i < end; i++) {
        const o = i * 4,
          p = o - 4;
        length += Math.hypot(
          this.points[o]! - this.points[p]!,
          this.points[o + 1]! - this.points[p + 1]!,
          this.points[o + 2]! - this.points[p + 2]!,
        );
        this.points[o + 3] = length;
      }
      const base = this.vertexCount;
      for (let i = first; i < end; i++) {
        const o = i * 4;
        let previous = Math.max(first, i - 1) * 4,
          next = Math.min(end - 1, i + 1) * 4;
        const same = (a: number, b: number) =>
          this.points[a] === this.points[b] &&
          this.points[a + 1] === this.points[b + 1] &&
          this.points[a + 2] === this.points[b + 2];
        while (previous > first * 4 && same(previous, o)) previous -= 4;
        while (next < (end - 1) * 4 && same(next, o)) next += 4;
        const x = this.points[o]!,
          y = this.points[o + 1]!,
          z = this.points[o + 2]!;
        const tx = this.points[next]! - this.points[previous]!,
          ty = this.points[next + 1]! - this.points[previous + 1]!,
          tz = this.points[next + 2]! - this.points[previous + 2]!;
        const tl = Math.hypot(tx, ty, tz);
        const tangent = tl > 1e-10 ? [tx / tl, ty / tl, tz / tl] : [1, 0, 0];
        const rx = viewPosition ? x - viewPosition[0]! : 0,
          ry = viewPosition ? y - viewPosition[1]! : 0,
          rz = viewPosition ? z - viewPosition[2]! : 1;
        let sx = ry * tangent[2]! - rz * tangent[1]!,
          sy = rz * tangent[0]! - rx * tangent[2]!,
          sz = rx * tangent[1]! - ry * tangent[0]!;
        const sideLength = Math.hypot(sx, sy, sz);
        if (sideLength > 1e-10) {
          sx /= sideLength;
          sy /= sideLength;
          sz /= sideLength;
        } else {
          sx = 0;
          sy = 1;
          sz = 0;
        }
        const record = this.records[i]!,
          particle = record.particle;
        const phase =
          definition.textureMode === TrailTextureMode.DistributePerSegment ||
          definition.textureMode === TrailTextureMode.RepeatPerSegment
            ? (i - first) / (end - first - 1)
            : length > 0
              ? this.points[o + 3]! / length
              : 0;
        const width = trailAppearance(
          definition,
          Math.min(1, particle.age / particle.lifetime),
          phase,
          particle.size,
          particle.color,
          random(seed, record.id, 192),
          random(seed, record.id, 193),
          random(seed, record.id, 194),
          this.tint,
          this.scratch,
        );
        for (const side of [0, 1] as const) {
          const vertex = this.vertexCount++,
            v = vertex * 10,
            a = vertex * 15;
          const half = width * (side === 0 ? 0.5 : -0.5);
          const uv = trailUV(
            definition,
            this.points[o + 3]!,
            length,
            i - first,
            end - first - 1,
            side,
            record.distance,
          );
          this.vertices[v] = x + sx * half;
          this.vertices[v + 1] = y + sy * half;
          this.vertices[v + 2] = z + sz * half;
          this.vertices[v + 3] = uv[0];
          this.vertices[v + 4] = uv[1];
          this.vertices.set(this.tint, v + 5);
          this.vertices[v + 9] = record.custom;
          const rl = Math.hypot(rx, ry, rz) || 1;
          this.streams[a] = -rx / rl;
          this.streams[a + 1] = -ry / rl;
          this.streams[a + 2] = -rz / rl;
          this.streams[a + 3] = tangent[0]!;
          this.streams[a + 4] = tangent[1]!;
          this.streams[a + 5] = tangent[2]!;
          this.streams[a + 6] = 1;
          for (let axis = 0; axis < 3; axis++) {
            this.streams[a + 7 + axis] = this.points[previous + axis]!;
            this.streams[a + 10 + axis] = this.points[next + axis]!;
          }
          this.streams[a + 13] = phase;
          this.streams[a + 14] = width;
        }
        if (i > first) {
          const b = base + (i - first) * 2;
          this.indices.set([b - 2, b, b - 1, b - 1, b, b + 1], this.indexCount);
          this.indexCount += 6;
        }
      }
    }
  }
  private reservePoints(count: number): void {
    if (this.points.length >= count * 4) return;
    const next = new Float64Array(Math.max(256, this.points.length * 2, count * 4));
    next.set(this.points);
    this.points = next;
  }
  private reserveVertices(count: number): void {
    if (this.vertices.length >= count * 10) return;
    const capacity = Math.max(256, (this.vertices.length / 10) * 2, count);
    this.vertices = new Float32Array(capacity * 10);
    this.streams = new Float32Array(capacity * 15);
    this.indices = new Uint32Array(capacity * 3);
  }
}

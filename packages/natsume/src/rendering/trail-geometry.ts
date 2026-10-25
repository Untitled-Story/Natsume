import type { ParticleTrails, TrailRecord } from '../runtime/particle-trails.js';
import { trailAppearance, trailUV } from '../runtime/trail-parameters.js';
import { random } from '../runtime/parameters.js';
import { TrailTextureMode } from '../format/generated/noa/ir/trail-texture-mode.js';
import { TrailMode } from '../format/generated/noa/ir/trail-mode.js';

/** Reusable world-space strips. Extra stream data is generated even for unlit materials. */
export class TrailGeometry {
  vertices = new Float32Array(0);
  indices = new Uint32Array(0);
  /** Per vertex: normal(3), tangent(4), previous center(3), next center(3), percentage, width. */
  streams = new Float32Array(0);
  vertexCount = 0;
  indexCount = 0;
  private points = new Float64Array(0);
  private directions = new Float64Array(0);
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
      this.smoothDirections(first, end, definition.mode === TrailMode.Ribbon);
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
        const d = i * 3,
          p = Math.max(first, i - 1) * 3;
        const tx = this.directions[d]!,
          ty = this.directions[d + 1]!,
          tz = this.directions[d + 2]!;
        let ax = tx + this.directions[p]!,
          ay = ty + this.directions[p + 1]!,
          az = tz + this.directions[p + 2]!;
        if (Math.hypot(ax, ay, az) < 1e-10) {
          ax = this.directions[p]!;
          ay = this.directions[p + 1]!;
          az = this.directions[p + 2]!;
        }
        const rx = viewPosition ? x - viewPosition[0]! : 0,
          ry = viewPosition ? y - viewPosition[1]! : 0,
          rz = viewPosition ? z - viewPosition[2]! : 1;
        let sx = ry * az - rz * ay,
          sy = rz * ax - rx * az,
          sz = rx * ay - ry * ax;
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
          const tangentDot = (tx * rx + ty * ry + tz * rz) / (rl * rl);
          const px = tx - rx * tangentDot,
            py = ty - ry * tangentDot,
            pz = tz - rz * tangentDot;
          const pl = Math.hypot(px, py, pz) || 1;
          this.streams[a + 3] = px / pl;
          this.streams[a + 4] = py / pl;
          this.streams[a + 5] = pz / pl;
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
    this.directions = new Float64Array((next.length / 4) * 3);
  }

  /** Recursive angle bisectors keep turns smooth without extending the strip's width. */
  private smoothDirections(first: number, end: number, ribbon: boolean): void {
    let x = 1,
      y = 0,
      z = 0;
    for (let i = first + 1; i < end; i++) {
      const a = first * 4,
        b = i * 4;
      const dx = this.points[b]! - this.points[a]!,
        dy = this.points[b + 1]! - this.points[a + 1]!,
        dz = this.points[b + 2]! - this.points[a + 2]!;
      const length = Math.hypot(dx, dy, dz);
      if (length > 1e-10) {
        x = dx / length;
        y = dy / length;
        z = dz / length;
        break;
      }
    }
    let capX = x,
      capY = y,
      capZ = z;
    const head = first * 4,
      anchor = head + 4;
    const duplicateHead =
      this.points[head] === this.points[anchor] &&
      this.points[head + 1] === this.points[anchor + 1] &&
      this.points[head + 2] === this.points[anchor + 2];
    for (let i = first; i < end; i++) {
      if (!ribbon && i === first) {
        // The moving head uses its current direction; stored anchors smooth the history.
      } else if (i + 2 < end) {
        const a = (i + (ribbon || duplicateHead ? 1 : 0)) * 4,
          b = a + 4;
        let dx = this.points[b]! - this.points[a]!,
          dy = this.points[b + 1]! - this.points[a + 1]!,
          dz = this.points[b + 2]! - this.points[a + 2]!;
        let length = Math.hypot(dx, dy, dz);
        // Clipped endpoints can differ only by Float32 rounding. Keep the last real edge.
        if (length < 1e-6) {
          const p = i * 4,
            n = p + 4;
          dx = this.points[n]! - this.points[p]!;
          dy = this.points[n + 1]! - this.points[p + 1]!;
          dz = this.points[n + 2]! - this.points[p + 2]!;
          length = Math.hypot(dx, dy, dz);
        }
        if (length > 1e-6) {
          const nx = dx / length,
            ny = dy / length,
            nz = dz / length;
          const sum = Math.hypot(x + nx, y + ny, z + nz);
          if (sum > 1e-10) {
            x = (x + nx) / sum;
            y = (y + ny) / sum;
            z = (z + nz) / sum;
            capX = x;
            capY = y;
            capZ = z;
          } else {
            capX = nx;
            capY = ny;
            capZ = nz;
          }
        }
      } else {
        x = capX;
        y = capY;
        z = capZ;
      }
      this.directions[i * 3] = x;
      this.directions[i * 3 + 1] = y;
      this.directions[i * 3 + 2] = z;
    }
  }
  private reserveVertices(count: number): void {
    if (this.vertices.length >= count * 10) return;
    const capacity = Math.max(256, (this.vertices.length / 10) * 2, count);
    this.vertices = new Float32Array(capacity * 10);
    this.streams = new Float32Array(capacity * 15);
    this.indices = new Uint32Array(capacity * 3);
  }
}

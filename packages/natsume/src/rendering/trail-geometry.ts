import type { ParticleTrails, TrailRecord } from '../runtime/particle-trails.js';
import { trailAppearance, trailUV } from '../runtime/trail-parameters.js';
import { random, scalar } from '../runtime/parameters.js';
import { TrailTextureMode } from '../format/generated/noa/ir/trail-texture-mode.js';
import { TrailMode } from '../format/generated/noa/ir/trail-mode.js';
import { ScalarMode } from '../format/generated/noa/ir/scalar-mode.js';

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
  private ribbonSides = new Float64Array(0);
  private ribbonOffsets = new Float64Array(0);
  private readonly ribbonNormal = new Float64Array(3);
  private readonly records: TrailRecord[] = [];
  private readonly strips: [number, number][] = [];
  private readonly tint = new Float32Array(4);
  private readonly scratch = new Float32Array(4);

  update(
    trails: ParticleTrails,
    viewPosition?: readonly number[],
    display?: ArrayLike<number>,
  ): void {
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
      this.smoothDirections(first, end, trails);
      if (definition.mode === TrailMode.Ribbon)
        this.buildRibbonSides(first, end, trails, viewPosition, display);
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
        if (definition.mode === TrailMode.Ribbon) {
          sx = this.ribbonOffsets[d]!;
          sy = this.ribbonOffsets[d + 1]!;
          sz = this.ribbonOffsets[d + 2]!;
        }
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
          if (definition.mode === TrailMode.Ribbon) {
            this.streams.set(this.ribbonNormal, a);
            this.streams[a + 3] = tx;
            this.streams[a + 4] = ty;
            this.streams[a + 5] = tz;
          }
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
    this.ribbonSides = new Float64Array(this.directions.length);
    this.ribbonOffsets = new Float64Array(this.directions.length);
  }

  private baseWidth(trails: ParticleTrails, record: TrailRecord): number {
    const width = trails.definition.widthOverTrail;
    return Math.abs(
      (width?.mode === ScalarMode.Curve || width?.mode === ScalarMode.TwoCurves
        ? width.multiplier
        : scalar(width, 0, random(trails.emitter.seed, record.id, 193), 1)) *
        (trails.definition.sizeAffectsWidth ? Math.max(...record.particle.size) : 1),
    );
  }

  /** Segment length relative to width controls how much adjacent tangents share a turn. */
  private smoothDirections(first: number, end: number, trails: ParticleTrails): void {
    const ribbon = trails.definition.mode === TrailMode.Ribbon;
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
    let lookAhead = ribbon || duplicateHead ? 1 : 0;
    for (let i = first; i < end; i++) {
      const baseWidth = this.baseWidth(trails, this.records[first]!);
      if (!ribbon && !lookAhead && i + 2 < end) {
        const p = (i + 1) * 4;
        const length = Math.hypot(
          this.points[p + 4]! - this.points[p]!,
          this.points[p + 5]! - this.points[p + 1]!,
          this.points[p + 6]! - this.points[p + 2]!,
        );
        if (length > baseWidth && length < 2 * baseWidth) lookAhead = 1;
      }
      let outX = x,
        outY = y,
        outZ = z;
      if (!ribbon && !lookAhead && i === first) {
        // The moving head uses its current direction; stored anchors smooth the history.
      } else if (i + 2 < end) {
        const a = (i + lookAhead) * 4,
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
          const weight = lookAhead
            ? Math.max(0, Math.min(0.5, 1 - length / (2 * (baseWidth || 1))))
            : 0.5;
          const ox = x * (1 - weight) + nx * weight,
            oy = y * (1 - weight) + ny * weight,
            oz = z * (1 - weight) + nz * weight;
          const sum = Math.hypot(ox, oy, oz);
          if (sum > 1e-10) {
            outX = ox / sum;
            outY = oy / sum;
            outZ = oz / sum;
            const cx = x * weight + nx * (1 - weight),
              cy = y * weight + ny * (1 - weight),
              cz = z * weight + nz * (1 - weight);
            const cl = Math.hypot(cx, cy, cz) || 1;
            x = cx / cl;
            y = cy / cl;
            z = cz / cl;
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
        outX = x;
        outY = y;
        outZ = z;
      }
      this.directions[i * 3] = outX;
      this.directions[i * 3 + 1] = outY;
      this.directions[i * 3 + 2] = outZ;
    }
  }
  /** Smooth normalized view-plane sides before intersecting the two offset edges. */
  private buildRibbonSides(
    first: number,
    end: number,
    trails: ParticleTrails,
    view?: readonly number[],
    display?: ArrayLike<number>,
  ): void {
    let ux = display?.[0] ?? 1,
      uy = display?.[4] ?? 0,
      uz = display?.[8] ?? 0;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    let nx = display?.[2] ?? 0,
      ny = display?.[6] ?? 0,
      nz = display?.[10] ?? 1;
    const projection = ux * nx + uy * ny + uz * nz;
    nx -= projection * ux;
    ny -= projection * uy;
    nz -= projection * uz;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const vx = ny * uz - nz * uy,
      vy = nz * ux - nx * uz,
      vz = nx * uy - ny * ux;
    // The smoothing radius is authored width; particle size only scales final vertices.
    const width = trails.definition.widthOverTrail;
    const authoredSize = trails.definition.sizeAffectsWidth
      ? scalar(trails.emitter.main.size?.x, 0, 1, 1)
      : 1;
    const radius =
      authoredSize *
      Math.abs(
        width?.mode === ScalarMode.Curve || width?.mode === ScalarMode.TwoCurves
          ? width.multiplier
          : scalar(width, 0, random(trails.emitter.seed, this.records[first]!.id, 193), 1),
      );
    for (let i = first; i < end; i++) {
      const j = Math.max(first + 1, i),
        a = (j - 1) * 4,
        b = j * 4,
        o = i * 4,
        d = i * 3;
      const dx = this.points[b]! - this.points[a]!,
        dy = this.points[b + 1]! - this.points[a + 1]!,
        dz = this.points[b + 2]! - this.points[a + 2]!;
      const rx = view ? this.points[o]! - view[0]! : nx,
        ry = view ? this.points[o + 1]! - view[1]! : ny,
        rz = view ? this.points[o + 2]! - view[2]! : nz;
      const cx = ry * dz - rz * dy,
        cy = rz * dx - rx * dz,
        cz = rx * dy - ry * dx;
      let x = cx * ux + cy * uy + cz * uz,
        y = cx * vx + cy * vy + cz * vz;
      const length = Math.hypot(x, y) || 1;
      x /= length;
      y /= length;
      this.ribbonSides[d] = x;
      this.ribbonSides[d + 1] = y;
      this.ribbonSides[d + 2] = Math.hypot(dx, dy, dz) / (2 * radius || 1);
      if (i > first && this.ribbonSides[d + 2]! < 1) {
        const p = d - 3,
          px = this.ribbonSides[p]!,
          py = this.ribbonSides[p + 1]!;
        const mx = (x + px) * 0.5,
          my = (y + py) * 0.5;
        const weight = Math.max(0, this.ribbonSides[d + 2]! - 0.5) * 2;
        const ax = mx + (px - mx) * weight,
          ay = my + (py - my) * weight;
        const bx = mx + (x - mx) * weight,
          by = my + (y - my) * weight;
        const al = Math.hypot(ax, ay),
          bl = Math.hypot(bx, by);
        if (al > 1e-10) {
          this.ribbonSides[p] = ax / al;
          this.ribbonSides[p + 1] = ay / al;
        }
        if (bl > 1e-10) {
          this.ribbonSides[d] = bx / bl;
          this.ribbonSides[d + 1] = by / bl;
        }
      }
    }
    // Reverse iteration preserves sides needed by the preceding intersection.
    for (let i = end - 1; i >= first; i--) {
      const d = i * 3,
        j = Math.min(end - 1, i + 1) * 3;
      let x = this.ribbonSides[j]!,
        y = this.ribbonSides[j + 1]!;
      if (i > first && i < end - 1) {
        const ax = this.ribbonSides[d]!,
          ay = this.ribbonSides[d + 1]!;
        const sumX = ax + x,
          sumY = ay + y;
        const denom = 1 + ax * x + ay * y;
        if (denom > 1e-10) {
          x = sumX / denom;
          y = sumY / denom;
        } else {
          x = ax;
          y = ay;
        }
        const blend = Math.min(
          1,
          50 *
            Math.min(
              (ax - this.ribbonSides[j]!) ** 2 + (ay - this.ribbonSides[j + 1]!) ** 2,
              (ax + this.ribbonSides[j]!) ** 2 + (ay + this.ribbonSides[j + 1]!) ** 2,
            ),
        );
        x = ax + (x - ax) * blend;
        y = ay + (y - ay) * blend;
        const bound = Math.max(1, Math.min(3, this.ribbonSides[d - 1]! * 3));
        const length = Math.hypot(x, y);
        if (length > bound) {
          x *= bound / length;
          y *= bound / length;
        }
      }
      // Keep unscaled segment sides for lighting tangents.
      this.ribbonOffsets[d] = ux * x + vx * y;
      this.ribbonOffsets[d + 1] = uy * x + vy * y;
      this.ribbonOffsets[d + 2] = uz * x + vz * y;
    }
    this.ribbonNormal.set([-nx, -ny, -nz]);
    for (let i = first; i < end; i++) {
      const d = i * 3,
        j = Math.min(end - 1, i + 1) * 3;
      const x = this.ribbonSides[j]!,
        y = this.ribbonSides[j + 1]!;
      this.directions[d] = ux * y - vx * x;
      this.directions[d + 1] = uy * y - vy * x;
      this.directions[d + 2] = uz * y - vz * x;
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

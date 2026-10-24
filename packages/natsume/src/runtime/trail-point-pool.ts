import { check } from '../errors.js';

/** Shared storage for live and retained trail points. Freed slots are reused. */
export class TrailPointPool {
  private values = new Float32Array(0);
  private links = new Int32Array(0);
  private occupied = new Uint8Array(0);
  private free = -1;
  private allocated = 0;
  count = 0;

  constructor(readonly limit = 65_536) {
    check(
      Number.isSafeInteger(limit) && limit > 0 && limit <= 0x7fffffff,
      'HOST',
      'maxTrailPoints must be a positive integer no greater than 2147483647',
    );
  }

  get capacity(): number {
    return this.links.length;
  }

  allocate(x: number, y: number, z: number, time: number, distance: number): number {
    check(
      this.count < this.limit,
      'LIMIT',
      `Trail point capacity exceeded (${this.limit}); increase maxTrailPoints`,
    );
    let slot: number;
    if (this.free >= 0) {
      slot = this.free;
      this.free = this.links[slot]!;
    } else {
      if (this.allocated === this.capacity) this.grow();
      slot = this.allocated++;
    }
    this.occupied[slot] = 1;
    this.links[slot] = -1;
    this.count++;
    this.write(slot, x, y, z, time, distance);
    return slot;
  }

  write(slot: number, x: number, y: number, z: number, time: number, distance: number): void {
    const offset = slot * 5;
    this.values[offset] = x;
    this.values[offset + 1] = y;
    this.values[offset + 2] = z;
    this.values[offset + 3] = time;
    this.values[offset + 4] = distance;
  }

  read(slot: number, field: 0 | 1 | 2 | 3 | 4): number {
    return this.values[slot * 5 + field]!;
  }
  next(slot: number): number {
    return this.links[slot]!;
  }
  setNext(slot: number, next: number): void {
    this.links[slot] = next;
  }

  release(slot: number): void {
    check(this.occupied[slot] === 1, 'HOST', 'Trail point is not allocated');
    this.occupied[slot] = 0;
    this.links[slot] = this.free;
    this.free = slot;
    this.count--;
  }

  clear(): void {
    this.occupied.fill(0);
    this.free = -1;
    this.allocated = this.count = 0;
  }

  private grow(): void {
    const capacity = Math.min(this.limit, Math.max(256, this.capacity * 2));
    const values = new Float32Array(capacity * 5);
    const links = new Int32Array(capacity);
    const occupied = new Uint8Array(capacity);
    values.set(this.values);
    links.set(this.links);
    occupied.set(this.occupied);
    this.values = values;
    this.links = links;
    this.occupied = occupied;
  }
}

import { expect, it } from 'vitest';
import { TrailPointPool } from '../src/runtime/trail-point-pool.js';

it('grows within the instance budget, reuses freed slots, and preserves linked history', () => {
  const pool = new TrailPointPool(300);
  expect(pool.capacity).toBe(0);
  const head = pool.allocate(1, 2, 3, 4, 5);
  for (let i = 1; i < 300; i++) pool.allocate(i, 0, 0, 0, 0);
  expect(pool.capacity).toBe(300);
  expect(pool.read(head, 4)).toBe(5);
  expect(() => pool.allocate(0, 0, 0, 0, 0)).toThrow('maxTrailPoints');
  expect(pool.count).toBe(300);
  pool.release(100);
  const reused = pool.allocate(9, 8, 7, 6, 5);
  expect(reused).toBe(100);
  pool.setNext(head, reused);
  expect(pool.next(head)).toBe(100);
  expect(pool.read(reused, 0)).toBe(9);
  pool.clear();
  expect(pool.count).toBe(0);
  expect(pool.capacity).toBe(300);
  expect(pool.allocate(0, 0, 0, 0, 0)).toBe(0);
});

it('rejects invalid budgets and double releases', () => {
  for (const limit of [0, -1, 0.5, NaN, Infinity, 0x80000000])
    expect(() => new TrailPointPool(limit)).toThrow('maxTrailPoints');
  const pool = new TrailPointPool(1);
  const slot = pool.allocate(0, 0, 0, 0, 0);
  pool.release(slot);
  expect(() => pool.release(slot)).toThrow('not allocated');
  expect(pool.count).toBe(0);
});

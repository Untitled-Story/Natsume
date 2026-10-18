import { expect, it } from 'vitest';
import { copyEnvironment } from '../src/rendering/particle-environment.js';

it('copies world-space view velocity without retaining the host array', () => {
  const velocity: [number, number, number] = [2, -3, 4];
  const environment = copyEnvironment({ fog: { mode: 'none' }, viewVelocity: velocity })!;
  velocity[0] = 99;
  expect(environment.viewVelocity).toEqual([2, -3, 4]);
  expect(copyEnvironment({ fog: { mode: 'none' } })!.viewVelocity).toBeUndefined();
});

it('rejects nonfinite view velocity before changing particle inputs', () => {
  for (const viewVelocity of [
    [NaN, 0, 0],
    [0, Infinity, 0],
    [0, 0],
    [1, 2, 3, 4],
  ])
    expect(() =>
      copyEnvironment({
        fog: { mode: 'none' },
        viewVelocity: viewVelocity as [number, number, number],
      }),
    ).toThrow('View velocity requires three finite world-space components');
});

it('copies the view origin and rejects invalid coordinates', () => {
  const position: [number, number, number] = [1, 2, -10];
  const environment = copyEnvironment({ fog: { mode: 'none' }, viewPosition: position })!;
  position[2] = 99;
  expect(environment.viewPosition).toEqual([1, 2, -10]);
  for (const viewPosition of [
    [NaN, 0, 0],
    [0, Infinity, 0],
    [0, 0],
    [1, 2, 3, 4],
  ])
    expect(() =>
      copyEnvironment({
        fog: { mode: 'none' },
        viewPosition: viewPosition as [number, number, number],
      }),
    ).toThrow('View position requires three finite world-space components');
});

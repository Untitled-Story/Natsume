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

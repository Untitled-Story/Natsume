import assert from 'node:assert/strict';

/** Joins raw execution records to native observations; pads only absent idle jobs. */
export function sharedOrderFixture(observations, trace) {
  assert.equal(observations.cases.length, 72);
  const frames = new Map();
  const jobs = new Map();
  for (const row of trace) {
    if (row.event === 'begin') frames.set(row.frame, true);
    if (row.event !== 'execute') continue;
    const ci = Math.floor(row.key / 10);
    const id = (row.key % 10) + 2;
    assert(ci >= 0 && ci < observations.cases.length && id >= 3 && id <= 6);
    const key = `${ci}:${row.frame}`;
    const order = jobs.get(key) ?? [];
    order.push(id);
    jobs.set(key, order);
  }
  for (let frame = 1; frame <= 120; frame++) assert(frames.has(frame), `Missing frame ${frame}`);
  const result = globalThis.structuredClone(observations);
  for (const [ci, c] of result.cases.entries()) {
    assert.equal(c.samples.length, 121);
    for (const sample of c.samples) {
      if (!sample.frame) continue;
      const order = jobs.get(`${ci}:${sample.frame}`) ?? [];
      const remaining = new Map([
        [3, 1],
        [4, 1],
        [5, c.topology === 0 ? 2 : 1],
        [6, 1],
      ]);
      for (const id of order) {
        const count = remaining.get(id);
        assert(count > 0, `Excess pool update: case ${ci}, frame ${sample.frame}, system ${id}`);
        remaining.set(id, count - 1);
      }
      for (const [id, count] of remaining) for (let i = 0; i < count; i++) order.push(id);
      sample.updateOrder = order;
    }
  }
  return result;
}

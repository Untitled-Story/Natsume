import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { loadPack } from '../src/loader/load.js';
import { ComponentData as C } from '../src/format/generated/noa/ir/component-data.js';
import { Simulation } from '../src/runtime/simulation.js';

const directory = resolve(import.meta.dirname, '../../../data/unity-baselines/timeline');
interface Sample {
  time: number;
  systems?: { name: string; count: number; time: number; seed: number }[];
  active: boolean;
  position: { x: number; y: number; z: number };
  starts: number;
  stops: number;
  controlSamples: number;
  controlTime: number;
  particles: number;
  particleTime: number;
  nestedTime: number;
}
interface Case {
  label: string;
  duration: number;
  samples: Sample[];
  stoppedActive: boolean;
  settledActive: boolean;
  stoppedPosition: { x: number; y: number; z: number };
}
it.skipIf(!existsSync(directory + '/packages/case23.noap'))(
  'replays native Timeline packages at source sample times',
  async () => {
    const native = JSON.parse(readFileSync(directory + '/unity-2022.3.21f1.json', 'utf8')) as {
      cases: Case[];
    };
    const results = [];
    for (const [index, row] of native.cases.entries()) {
      const pack = await loadPack(
        new Uint8Array(readFileSync(directory + `/packages/case${index}.noap`)),
      );
      const simulation = new Simulation(pack, { seed: 42 });
      const scene = simulation.scene;
      const component = pack.components.find(
        (c) => c.dataType === C.PlayableDirector && c.nodeId === pack.document.entries[0]!.roots[0],
      )!;
      const director = simulation.getDirector(component.id);
      director.play();
      let starts = 0,
        stops = 0,
        controlSamples = 0,
        controlTime = 0;
      simulation.onControlTime = (_, phase, time) => {
        if (phase === 'start') starts++;
        else if (phase === 'stop') stops++;
        else {
          controlSamples++;
          controlTime = time;
        }
      };
      const particle = [...simulation.emitters.values()][0];
      const nested = [...simulation.directors.values()].find((d) => d !== director);
      const node = [...scene.nodes.values()].find((n) => n.name === 'target')!;
      let maxPosition = 0,
        activeDifferences = 0,
        controlDifferences = 0,
        countDifferences = 0,
        maxClock = 0;
      const clockError = (actual: number, expected: number, duration: number, loop: boolean) => {
        const error = Math.abs(actual - expected);
        return loop ? Math.min(error, Math.abs(error - duration)) : error;
      };
      const differences: unknown[] = [];
      for (const sample of row.samples) {
        director.setTime(sample.time);
        director.evaluate();
        for (const axis of ['x', 'y', 'z'] as const) {
          const error = Math.abs(node.localPosition[axis] - sample.position[axis]);
          maxPosition = Math.max(maxPosition, error);
          if (error > 1e-4 && differences.length < 4)
            differences.push({
              time: sample.time,
              axis,
              actual: node.localPosition[axis],
              expected: sample.position[axis],
            });
        }
        activeDifferences += Number(node.active !== sample.active);
        if (row.label.startsWith('kind-5-'))
          controlDifferences += Number(
            starts !== sample.starts ||
              stops !== sample.stops ||
              controlSamples !== sample.controlSamples,
          );
        maxClock = Math.max(
          maxClock,
          Math.abs(controlTime - sample.controlTime),
          clockError(
            particle?.elapsedSeconds ?? 0,
            sample.particleTime,
            particle?.main.durationSeconds ?? 1,
            particle?.main.loop ?? false,
          ),
          Math.abs((nested?.time ?? 0) - sample.nestedTime),
        );
        countDifferences += Number((particle?.count ?? 0) !== sample.particles);
        for (const system of sample.systems ?? []) {
          const emitter = [...simulation.emitters.values()].find(
            (e) => e.node.name === system.name,
          )!;
          if (
            (emitter.count !== system.count ||
              clockError(
                emitter.elapsedSeconds,
                system.time,
                emitter.main.durationSeconds,
                emitter.main.loop,
              ) > 1e-5) &&
            differences.length < 4
          )
            differences.push({
              at: sample.time,
              name: system.name,
              count: emitter.count,
              expectedCount: system.count,
              time: emitter.elapsedSeconds,
              expectedTime: system.time,
            });
          countDifferences += Number(emitter.count !== system.count);
          maxClock = Math.max(
            maxClock,
            clockError(
              emitter.elapsedSeconds,
              system.time,
              emitter.main.durationSeconds,
              emitter.main.loop,
            ),
          );
          expect(emitter.seed, `${row.label}:${system.name} seed`).toBe(system.seed);
        }
      }
      director.stop();
      const immediateStopDifference = Number(node.active !== row.stoppedActive);
      simulation.flushDirectors();
      const settledStopDifference = Number(node.active !== row.settledActive);
      results.push({
        label: row.label,
        maxPosition,
        activeDifferences,
        controlDifferences,
        countDifferences,
        maxClock,
        durationError: Math.abs(director.duration - row.duration),
        differences,
        immediateStopDifference,
        settledStopDifference,
      });
      pack.dispose();
    }
    writeFileSync(directory + '/comparison.json', JSON.stringify(results, null, 2));
    expect(results.filter((r) => r.activeDifferences)).toEqual([]);
    expect(results.filter((r) => r.maxPosition > 1e-4)).toEqual([]);
    expect(results.filter((r) => r.durationError > 1e-11)).toEqual([]);
    expect(results.filter((r) => r.immediateStopDifference || r.settledStopDifference)).toEqual([]);
    expect(
      results.filter((r) => r.controlDifferences || r.countDifferences || r.maxClock > 1e-5),
    ).toEqual([]);
  },
);

it.skipIf(!existsSync(directory + '/packages/case54.noap'))(
  'resynchronizes an independently reactivated child particle clock',
  async () => {
    const pack = await loadPack(new Uint8Array(readFileSync(directory + '/packages/case54.noap')));
    const simulation = new Simulation(pack, { seed: 42 });
    try {
      const director = [...simulation.directors.values()][0]!;
      const systems = [...simulation.emitters.values()];
      const child = systems.find((e) => e.node.name === 'child-particles')!;
      const root = systems.find((e) => e.node.name === 'target')!;
      director.setTime(0.5);
      director.evaluate();
      simulation.setNodeActive(child.node.id, false);
      director.setTime(0.6);
      director.evaluate();
      expect(child.elapsedSeconds).toBeCloseTo(0.25, 6);
      expect(root.elapsedSeconds).toBeCloseTo(0.35, 6);
      simulation.setNodeActive(child.node.id, true);
      director.setTime(0.7);
      director.evaluate();
      expect(child.elapsedSeconds).toBeCloseTo(0.45, 6);
      expect(root.elapsedSeconds).toBeCloseTo(0.45, 6);
      expect(child.count).toBe(root.count);
    } finally {
      simulation.disposeDirectors();
      pack.dispose();
    }
  },
);

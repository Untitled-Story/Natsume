import { animatorSupport } from '../src/runtime/animation.js';
import type { AnimatorT } from '../src/format/generated/noa/ir/animator.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { loadPack } from '../src/loader/load.js';
import { Simulation } from '../src/runtime/simulation.js';
import { SUPPORTED_FEATURES } from '../src/format/semantics.js';
import { Document } from '../src/format/generated/noa/ir/document.js';
import { ByteBuffer } from 'flatbuffers';
import { unzipSync } from 'fflate';
import { nativeSimulationIssues } from './native-playback-support.js';

const source = new URL('../../../../Noa/out/compile-successes.json', import.meta.url);
it.skipIf(!existsSync(source))(
  'runs compatible native exports and rejects unimplemented required capabilities',
  async () => {
    const index = JSON.parse(readFileSync(source, 'utf8')) as { outputs: string[] };
    const results: { file: string; accepted: boolean; timed: number; unsupported: string[] }[] = [];
    for (const file of index.outputs) {
      const bytes = readFileSync(new URL(`../../../../Noa/${file}`, import.meta.url));
      const archive = unzipSync(bytes);
      const document = Document.getRootAsDocument(new ByteBuffer(archive['scene.noir']!)).unpack();
      const unsupported = document.features
        .filter((f) => f.required && SUPPORTED_FEATURES[f.name as string] !== f.revision)
        .map((f) => f.name as string);
      const controllerIssues = document.components
        .filter((c) => c.dataType === 6)
        .flatMap((c) => animatorSupport(c.data as AnimatorT, c.id))
        .filter((i) => i.severity === 'error');
      unsupported.push(...controllerIssues.map((i) => i.field));
      const pack = await loadPack(bytes);
      unsupported.push(...nativeSimulationIssues(pack));
      if (unsupported.length) {
        expect(
          () =>
            new Simulation(pack, {
              gravity: [0, -9.81, 0],
              parentLayout: { width: 640, height: 360 },
            }),
          file,
        ).toThrow(
          /Required feature is not implemented|Animator controller branch|single-layer|Particle mode|Particle visibility|PauseAndCatchup|Emitter requires/,
        );
        pack.dispose();
        results.push({ file, accepted: false, timed: 0, unsupported });
        continue;
      }
      const simulation = new Simulation(pack, {
        seed: 12345,
        gravity: [0, -9.81, 0],
        parentLayout: { width: 640, height: 360 },
      });
      const eventSequence: string[] = [];
      simulation.onAnimationEvent = (event) => {
        eventSequence.push(`${event.clipId}:${event.animatorId}:${event.stringParameter}`);
      };
      simulation.play();
      const activeSnapshot = () => [...simulation.scene.nodes.values()].map((n) => n.active);
      const sequence: boolean[][] = [];
      for (let i = 0; i < 120; i++) {
        simulation.update(1 / 60);
        sequence.push(activeSnapshot());
      }
      const expectedEvents = [...eventSequence];
      eventSequence.length = 0;
      simulation.restart();
      for (const expected of sequence) {
        simulation.update(1 / 60);
        expect(activeSnapshot(), file).toEqual(expected);
      }
      expect(eventSequence, file).toEqual(expectedEvents);
      const timed = document.animations.filter((a) => a.durationSeconds > 0).length;
      results.push({ file, accepted: true, timed, unsupported });
      pack.dispose();
    }
    expect(results.some((r) => r.accepted)).toBe(true);
    expect(results.some((r) => r.timed > 0)).toBe(true);
    const output = process.env.NATSUME_ANIMATION_PACK_REPORT;
    if (output)
      writeFileSync(
        output,
        JSON.stringify(
          {
            accepted: results.filter((r) => r.accepted).length,
            timed: results.reduce((n, r) => n + r.timed, 0),
            results,
          },
          null,
          2,
        ) + '\n',
      );
  },
  90_000,
);

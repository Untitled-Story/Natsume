import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it, expect } from 'vitest';
import { loadPack } from '../src/loader/load.js';
import { Scene } from '../src/runtime/scene.js';
import { AnimationBindings } from '../src/runtime/animation-bindings.js';
import { AnimatorController } from '../src/runtime/animator-controller.js';
import { ComponentData } from '../src/format/generated/noa/ir/component-data.js';
import type { SpriteRendererT } from '../src/format/generated/noa/ir/sprite-renderer.js';
import type { AnimatorT } from '../src/format/generated/noa/ir/animator.js';

const directory = resolve(import.meta.dirname, '../../../data/unity-baselines/animator-controller');
interface Sample {
  frame: number;
  color: { r: number; g: number; b: number; a: number };
  speed: number;
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  active: boolean;
  layers: {
    state: string;
    time: number;
    next: string;
    nextTime: number;
    progress: number;
    transitioning: boolean;
  }[];
}
interface Case {
  label: string;
  commands: { frame: number; type: number; parameter: string; value: number }[];
  samples: Sample[];
  events: { frame: number; name: string }[];
}
it.skipIf(!existsSync(directory + '/unity-2022.3.21f1.json'))(
  'matches native flat controller decisions and layered poses',
  async () => {
    const native = JSON.parse(readFileSync(directory + '/unity-2022.3.21f1.json', 'utf8')) as {
      cases: Case[];
    };
    const results = [];
    for (const [i, row] of native.cases.entries()) {
      const pack = await loadPack(
        new Uint8Array(readFileSync(directory + `/packages/case${i}.noap`)),
      );
      const scene = new Scene(pack, pack.document.entries[0]!.roots);
      const bindings = new AnimationBindings(pack, scene);
      const source = pack.components.find((c) => c.dataType === ComponentData.Animator)!
        .data as AnimatorT;
      let frame = 0;
      const hits: { frame: number; name: string }[] = [];
      const c = new AnimatorController(
        source,
        new Map(pack.document.animations.map((a) => [a.id, a])),
        bindings,
        (_clip, event) => {
          hits.push({ frame, name: String(event.stringParameter) });
          return true;
        },
      );
      const node = [...scene.nodes.values()].find((n) => n.name === 'target')!;
      c.start();
      c.apply();
      c.flushEvents();
      let transform = 0,
        quaternion = 0,
        colorError = 0,
        particleError = 0;
      let pose = 0,
        time = 0,
        decisions = 0,
        active = 0;
      const failures = [];
      for (const sample of row.samples) {
        frame = sample.frame;
        for (const cmd of row.commands.filter((c) => c.frame === sample.frame)) {
          if (cmd.type === 0) c.parameters.setFloat(cmd.parameter, cmd.value);
          if (cmd.type === 1) c.parameters.setInt(cmd.parameter, cmd.value);
          if (cmd.type === 2) c.parameters.setBool(cmd.parameter, cmd.value !== 0);
          if (cmd.type === 3) c.parameters.setTrigger(cmd.parameter);
          if (cmd.type === 4) c.parameters.resetTrigger(cmd.parameter);
          if (cmd.type === 5) c.setLayerWeight(cmd.value, 0.25);
          if (cmd.type === 6) {
            c.evaluate(1 / 60);
            c.play(cmd.parameter.split('.').at(-1)!, cmd.value);
            c.flushEvents();
          }
          if (cmd.type === 7) node.active = cmd.value !== 0;
        }
        if (
          sample.frame > 0 &&
          !row.commands.some((cmd) => cmd.frame === sample.frame && cmd.type === 6)
        )
          c.evaluate(1 / 60);
        c.apply();
        let error = 0;
        for (const [actual, expected] of [
          [node.localPosition, sample.position],
          [node.localScale, sample.scale],
        ] as const)
          for (const axis of ['x', 'y', 'z'] as const)
            error = Math.max(error, Math.abs(actual[axis] - expected[axis]));
        transform = Math.max(transform, error);
        const q = node.localRotation,
          r = sample.rotation;
        const rotationError = Math.min(
          Math.hypot(q.x - r.x, q.y - r.y, q.z - r.z, q.w - r.w),
          Math.hypot(q.x + r.x, q.y + r.y, q.z + r.z, q.w + r.w),
        );
        quaternion = Math.max(quaternion, rotationError);
        error = Math.max(error, rotationError);
        if (row.label.startsWith('layer-properties-')) {
          const sprite = pack.components.find((c) => c.dataType === ComponentData.SpriteRenderer)!;
          const color =
            bindings.spriteColors.get(sprite.id) ?? (sprite.data as SpriteRendererT).color!;
          for (const channel of ['r', 'g', 'b', 'a'] as const)
            colorError = Math.max(colorError, Math.abs(color[channel] - sample.color[channel]));
          const system = pack.components.find((c) => c.dataType === ComponentData.ParticleSystem)!;
          particleError = Math.max(
            particleError,
            Math.abs(bindings.systems.get(system.id)!.main!.speed!.constantMax - sample.speed),
          );
          error = Math.max(error, colorError, particleError);
        }
        pose = Math.max(pose, error);
        if (node.active !== sample.active) {
          active++;
          if (failures.length < 3)
            failures.push({ frame: sample.frame, active: node.active, expected: sample.active });
        }
        for (const [li, s] of sample.layers.entries()) {
          const state = c.getCurrentState(li),
            next = c.getNextState(li),
            t = c.getTransition(li);
          const mismatch =
            (state?.name ?? '') !== s.state ||
            (next?.name ?? '') !== s.next ||
            !!t !== s.transitioning;
          if (mismatch) decisions++;
          time = Math.max(
            time,
            Math.abs((state?.normalizedTime ?? 0) - s.time),
            Math.abs((next?.normalizedTime ?? 0) - s.nextTime),
            Math.abs((t?.normalizedTime ?? 0) - s.progress),
          );
          if ((error > 1e-4 || mismatch) && failures.length < 3)
            failures.push({
              frame: sample.frame,
              error,
              state: state?.name,
              next: next?.name,
              expected: s,
            });
        }
      }
      results.push({
        label: row.label,
        transform,
        quaternion,
        colorError,
        particleError,
        pose,
        time,
        decisions,
        active,
        failures,
        eventMismatch: JSON.stringify(hits) !== JSON.stringify(row.events),
        hits: row.label.startsWith('events-') ? hits : undefined,
      });
    }
    writeFileSync(directory + '/comparison.json', JSON.stringify(results, null, 2));
    expect(
      results.filter(
        (r) => r.pose > 1e-4 || r.time > 1e-5 || r.decisions || r.active || r.eventMismatch,
      ),
    ).toEqual([]);
  },
  120000,
);

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { loadPack } from '../src/loader/load.js';
import { ParticleModuleData as M } from '../src/format/generated/noa/ir/particle-module-data.js';
import type { ParticleSystemT } from '../src/format/generated/noa/ir/particle-system.js';
import type { SubEmittersModuleT } from '../src/format/generated/noa/ir/sub-emitters-module.js';

const indexPath = new URL('../../../../Noa/out/compile-successes.json', import.meta.url);
it.skipIf(!existsSync(indexPath))(
  'reads current native packages and audits linked systems without claiming playback support',
  async () => {
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { outputs: string[] };
    const results = [];
    for (const file of index.outputs) {
      const pack = await loadPack(
        readFileSync(new URL(`../../../../Noa/${file}`, import.meta.url)),
      );
      const systems = pack.components.filter((c) => c.dataType === 3),
        targets = new Set<number>();
      let subEmitters = 0,
        trails = 0,
        emptySlots = 0,
        slots = 0;
      for (const c of systems)
        for (const m of (c.data as ParticleSystemT).modules) {
          if (m.dataType === M.SubEmittersModule) {
            subEmitters++;
            for (const e of (m.data as SubEmittersModuleT).emitters) {
              slots++;
              if (e.systemComponentId) targets.add(e.systemComponentId);
              else emptySlots++;
            }
          }
          if (m.dataType === M.TrailsModule) trails++;
        }
      const missingEmission = [...targets].filter(
        (id) =>
          !(pack.getComponent(id)!.data as ParticleSystemT).modules.some(
            (m) => m.dataType === M.EmissionModule,
          ),
      );
      results.push({ file, subEmitters, trails, slots, emptySlots, missingEmission });
      pack.dispose();
    }
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.subEmitters > 0)).toBe(true);
    expect(results.some((r) => r.trails > 0)).toBe(true);
    if (process.env.NATSUME_CONTROL_PACK_REPORT)
      writeFileSync(
        process.env.NATSUME_CONTROL_PACK_REPORT,
        JSON.stringify({ packages: results.length, results }, null, 2) + '\n',
      );
  },
  30000,
);

import { existsSync, readFileSync } from 'node:fs';
import { it } from 'vitest';

function fixtureUrl(name: string): URL {
  return new URL(`../../../data/unity-baselines/fixtures/${name}`, import.meta.url);
}

export function hasNativeFixture(name: string): boolean {
  return existsSync(fixtureUrl(name));
}

/** Loads local Unity data; missing files register an explicit skipped comparison. */
export function readNativeFixture(name: string): string {
  if (!hasNativeFixture(name)) {
    if (process.env.NATSUME_MEASUREMENTS) throw new Error(`Missing Unity fixture: ${name}`);
    it.skip(`requires local Unity fixture ${name}`, () => {});
    return '{"cases":[]}';
  }
  return readFileSync(fixtureUrl(name), 'utf8');
}

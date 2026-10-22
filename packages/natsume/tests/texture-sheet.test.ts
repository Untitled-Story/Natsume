import { expect, it } from 'vitest';
import { sheetFrame } from '../src/runtime/parameters.js';
import { TextureSheetModuleT } from '../src/format/generated/noa/ir/texture-sheet-module.js';
import { SheetTime } from '../src/format/generated/noa/ir/sheet-time.js';
import { SheetAnimation } from '../src/format/generated/noa/ir/sheet-animation.js';
import { SheetRow } from '../src/format/generated/noa/ir/sheet-row.js';
import { Vec2T } from '../src/format/generated/noa/ir/vec2.js';
import { constant, linear } from './particle-fixtures.js';
import { readNativeFixture } from './native-fixture.js';
import { recordError } from './measurement.js';

const native = JSON.parse(readNativeFixture('unity-compatibility.json')) as {
  cases: {
    label: string;
    samples: { frame: number; remaining: number[]; uv: { x: number; y: number }[] }[];
  }[];
};
for (const c of native.cases.filter(
  (c) => c.label.startsWith('sheet-') && c.label !== 'sheet-no-uv',
))
  it('matches native tile selection ' + c.label, () => {
    const sheet = new TextureSheetModuleT();
    sheet.columns = 4;
    sheet.rows = 3;
    sheet.fps = 6;
    sheet.speedRange = new Vec2T(0, 4);
    sheet.frameOverTime = linear(0, 1);
    sheet.timeMode = c.label.startsWith('sheet-fps')
      ? SheetTime.FPS
      : c.label.startsWith('sheet-speed')
        ? SheetTime.Speed
        : SheetTime.Lifetime;
    if (c.label.includes('row-') || c.label === 'sheet-fps-row') {
      sheet.animation = SheetAnimation.SingleRow;
      sheet.rowMode =
        c.label.endsWith('fixed') || c.label === 'sheet-fps-row'
          ? SheetRow.Fixed
          : c.label.endsWith('random')
            ? SheetRow.Random
            : SheetRow.MeshIndex;
      sheet.row = 1;
    }
    if (c.label === 'sheet-fps-curve') sheet.frameOverTime = constant(0.25);
    if (c.label === 'sheet-fps-start') sheet.startFrame = constant(0.25);
    if (c.label === 'sheet-speed-clamp') sheet.speedRange = new Vec2T(0, 1);
    for (const s of c.samples) {
      const expected = Math.round(s.uv[0]!.x * 4) + (3 - Math.round(s.uv[0]!.y * 3)) * 4;
      const seconds = 2 - s.remaining[0]!;
      const age = seconds;
      const actual = sheetFrame(sheet, age / 2, 0, 0, seconds, Math.sqrt(5.25), 0, 0);
      recordError('textureSheet.' + c.label.slice(6), actual - expected, 'tiles', String(s.frame));
      expect(actual).toBe(expected);
    }
  });

it('holds random rows stable and maps mesh index rows independently of frames', () => {
  const sheet = new TextureSheetModuleT();
  sheet.columns = 4;
  sheet.rows = 3;
  sheet.animation = SheetAnimation.SingleRow;
  sheet.frameOverTime = linear(0, 1);
  sheet.rowMode = SheetRow.Random;
  for (const random of [0, 0.2, 0.5, 0.99])
    for (const age of [0, 0.2, 0.7, 1])
      expect(Math.floor(sheetFrame(sheet, age, 0, 0, 0, 0, random) / 4)).toBe(
        Math.floor(random * 3),
      );
  sheet.rowMode = SheetRow.MeshIndex;
  expect(Math.floor(sheetFrame(sheet, 0.7, 0, 0, 0, 0, 0, 4) / 4)).toBe(1);
});

const thresholds = JSON.parse(readNativeFixture('unity-boundaries.json')) as {
  cases: { label: string; threshold: number }[];
};
it('matches native lifetime tile transition thresholds', () => {
  const sheet = Object.assign(new TextureSheetModuleT(), { columns: 4, rows: 2 });
  sheet.frameOverTime = linear(0, 1);
  for (const c of thresholds.cases.filter((c) => c.label.startsWith('sheet-search-'))) {
    const tile = Math.round(Number(c.label.slice('sheet-search-'.length)) * 8);
    let lo = 0,
      hi = 1;
    for (let i = 0; i < 32; i++) {
      const age = (lo + hi) / 2;
      if (sheetFrame(sheet, age, 0, 0) >= tile) hi = age;
      else lo = age;
    }
    recordError('textureSheet.transitionAge', hi - c.threshold, 's', c.label);
    expect(Math.abs(hi - c.threshold)).toBeLessThan(1e-7);
  }
});

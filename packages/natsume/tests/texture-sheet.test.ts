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
  cases: { label: string; samples: { frame: number; uv: { x: number; y: number }[] }[] }[];
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
      const actual = sheetFrame(sheet, s.frame / 120, 0, 0, s.frame / 60, Math.sqrt(5.25), 0, 0);
      recordError('textureSheet.' + c.label.slice(6), actual - expected, 'tiles', String(s.frame));
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
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

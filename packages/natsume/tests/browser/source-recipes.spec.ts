import { expect, test } from '@playwright/test';

test('preserved HDR recipes keep established mesh and particle color equations', async ({
  page,
}) => {
  await page.goto('/');
  const rows = await page.evaluate(
    async (path) => (await import('/@fs' + path)).comparePreservedRecipes(),
    new URL('./source-recipe-fixture.ts', import.meta.url).pathname,
  );
  expect(rows).toHaveLength(12);
  for (const source of rows.filter((r: { preserved: boolean }) => r.preserved)) {
    const normalized = rows.find(
      (r: { preserved: boolean; hash: string; kind: string }) =>
        !r.preserved && r.hash === source.hash && r.kind === source.kind,
    );
    expect(normalized).toBeDefined();
    expect(source.sourceSurface).toBe(-1);
    expect(source.pixels, `${source.kind}/${source.hash}`).toEqual(normalized.pixels);
    expect(source.pixels[3]).toBeGreaterThan(0);
    expect(source.pixels[3]).toBeLessThan(255);
  }
});

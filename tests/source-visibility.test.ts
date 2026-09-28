import { expect, it } from "vitest";
import { nearbySourceRect } from "../apps/web/src/features/connections/source-visibility";

it("uses the document edge for proximity while keeping the actual source endpoint", () => {
  const viewport = { left: 0, top: 0, width: 1900, height: 900 };
  const pdf = { left: 8, top: 22, width: 1036, height: 800 };
  const source = { left: 184, top: 161, width: 395, height: 20 };
  const card = { left: 1295, top: 222, width: 320, height: 160 };
  expect(nearbySourceRect(card, source, pdf, viewport)).toEqual(source);
  expect(nearbySourceRect({ ...card, left: 1700 }, source, pdf, viewport)).toBeUndefined();
  expect(nearbySourceRect(card, { ...source, top: -30 }, pdf, viewport)).toBeUndefined();
  expect(nearbySourceRect(card, { ...source, top: 15 }, pdf, viewport)).toEqual({ ...source, top: 22, height: 13 });
  expect(nearbySourceRect({ ...card, top: 950 }, source, pdf, viewport)).toBeUndefined();
});

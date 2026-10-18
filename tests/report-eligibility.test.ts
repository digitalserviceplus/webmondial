import assert from "node:assert/strict";
import test from "node:test";
import { hasBeenOnPlatformForMoreThanThreeMonths } from "../lib/report-eligibility";

test("report eligibility requires strictly more than three calendar months", () => {
  const now = new Date("2026-10-18T19:00:00.000Z");

  assert.equal(hasBeenOnPlatformForMoreThanThreeMonths(new Date("2026-07-17T18:59:59.999Z"), now), true);
  assert.equal(hasBeenOnPlatformForMoreThanThreeMonths(new Date("2026-07-18T19:00:00.000Z"), now), false);
  assert.equal(hasBeenOnPlatformForMoreThanThreeMonths(new Date("2026-07-19T19:00:00.000Z"), now), false);
});

test("three-month cutoff clamps to the final day of shorter months", () => {
  const now = new Date("2026-05-31T12:00:00.000Z");

  assert.equal(hasBeenOnPlatformForMoreThanThreeMonths(new Date("2026-02-27T12:00:00.000Z"), now), true);
  assert.equal(hasBeenOnPlatformForMoreThanThreeMonths(new Date("2026-02-28T12:00:00.000Z"), now), false);
});

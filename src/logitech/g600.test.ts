import assert from "node:assert/strict";
import test from "node:test";

import {
  G600_DPI_MAX,
  G600_DPI_MIN,
  G600_DPI_STEP,
  G600_POLLING_RATES,
  G600_PROFILE_SIZE,
  g600ActiveDpi,
  g600ActiveIsLive,
  g600DecodeActive,
  g600DecodeDpi,
  g600DecodePollingRate,
  g600DecodeProfile,
  g600DpiOptions,
  g600EncodeDpi,
  g600EncodePollingRate,
  g600EncodeProfile,
  g600EncodeSetDpiSlot,
  g600EncodeSetProfile,
  g600ProfileReportId,
  g600WithDpiStage,
  g600WithPollingRate,
} from "./g600.ts";

/** Wired G600 F4 capture. */
const PROFILE1_HEX = `
f4 00 00 00 02 04 00 00 00 00 00 00 00 01 10 18 20 40
00 00 00 00 00 00 01 00 00 00 00 00 00 01 00 00 02 00
00 03 00 00 04 00 00 05 00 00 17 00 00 13 00 00 14 00
00 00 00 1e 00 00 1f 00 00 20 00 00 21 00 00 22 00 00
23 00 00 24 00 00 25 00 00 26 00 00 27 00 00 2d 00 00
2e 00 00 00 01 00 00 02 00 00 03 00 00 04 00 00 05 00
00 17 00 00 13 00 00 14 00 00 00 01 1e 00 01 1f 00 01
20 00 01 21 00 01 22 00 01 23 00 01 24 00 01 25 00 01
26 00 01 27 00 01 2d 00 01 2e
`;

function fromHex(text: string): Uint8Array {
  const bytes = text.trim().split(/\s+/).map((part) => Number.parseInt(part, 16));
  return Uint8Array.from(bytes);
}

test("the captured F4 profile is 154 bytes and round-trips", () => {
  const raw = fromHex(PROFILE1_HEX);
  assert.equal(raw.length, G600_PROFILE_SIZE);
  const profile = g600DecodeProfile(raw);
  assert.equal(profile.reportId, 0xf4);
  assert.equal(profile.ledEffect, "cycle");
  assert.equal(profile.ledDurationSec, 4);
  assert.equal(profile.pollingRateHz, 1000);
  assert.equal(profile.gshiftDpi, 0);
  assert.equal(profile.defaultSlot, 1);
  assert.deepEqual(profile.dpiStages, [800, 1200, 1600, 3200]);
  assert.equal(profile.buttons[0]?.code, 0x01);
  assert.equal(profile.buttons[5]?.code, 0x17);
  assert.equal(profile.buttons[8]?.key, 0x1e);
  assert.equal(profile.gshiftButtons[8]?.modifier, 0x01);
  assert.deepEqual([...g600EncodeProfile(profile)], [...raw]);
});

test("the captured F0 active report is profile 1, DPI slot 0", () => {
  const active = g600DecodeActive(Uint8Array.from([0xf0, 0x18, 0x00, 0x00]));
  assert.deepEqual(active, { profileIndex: 1, dpiSlot: 0 });
  assert.equal(g600ActiveDpi(g600DecodeProfile(fromHex(PROFILE1_HEX)), active.dpiSlot), 800);
  assert.equal(g600ActiveIsLive(Uint8Array.from([0xf0, 0x18, 0x00, 0x00])), true);
  assert.equal(g600ActiveIsLive(Uint8Array.from([0xf0, 0x10, 0x00, 0x00])), false);
});

test("SET profile / DPI slot match libratbag's F0 command bytes", () => {
  assert.deepEqual([...g600EncodeSetProfile(1)], [0x90, 0x00, 0x00]);
  assert.deepEqual([...g600EncodeSetDpiSlot(0)], [0x40, 0x00, 0x00]);
  assert.deepEqual([...g600EncodeSetDpiSlot(2)], [0x44, 0x00, 0x00]);
  assert.equal(g600ProfileReportId(1), 0xf4);
});

test("DPI and polling encode with the G600 integer mapping", () => {
  assert.equal(g600EncodeDpi(800), 0x10);
  assert.equal(g600DecodeDpi(0x10), 800);
  assert.equal(g600EncodeDpi(0), 0);
  assert.equal(g600DecodePollingRate(0), 1000);
  assert.equal(g600EncodePollingRate(1000), 0);
  assert.equal(g600DecodePollingRate(6), 142);
  assert.equal(g600EncodePollingRate(142), 6);
  assert.deepEqual(g600DpiOptions()[0], G600_DPI_MIN);
  assert.equal(g600DpiOptions().at(-1), G600_DPI_MAX);
  assert.equal(g600DpiOptions()[1]! - g600DpiOptions()[0]!, G600_DPI_STEP);
  assert.ok((G600_POLLING_RATES as readonly number[]).includes(1000));
});

test("an empty profile does not invent an 800 DPI fallback", () => {
  const empty = g600DecodeProfile(new Uint8Array(G600_PROFILE_SIZE));
  assert.equal(g600ActiveDpi(empty, 0), 0);
  assert.deepEqual(empty.dpiStages, [0, 0, 0, 0]);
});

test("profile patches keep unknown bytes", () => {
  const profile = g600DecodeProfile(fromHex(PROFILE1_HEX));
  const faster = g600WithPollingRate(profile, 500);
  const encoded = g600EncodeProfile(faster);
  assert.equal(encoded[11], 1);
  assert.deepEqual([...encoded.subarray(18, 31)], [...profile.unknown2]);
  const staged = g600WithDpiStage(profile, 0, 1600);
  assert.equal(staged.dpiStages[0], 1600);
  assert.equal(g600EncodeProfile(staged)[14], 0x20);
});

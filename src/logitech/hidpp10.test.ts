import assert from "node:assert/strict";
import test from "node:test";

import {
  HIDPP10_LONG_PAYLOAD,
  HIDPP10_SHORT_PAYLOAD,
  HIDPP10_SUB,
  decodeHidpp10Dpi,
  decodeHidpp10RefreshRateHz,
  decodeHidpp10Reply,
  encodeHidpp10Long,
  encodeHidpp10Short,
  hidpp10RegisterName,
  isHidpp10Get,
  isHidpp10Set,
} from "./hidpp10.js";

test("short GET_REGISTER is six bytes: index, sub-id, address, three params", () => {
  const report = encodeHidpp10Short(0xff, HIDPP10_SUB.getRegister, 0x63);
  assert.equal(report.length, HIDPP10_SHORT_PAYLOAD);
  assert.deepEqual([...report], [0xff, 0x81, 0x63, 0, 0, 0]);
});

test("SET_REGISTER carries the three value bytes", () => {
  const report = encodeHidpp10Short(0xff, HIDPP10_SUB.setRegister, 0x64, [0x01, 0, 0]);
  assert.deepEqual([...report], [0xff, 0x80, 0x64, 0x01, 0, 0]);
});

test("long GET_LONG_REGISTER is 19 bytes with the address in byte 2", () => {
  const report = encodeHidpp10Long(0xff, HIDPP10_SUB.getLongRegister, 0x0f, [0x01]);
  assert.equal(report.length, HIDPP10_LONG_PAYLOAD);
  assert.equal(report[0], 0xff);
  assert.equal(report[1], 0x83);
  assert.equal(report[2], 0x0f);
  assert.equal(report[3], 0x01);
  assert.equal(report[18], 0);
});

test("a matching success reply yields the parameter bytes", () => {
  const reply = decodeHidpp10Reply(Uint8Array.from([0xff, 0x81, 0x63, 0x20, 0x03, 0x00]), 0x10, 0xff, 0x81, 0x63);
  assert.equal(reply?.kind, "ok");
  if (reply?.kind !== "ok") return;
  assert.deepEqual([...reply.parameters], [0x20, 0x03, 0x00]);
});

test("a HID++ 1.0 0x8F error names the original sub-id and address", () => {
  const reply = decodeHidpp10Reply(
    Uint8Array.from([0xff, 0x8f, 0x81, 0x00, 0x02, 0x00]),
    0x10,
    0xff,
    0x81,
    0x00,
  );
  assert.equal(reply?.kind, "error");
  if (reply?.kind !== "error") return;
  assert.equal(reply.code, 0x02);
  assert.match(reply.message, /HID\+\+ 1\.0: invalid address/);
});

test("HID++ 2.0-shaped traffic is not treated as a HID++ 1.0 reply", () => {
  // Root getFeature reply: [index, feature, function+swid, ...]
  const report = Uint8Array.from([0xff, 0x00, 0x05, 0x00, 0x03, 0x00]);
  assert.equal(decodeHidpp10Reply(report, 0x10, 0xff, 0x81, 0x00), null);
});

test("a reply for a different register is ignored", () => {
  const report = Uint8Array.from([0xff, 0x81, 0x64, 0x00, 0x00, 0x00]);
  assert.equal(decodeHidpp10Reply(report, 0x10, 0xff, 0x81, 0x63), null);
});

test("refresh-rate byte mapping matches public hidpp10 tables", () => {
  assert.equal(decodeHidpp10RefreshRateHz(0), 1000);
  assert.equal(decodeHidpp10RefreshRateHz(1), 500);
  assert.equal(decodeHidpp10RefreshRateHz(2), 250);
  assert.equal(decodeHidpp10RefreshRateHz(3), 125);
  assert.equal(decodeHidpp10RefreshRateHz(4), null);
});

test("DPI is little-endian and rejects empty or implausible values", () => {
  assert.equal(decodeHidpp10Dpi(Uint8Array.from([0x20, 0x03])), 800);
  assert.equal(decodeHidpp10Dpi(Uint8Array.from([0x00, 0x00])), null);
  assert.equal(decodeHidpp10Dpi(Uint8Array.from([0x20])), null);
});

test("known register names cover the G-series probe list", () => {
  assert.equal(hidpp10RegisterName(0x63), "current_resolution");
  assert.equal(hidpp10RegisterName(0x64), "usb_refresh_rate");
  assert.equal(hidpp10RegisterName(0x99), null);
});

test("GET vs SET is decided by the sub-id, not the address", () => {
  assert.equal(isHidpp10Get(HIDPP10_SUB.getRegister), true);
  assert.equal(isHidpp10Get(HIDPP10_SUB.getLongRegister), true);
  assert.equal(isHidpp10Set(HIDPP10_SUB.setRegister), true);
  assert.equal(isHidpp10Set(HIDPP10_SUB.getRegister), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { LGS_USAGE, LGS_USAGE_PAGE, LOGITECH_G600_PRODUCT_ID } from "@openmouse/protocol/logitech";
import { LogitechLgsHidClient } from "./lgs-hid.ts";
import { LogitechHidppClient } from "./hidpp.ts";

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
  return Uint8Array.from(text.trim().split(/\s+/).map((part) => Number.parseInt(part, 16)));
}

function lgsCollection(): HIDCollectionInfo {
  return {
    usagePage: LGS_USAGE_PAGE,
    usage: LGS_USAGE,
    type: 1,
    children: [],
    featureReports: [0xf0, 0xf3, 0xf4, 0xf5].map((reportId) => ({ reportId, items: [] })),
    inputReports: [{ reportId: 0x80, items: [] }],
    outputReports: [],
  } as unknown as HIDCollectionInfo;
}

function hidppCollection(): HIDCollectionInfo {
  return {
    usagePage: 0xff00,
    usage: 1,
    type: 1,
    children: [],
    featureReports: [],
    inputReports: [{ reportId: 0x10, items: [] }],
    outputReports: [{ reportId: 0x10, items: [] }],
  } as unknown as HIDCollectionInfo;
}

function fakeG600(initial?: Partial<Record<number, Uint8Array>>): {
  device: HIDDevice;
  reports: Map<number, Uint8Array>;
  sent: Array<{ reportId: number; payload: Uint8Array }>;
} {
  const profile1 = fromHex(PROFILE1_HEX);
  const reports = new Map<number, Uint8Array>([
    [0xf0, Uint8Array.from([0xf0, 0x18, 0x00, 0x00])],
    [0xf4, profile1],
    ...(initial ? Object.entries(initial).map(([id, bytes]) => [Number(id), bytes] as const) : []),
  ]);
  const sent: Array<{ reportId: number; payload: Uint8Array }> = [];
  let opened = false;
  const device = {
    vendorId: 0x046d,
    productId: LOGITECH_G600_PRODUCT_ID,
    productName: "Gaming Mouse G600",
    get opened() { return opened; },
    collections: [lgsCollection()],
    open: async () => { opened = true; },
    close: async () => { opened = false; },
    receiveFeatureReport: async (reportId: number) => {
      const stored = reports.get(reportId);
      if (!stored) throw new Error(`missing feature 0x${reportId.toString(16)}`);
      return new DataView(stored.buffer, stored.byteOffset, stored.byteLength);
    },
    sendFeatureReport: async (reportId: number, data: BufferSource) => {
      const payload = data instanceof Uint8Array
        ? Uint8Array.from(data)
        : new Uint8Array(data instanceof ArrayBuffer ? data : (data as ArrayBufferView).buffer);
      sent.push({ reportId, payload });
      if (reportId === 0xf0) {
        const cmd = payload[0] ?? 0;
        const prev = reports.get(0xf0) ?? Uint8Array.from([0xf0, 0x18, 0x00, 0x00]);
        let packed = prev[1] ?? 0;
        if (cmd & 0x80) {
          packed = (packed & 0x0f) | (((cmd >> 4) & 0x07) << 4) | 0x08;
        } else if (cmd & 0x40) {
          packed = (packed & 0xf1) | (((cmd >> 1) & 0x03) << 1) | 0x08;
        }
        reports.set(0xf0, Uint8Array.from([0xf0, packed, 0x00, 0x00]));
        return;
      }
      const stored = new Uint8Array(1 + payload.length);
      stored[0] = reportId;
      stored.set(payload, 1);
      reports.set(reportId, stored);
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HIDDevice;
  return { device, reports, sent };
}

test("the LGS client claims the G600 vendor collection and HID++ does not", () => {
  const { device } = fakeG600();
  assert.equal(LogitechLgsHidClient.isSupported(device), true);
  assert.equal(LogitechHidppClient.isSupported(device), false);
});

test("HID++ still claims a G502-style collection and LGS does not", () => {
  const device = {
    vendorId: 0x046d,
    productId: 0xc08b,
    collections: [hidppCollection()],
  } as HIDDevice;
  assert.equal(LogitechLgsHidClient.isSupported(device), false);
  assert.equal(LogitechHidppClient.isSupported(device), true);
});

test("a G600 PID on a HID++ collection is not stolen by HID++", () => {
  const device = {
    vendorId: 0x046d,
    productId: LOGITECH_G600_PRODUCT_ID,
    collections: [hidppCollection()],
  } as HIDDevice;
  assert.equal(LogitechLgsHidClient.isSupported(device), false);
  assert.equal(LogitechHidppClient.isSupported(device), false);
});

test("readStatus decodes the captured G600 active profile", async () => {
  const { device } = fakeG600();
  const status = await new LogitechLgsHidClient(device).readStatus();
  assert.equal(status.brand, "Logitech");
  assert.equal(status.name, "G600");
  assert.equal(status.ui?.family, "logitech-lgs");
  assert.equal(status.activeProfile, 2);
  assert.equal(status.profileCount, 3);
  assert.equal(status.dpi, 800);
  assert.deepEqual(status.dpiStages, [800, 1200, 1600, 3200]);
  assert.equal(status.activeDpiStage, 0);
  assert.equal(status.pollingRateHz, 1000);
  assert.equal(status.lighting?.mode, "Cycling");
});

test("setPollingRate rewrites the active profile and keeps unknown bytes", async () => {
  const { device, reports } = fakeG600();
  const client = new LogitechLgsHidClient(device);
  assert.equal(await client.setPollingRate(500), 500);
  const written = reports.get(0xf4);
  assert.ok(written);
  assert.equal(written[11], 1);
  assert.equal(written[14], 0x10, "DPI slot 0 left at 800");
});

test("setDpi patches the active slot and reloads live DPI after the write", async () => {
  const { device, sent } = fakeG600();
  const client = new LogitechLgsHidClient(device);
  assert.equal(await client.setDpi(1600), 1600);
  const status = await client.readStatus();
  assert.equal(status.dpi, 1600);
  assert.equal(status.dpiStages?.[0], 1600);
  const profileWrite = sent.find((entry) => entry.reportId === 0xf4);
  assert.ok(profileWrite);
  assert.equal(profileWrite.payload.length, 153, "WebHID SET omits the report id");
  assert.equal(profileWrite.payload[0], 0x00, "first payload byte is LED, not 0xF4");
  assert.equal(profileWrite.payload[13], 0x20, "DPI slot 0 is payload offset 13 (wire byte 14)");
  const liveReload = sent.find((entry) => entry.reportId === 0xf0);
  assert.ok(liveReload);
  assert.equal(liveReload.payload.length, 153);
  assert.equal(liveReload.payload[0], 0x40, "F0 reselects the current DPI slot after the profile write");
});

test("setDpiStages writes every slot in one profile SET", async () => {
  const { device, sent } = fakeG600();
  const client = new LogitechLgsHidClient(device);
  assert.deepEqual(await client.setDpiStages([400, 800, 1600, 3200]), [400, 800, 1600, 3200]);
  const profileWrites = sent.filter((entry) => entry.reportId === 0xf4);
  assert.equal(profileWrites.length, 1);
  assert.deepEqual([...profileWrites[0]!.payload.subarray(13, 17)], [0x08, 0x10, 0x20, 0x40]);
});

test("setProfile writes the F0 switch then the default DPI slot", async () => {
  const profile0 = fromHex(PROFILE1_HEX);
  profile0[0] = 0xf3;
  const { device, reports } = fakeG600({
    0xf3: profile0,
    0xf0: Uint8Array.from([0xf0, 0x18, 0x00, 0x00]),
  });
  const client = new LogitechLgsHidClient(device);
  assert.equal(await client.setProfile(1), 1);
  const active = reports.get(0xf0);
  assert.ok(active);
  assert.equal(active[1], 0x08, "profile 0 slot 0 with live-config bit set");
});

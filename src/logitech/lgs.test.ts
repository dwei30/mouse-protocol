import assert from "node:assert/strict";
import test from "node:test";

import {
  LGS_USAGE,
  LGS_USAGE_PAGE,
  LGS_VENDOR_ID,
  LOGITECH_G600_PRODUCT_ID,
  hasLgsCollection,
  isLgsProduct,
  lgsFeaturePayload,
  lgsProduct,
  lgsWebHidFeatureBytes,
} from "./lgs.ts";

function collection(usagePage: number, usage: number): HIDCollectionInfo {
  return {
    usagePage,
    usage,
    type: 1,
    children: [],
    featureReports: [{ reportId: 0xf0, items: [] }],
    inputReports: [],
    outputReports: [],
  } as unknown as HIDCollectionInfo;
}

test("the G600 is catalogued as the g600-profile LGS family", () => {
  assert.equal(LOGITECH_G600_PRODUCT_ID, 0xc24a);
  assert.equal(isLgsProduct(0xc24a), true);
  assert.equal(isLgsProduct(0xc08f), false);
  assert.equal(lgsProduct(0xc24a)?.family, "g600-profile");
  assert.equal(lgsProduct(0xc24a)?.model, "G600");
});

test("the LGS collection is the 0xFF80 vendor page, not HID++", () => {
  const lgs = {
    vendorId: LGS_VENDOR_ID,
    productId: LOGITECH_G600_PRODUCT_ID,
    collections: [collection(LGS_USAGE_PAGE, LGS_USAGE)],
  } as HIDDevice;
  const hidpp = {
    vendorId: LGS_VENDOR_ID,
    productId: LOGITECH_G600_PRODUCT_ID,
    collections: [collection(0xff00, 1)],
  } as HIDDevice;
  assert.equal(hasLgsCollection(lgs), true);
  assert.equal(hasLgsCollection(hidpp), false);
});

test("WebHID feature writes omit the report-id byte", () => {
  assert.deepEqual([...lgsFeaturePayload(Uint8Array.from([0xf0, 0x90, 0, 0]))], [0x90, 0, 0]);
});

test("WebHID SET copies into a standalone report-sized buffer", () => {
  const payload = Uint8Array.from([0x40, 0x00, 0x00]);
  const bytes = lgsWebHidFeatureBytes(payload, 153);
  assert.equal(bytes.byteLength, 153);
  assert.equal(bytes.byteOffset, 0);
  assert.equal(bytes.buffer.byteLength, 153);
  assert.equal(bytes[0], 0x40);
  assert.equal(bytes[152], 0);
});

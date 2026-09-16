/** LGS vendor protocol on 0xFF80 — not HID++. Catalog plus family codecs. */

export const LGS_VENDOR_ID = 0x046d;
export const LGS_USAGE_PAGE = 0xff80;
export const LGS_USAGE = 0x80;

export type LgsFamily = "g600-profile";

export interface LgsProduct {
  model: string;
  family: LgsFamily;
  verified: boolean;
}

export const LOGITECH_G600_PRODUCT_ID = 0xc24a;

export const LGS_PRODUCTS: ReadonlyMap<number, LgsProduct> = new Map([
  [LOGITECH_G600_PRODUCT_ID, { model: "G600", family: "g600-profile", verified: true }],
]);

export function lgsProduct(productId: number): LgsProduct | undefined {
  return LGS_PRODUCTS.get(productId);
}

export function isLgsProduct(productId: number): boolean {
  return LGS_PRODUCTS.has(productId);
}

function collectionHasLgsPage(collection: HIDCollectionInfo): boolean {
  if (collection.usagePage === LGS_USAGE_PAGE) return true;
  return collection.children.some(collectionHasLgsPage);
}

/** True for the LGS vendor collection, not the pointer interface. */
export function hasLgsCollection(device: HIDDevice): boolean {
  return device.collections.some(collectionHasLgsPage);
}

/** WebHID SET omits the report-id byte that GET includes. */
export function lgsFeaturePayload(report: Uint8Array): Uint8Array {
  return report.length > 0 ? report.subarray(1) : report;
}

/** Standalone copy so SET is not a subarray of the 154-byte encode. */
export function lgsWebHidFeatureBytes(payload: Uint8Array, size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(payload.subarray(0, size));
  return bytes;
}

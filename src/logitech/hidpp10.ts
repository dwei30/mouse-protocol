/** HID++ 1.0 register GET/SET on 0x10 / 0x11. LGS mice are not this protocol. */

export const HIDPP_SHORT_REPORT_ID = 0x10;
export const HIDPP_LONG_REPORT_ID = 0x11;

/** Short HID++ payload (WebHID sendReport omits the report id). */
export const HIDPP10_SHORT_PAYLOAD = 6;
/** Long HID++ payload. */
export const HIDPP10_LONG_PAYLOAD = 19;

export const HIDPP10_SUB = {
  setRegister: 0x80,
  getRegister: 0x81,
  setLongRegister: 0x82,
  getLongRegister: 0x83,
  setVeryLongRegister: 0x84,
  getVeryLongRegister: 0x85,
  error: 0x8f,
} as const;

/** HID++ 1.0 error codes, reported in byte 4 of a 0x8F error response. */
const HIDPP10_ERRORS: Readonly<Record<number, string>> = {
  0x01: "invalid command",
  0x02: "invalid address",
  0x03: "invalid value",
  0x04: "connection request failed",
  0x05: "too many devices",
  0x06: "already exists",
  0x07: "device busy",
  0x08: "unknown device",
  0x09: "resource error",
  0x0a: "request unavailable",
  0x0b: "unsupported parameter value",
  0x0c: "wrong PIN code",
};

export function hidpp10ErrorMessage(code: number): string {
  const reason = HIDPP10_ERRORS[code];
  return reason
    ? `The mouse rejected that setting (HID++ 1.0: ${reason}).`
    : `The mouse rejected that setting (HID++ 1.0 error 0x${code.toString(16).padStart(2, "0")}).`;
}

export type Hidpp10SubId = (typeof HIDPP10_SUB)[keyof typeof HIDPP10_SUB];

export const HIDPP10_REGISTERS: ReadonlyArray<{ address: number; name: string }> = [
  { address: 0x00, name: "enable_reports" },
  { address: 0x01, name: "individual_features" },
  { address: 0x07, name: "battery_status" },
  { address: 0x0d, name: "battery_mileage" },
  { address: 0x0f, name: "profile" },
  { address: 0x51, name: "led_status" },
  { address: 0x54, name: "led_intensity" },
  { address: 0x57, name: "led_color" },
  { address: 0x61, name: "optical_sensor_settings" },
  { address: 0x63, name: "current_resolution" },
  { address: 0x64, name: "usb_refresh_rate" },
];

const REGISTER_NAMES: ReadonlyMap<number, string> = new Map(
  HIDPP10_REGISTERS.map((entry) => [entry.address, entry.name]),
);

export function hidpp10RegisterName(address: number): string | null {
  return REGISTER_NAMES.get(address) ?? null;
}

export function isHidpp10Get(subId: number): boolean {
  return subId === HIDPP10_SUB.getRegister
    || subId === HIDPP10_SUB.getLongRegister
    || subId === HIDPP10_SUB.getVeryLongRegister;
}

export function isHidpp10Set(subId: number): boolean {
  return subId === HIDPP10_SUB.setRegister
    || subId === HIDPP10_SUB.setLongRegister
    || subId === HIDPP10_SUB.setVeryLongRegister;
}

export function encodeHidpp10Short(
  deviceIndex: number,
  subId: number,
  address: number,
  parameters: readonly number[] = [],
): Uint8Array {
  return Uint8Array.from([
    deviceIndex & 0xff,
    subId & 0xff,
    address & 0xff,
    parameters[0] ?? 0,
    parameters[1] ?? 0,
    parameters[2] ?? 0,
  ]);
}

export function encodeHidpp10Long(
  deviceIndex: number,
  subId: number,
  address: number,
  parameters: readonly number[] = [],
): Uint8Array {
  const report = new Uint8Array(HIDPP10_LONG_PAYLOAD);
  report[0] = deviceIndex & 0xff;
  report[1] = subId & 0xff;
  report[2] = address & 0xff;
  for (let i = 0; i < Math.min(parameters.length, 16); i += 1) {
    report[3 + i] = parameters[i] & 0xff;
  }
  return report;
}

export type Hidpp10Reply =
  | { kind: "ok"; reportId: number; deviceIndex: number; subId: number; address: number; parameters: Uint8Array }
  | { kind: "error"; reportId: number; deviceIndex: number; subId: number; address: number; code: number; message: string };

/**
 * Classify an input report as the reply to a HID++ 1.0 request, or null when
 * it is a notification / HID++ 2.0 traffic / unrelated noise.
 *
 * Success: [device, subId, address, ...params]
 * Error:   [device, 0x8F, subId, address, code, ...]
 */
export function decodeHidpp10Reply(
  report: Uint8Array,
  reportId: number,
  deviceIndex: number,
  subId: number,
  address: number,
): Hidpp10Reply | null {
  if (report.length < 5) return null;
  if (report[0] !== deviceIndex) return null;
  if (report[1] === HIDPP10_SUB.error && report[2] === subId && report[3] === address) {
    const code = report[4] ?? 0;
    return {
      kind: "error",
      reportId,
      deviceIndex,
      subId,
      address,
      code,
      message: hidpp10ErrorMessage(code),
    };
  }
  if (report[1] === subId && report[2] === address) {
    return {
      kind: "ok",
      reportId,
      deviceIndex,
      subId,
      address,
      parameters: report.slice(3),
    };
  }
  return null;
}

/**
 * libratbag maps USB refresh-rate register 0x64 as 0=1000, 1=500, 2=250, 3=125.
 */
export function decodeHidpp10RefreshRateHz(byte: number): number | null {
  switch (byte) {
    case 0: return 1000;
    case 1: return 500;
    case 2: return 250;
    case 3: return 125;
    default: return null;
  }
}

/** Little-endian 16-bit DPI from the first two parameter bytes of register 0x63. */
export function decodeHidpp10Dpi(parameters: Uint8Array): number | null {
  if (parameters.length < 2) return null;
  const dpi = parameters[0] | (parameters[1] << 8);
  if (dpi === 0 || dpi > 20_000) return null;
  return dpi;
}

export function formatHidpp10Bytes(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

/** G600: F0 active, F3/F4/F5 154-byte profiles. Do not GET F6. */

export const G600_PROFILE_SIZE = 154;
export const G600_FEATURE_PAYLOAD_SIZE = G600_PROFILE_SIZE - 1;
export const G600_ACTIVE_SIZE = 4;
export const G600_STAGE_COUNT = 4;
export const G600_BUTTON_COUNT = 20;
export const G600_LOCK_PRIMARY_COUNT = 2;
export const G600_DPI_MIN = 200;
export const G600_DPI_MAX = 8200;
export const G600_DPI_STEP = 50;
export const G600_PROFILE_COUNT = 3;
export const G600_PROFILE_REPORT_IDS = [0xf3, 0xf4, 0xf5] as const;
export const G600_ACTIVE_REPORT_ID = 0xf0;

/** 1000 / (frequency byte + 1). */
export const G600_POLLING_RATES = [125, 142, 166, 200, 250, 333, 500, 1000] as const;

export type G600LedEffect = "solid" | "breathe" | "cycle";

export interface G600Button {
  code: number;
  modifier: number;
  key: number;
}

export interface G600Rgb {
  r: number;
  g: number;
  b: number;
}

export interface G600Profile {
  reportId: number;
  led: G600Rgb;
  ledEffect: G600LedEffect;
  ledDurationSec: number;
  unknown1: Uint8Array;
  pollingRateHz: number;
  gshiftDpi: number;
  /** 1-based default DPI slot; 0 means none / unused profile. */
  defaultSlot: number;
  dpiStages: number[];
  unknown2: Uint8Array;
  buttons: G600Button[];
  gshiftColor: G600Rgb;
  gshiftButtons: G600Button[];
}

export interface G600Active {
  profileIndex: number;
  dpiSlot: number;
}

const LED_EFFECT_BYTE: Record<G600LedEffect, number> = {
  solid: 0x00,
  breathe: 0x01,
  cycle: 0x02,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rgb(bytes: Uint8Array, offset: number): G600Rgb {
  return { r: bytes[offset] ?? 0, g: bytes[offset + 1] ?? 0, b: bytes[offset + 2] ?? 0 };
}

function writeRgb(bytes: Uint8Array, offset: number, color: G600Rgb): void {
  bytes[offset] = color.r & 0xff;
  bytes[offset + 1] = color.g & 0xff;
  bytes[offset + 2] = color.b & 0xff;
}

function buttonAt(bytes: Uint8Array, offset: number): G600Button {
  return { code: bytes[offset] ?? 0, modifier: bytes[offset + 1] ?? 0, key: bytes[offset + 2] ?? 0 };
}

function writeButton(bytes: Uint8Array, offset: number, button: G600Button): void {
  bytes[offset] = button.code & 0xff;
  bytes[offset + 1] = button.modifier & 0xff;
  bytes[offset + 2] = button.key & 0xff;
}

export function g600ProfileReportId(profileIndex: number): number {
  const reportId = G600_PROFILE_REPORT_IDS[profileIndex];
  if (reportId === undefined) {
    throw new Error(`G600 profile index must be 0–${G600_PROFILE_COUNT - 1}.`);
  }
  return reportId;
}

export function g600EncodeDpi(dpi: number): number {
  if (dpi <= 0) return 0;
  const snapped = Math.round(dpi / G600_DPI_STEP) * G600_DPI_STEP;
  return clamp(snapped, G600_DPI_MIN, G600_DPI_MAX) / G600_DPI_STEP;
}

export function g600DecodeDpi(byte: number): number {
  if (byte <= 0) return 0;
  return clamp(byte * G600_DPI_STEP, G600_DPI_MIN, G600_DPI_MAX);
}

export function g600DpiOptions(): number[] {
  const options: number[] = [];
  for (let dpi = G600_DPI_MIN; dpi <= G600_DPI_MAX; dpi += G600_DPI_STEP) options.push(dpi);
  return options;
}

export function g600DecodePollingRate(frequency: number): number {
  return Math.floor(1000 / (clamp(frequency, 0, 7) + 1));
}

export function g600EncodePollingRate(hz: number): number {
  if (!Number.isFinite(hz) || hz <= 0) {
    throw new Error(`Unsupported G600 polling rate: ${hz}.`);
  }
  return clamp(Math.floor(1000 / hz) - 1, 0, 7);
}

function decodeEffect(byte: number): G600LedEffect {
  if (byte === 0x01) return "breathe";
  if (byte === 0x02) return "cycle";
  return "solid";
}

export function g600DecodeActive(bytes: Uint8Array): G600Active {
  if (bytes.length < 2) throw new Error("G600 active report is too short.");
  const packed = bytes[1] ?? 0;
  return {
    profileIndex: (packed >> 4) & 0x0f,
    dpiSlot: (packed >> 1) & 0x03,
  };
}

/** F0 bit 3; a profile SET clears it for ~500 ms. */
export function g600ActiveIsLive(bytes: Uint8Array): boolean {
  return ((bytes[1] ?? 0) & 0x08) !== 0;
}

export function g600EncodeSetProfile(profileIndex: number): Uint8Array {
  if (profileIndex < 0 || profileIndex >= G600_PROFILE_COUNT) {
    throw new Error(`G600 profile index must be 0–${G600_PROFILE_COUNT - 1}.`);
  }
  return Uint8Array.from([0x80 | (profileIndex << 4), 0x00, 0x00]);
}

export function g600EncodeSetDpiSlot(slot: number): Uint8Array {
  if (slot < 0 || slot >= G600_STAGE_COUNT) {
    throw new Error(`G600 DPI slot must be 0–${G600_STAGE_COUNT - 1}.`);
  }
  return Uint8Array.from([0x40 | (slot << 1), 0x00, 0x00]);
}

export function g600DecodeProfile(bytes: Uint8Array): G600Profile {
  if (bytes.length < G600_PROFILE_SIZE) {
    throw new Error(`G600 profile report is ${bytes.length} bytes; ${G600_PROFILE_SIZE} are required.`);
  }
  const buttons: G600Button[] = [];
  const gshiftButtons: G600Button[] = [];
  for (let i = 0; i < G600_BUTTON_COUNT; i += 1) {
    buttons.push(buttonAt(bytes, 31 + i * 3));
    gshiftButtons.push(buttonAt(bytes, 94 + i * 3));
  }
  return {
    reportId: bytes[0] ?? 0,
    led: rgb(bytes, 1),
    ledEffect: decodeEffect(bytes[4] ?? 0),
    ledDurationSec: bytes[5] ?? 0,
    unknown1: bytes.slice(6, 11),
    pollingRateHz: g600DecodePollingRate(bytes[11] ?? 0),
    gshiftDpi: g600DecodeDpi(bytes[12] ?? 0),
    defaultSlot: bytes[13] ?? 0,
    dpiStages: [14, 15, 16, 17].map((offset) => g600DecodeDpi(bytes[offset] ?? 0)),
    unknown2: bytes.slice(18, 31),
    buttons,
    gshiftColor: rgb(bytes, 91),
    gshiftButtons,
  };
}

export function g600EncodeProfile(profile: G600Profile): Uint8Array {
  const bytes = new Uint8Array(G600_PROFILE_SIZE);
  bytes[0] = profile.reportId & 0xff;
  writeRgb(bytes, 1, profile.led);
  bytes[4] = LED_EFFECT_BYTE[profile.ledEffect];
  bytes[5] = clamp(profile.ledDurationSec, 0, 0x0f);
  bytes.set(profile.unknown1.subarray(0, 5), 6);
  bytes[11] = g600EncodePollingRate(profile.pollingRateHz);
  bytes[12] = g600EncodeDpi(profile.gshiftDpi);
  bytes[13] = clamp(profile.defaultSlot, 0, G600_STAGE_COUNT);
  for (let i = 0; i < G600_STAGE_COUNT; i += 1) {
    bytes[14 + i] = g600EncodeDpi(profile.dpiStages[i] ?? 0);
  }
  bytes.set(profile.unknown2.subarray(0, 13), 18);
  for (let i = 0; i < G600_BUTTON_COUNT; i += 1) {
    writeButton(bytes, 31 + i * 3, profile.buttons[i] ?? { code: 0, modifier: 0, key: 0 });
    writeButton(bytes, 94 + i * 3, profile.gshiftButtons[i] ?? { code: 0, modifier: 0, key: 0 });
  }
  writeRgb(bytes, 91, profile.gshiftColor);
  return bytes;
}

export function g600WithPollingRate(profile: G600Profile, hz: number): G600Profile {
  if (!(G600_POLLING_RATES as readonly number[]).includes(hz)) {
    throw new Error(`G600 polling rate must be one of ${G600_POLLING_RATES.join(", ")} Hz.`);
  }
  return { ...profile, pollingRateHz: hz };
}

export function g600WithDpiStage(profile: G600Profile, slot: number, dpi: number): G600Profile {
  if (slot < 0 || slot >= G600_STAGE_COUNT) {
    throw new Error(`G600 DPI slot must be 0–${G600_STAGE_COUNT - 1}.`);
  }
  const dpiStages = profile.dpiStages.slice();
  while (dpiStages.length < G600_STAGE_COUNT) dpiStages.push(0);
  dpiStages[slot] = dpi <= 0 ? 0 : g600DecodeDpi(g600EncodeDpi(dpi));
  const defaultSlot = profile.defaultSlot === 0 && dpiStages[slot] > 0 ? slot + 1 : profile.defaultSlot;
  return { ...profile, dpiStages, defaultSlot };
}

export function g600ActiveDpi(profile: G600Profile, dpiSlot: number): number {
  const fromSlot = profile.dpiStages[dpiSlot] ?? 0;
  if (fromSlot > 0) return fromSlot;
  return profile.dpiStages.find((stage) => stage > 0) ?? 0;
}

export type G600ButtonLayer = "primary" | "g-shift";

export const G600_BUTTON_ACTIONS = [
  "Disabled", "Left click", "Right click", "Middle click", "Back", "Forward",
  "Next DPI", "Previous DPI", "Cycle DPI", "DPI Shift", "Cycle profiles", "G-Shift",
] as const;

export type G600NamedAction = (typeof G600_BUTTON_ACTIONS)[number];
export type G600ButtonAction = G600NamedAction | "Keyboard shortcut" | "Custom";

export const G600_BUTTON_NAMES = [
  "Left click", "Right click", "Wheel click", "Back", "Forward", "G-Shift",
  "G7", "G8", "G9", "G10", "G11", "G12", "G13", "G14", "G15",
  "G16", "G17", "G18", "G19", "G20",
] as const;

const NAMED_CODE: Record<Exclude<G600NamedAction, "Disabled">, number> = {
  "Left click": 0x01,
  "Right click": 0x02,
  "Middle click": 0x03,
  Back: 0x04,
  Forward: 0x05,
  "Next DPI": 0x11,
  "Previous DPI": 0x12,
  "Cycle DPI": 0x13,
  "DPI Shift": 0x15,
  "Cycle profiles": 0x14,
  "G-Shift": 0x17,
};

export interface G600ButtonAssignment {
  layer: G600ButtonLayer;
  button: number;
  action: G600ButtonAction;
  raw: number[];
}

export function g600DecodeButtonAction(button: G600Button): G600ButtonAction {
  if (button.code === 0 && button.modifier === 0 && button.key === 0) return "Disabled";
  if (button.code === 0) return "Keyboard shortcut";
  const named = (Object.entries(NAMED_CODE) as Array<[Exclude<G600NamedAction, "Disabled">, number]>)
    .find(([, code]) => code === button.code)?.[0];
  return named ?? "Custom";
}

export function g600EncodeNamedAction(action: G600NamedAction): G600Button {
  if (action === "Disabled") return { code: 0, modifier: 0, key: 0 };
  return { code: NAMED_CODE[action], modifier: 0, key: 0 };
}

export function g600EncodeKeyboard(key: number, modifiers: number): G600Button {
  return { code: 0, modifier: modifiers & 0xff, key: key & 0xff };
}

export function g600WithButton(
  profile: G600Profile,
  layer: G600ButtonLayer,
  index: number,
  button: G600Button,
): G600Profile {
  if (index < 0 || index >= G600_BUTTON_COUNT) {
    throw new Error(`G600 button index must be 0–${G600_BUTTON_COUNT - 1}.`);
  }
  const key = layer === "g-shift" ? "gshiftButtons" : "buttons";
  const next = profile[key].slice();
  while (next.length < G600_BUTTON_COUNT) next.push({ code: 0, modifier: 0, key: 0 });
  next[index] = button;
  return { ...profile, [key]: next };
}

export function g600ButtonAssignments(profile: G600Profile): G600ButtonAssignment[] {
  const layerOf = (layer: G600ButtonLayer, buttons: G600Button[]): G600ButtonAssignment[] =>
    buttons.slice(0, G600_BUTTON_COUNT).map((entry, button) => ({
      layer,
      button,
      action: g600DecodeButtonAction(entry),
      raw: [entry.code, entry.modifier, entry.key],
    }));
  return [...layerOf("primary", profile.buttons), ...layerOf("g-shift", profile.gshiftButtons)];
}

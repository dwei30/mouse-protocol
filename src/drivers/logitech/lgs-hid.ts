import type { MouseLighting, MouseLightingMode, MouseStatus } from "../mouse-types.ts";
import {
  G600_ACTIVE_REPORT_ID,
  G600_DPI_MAX,
  G600_DPI_MIN,
  G600_DPI_STEP,
  G600_FEATURE_PAYLOAD_SIZE,
  G600_POLLING_RATES,
  G600_PROFILE_COUNT,
  G600_STAGE_COUNT,
  LGS_VENDOR_ID,
  g600ActiveDpi,
  g600ActiveIsLive,
  g600DecodeActive,
  g600DecodeProfile,
  g600DpiOptions,
  g600EncodeProfile,
  g600EncodeSetDpiSlot,
  g600EncodeSetProfile,
  g600ProfileReportId,
  g600WithDpiStage,
  g600WithPollingRate,
  hasLgsCollection,
  lgsFeaturePayload,
  lgsProduct,
  lgsWebHidFeatureBytes,
  type G600Profile,
  type G600Rgb,
  type LgsProduct,
} from "@openmouse/protocol/logitech";

const LIGHTING_MODES: readonly MouseLightingMode[] = ["Off", "Static", "Breathing single", "Cycling"];
const COLOR_MODES: readonly MouseLightingMode[] = ["Static", "Breathing single"];

function hexColor(color: G600Rgb): string {
  return `#${[color.r, color.g, color.b].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function parseHexColor(value: string | null): G600Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(value ?? "");
  if (!match) return { r: 0, g: 0, b: 0 };
  const n = Number.parseInt(match[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function lightingFromProfile(profile: G600Profile): MouseLighting {
  const black = profile.led.r === 0 && profile.led.g === 0 && profile.led.b === 0;
  let mode: MouseLightingMode = "Static";
  if (profile.ledEffect === "breathe") mode = "Breathing single";
  else if (profile.ledEffect === "cycle") mode = "Cycling";
  else if (black) mode = "Off";
  return {
    zone: "Logo",
    modes: LIGHTING_MODES,
    mode,
    color: hexColor(profile.led),
    color2: null,
    colorModes: COLOR_MODES,
    dualColorModes: [],
    reactiveModes: [],
    speeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    speed: profile.ledDurationSec || null,
  };
}

function profileWithLighting(profile: G600Profile, lighting: MouseLighting): G600Profile {
  const mode = lighting.mode;
  if (!mode || !(LIGHTING_MODES as readonly string[]).includes(mode)) {
    throw new Error(`Unsupported LGS lighting mode: ${mode}.`);
  }
  if (mode === "Off") {
    return { ...profile, led: { r: 0, g: 0, b: 0 }, ledEffect: "solid", ledDurationSec: 0 };
  }
  const duration = mode === "Static" ? profile.ledDurationSec : Math.min(15, Math.max(0, lighting.speed ?? 4));
  return {
    ...profile,
    led: parseHexColor(lighting.color),
    ledEffect: mode === "Cycling" ? "cycle" : mode === "Breathing single" ? "breathe" : "solid",
    ledDurationSec: duration,
  };
}

function asBytes(view: DataView | ArrayBuffer): Uint8Array {
  if (view instanceof DataView) {
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  return new Uint8Array(view);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const LIVE_CONFIG_POLL_MS = 50;
const LIVE_CONFIG_TIMEOUT_MS = 800;

/** WebHID client for LGS (`0xFF80`). Family comes from the catalog. */
export class LogitechLgsHidClient {
  readonly device: HIDDevice;
  private queue: Promise<unknown> = Promise.resolve();
  private writtenProfiles = new Map<number, G600Profile>();

  constructor(device: HIDDevice) {
    this.device = device;
  }

  static isSupported(device: HIDDevice): boolean {
    if (device.vendorId !== LGS_VENDOR_ID) return false;
    if (!lgsProduct(device.productId)) return false;
    return hasLgsCollection(device);
  }

  static supportScore(device: HIDDevice): number {
    return this.isSupported(device) ? 8 : 0;
  }

  private product(): LgsProduct {
    const product = lgsProduct(this.device.productId);
    if (!product) throw new Error("This Logitech device is not in the LGS catalog.");
    return product;
  }

  async getDpiOptions(): Promise<number[]> {
    return this.product().family === "g600-profile" ? g600DpiOptions() : [];
  }

  get supportedPollingRates(): number[] {
    return this.product().family === "g600-profile" ? [...G600_POLLING_RATES] : [];
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
  }

  async close(): Promise<void> {
    if (this.device.opened) await this.device.close();
  }

  private run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async getReport(reportId: number): Promise<Uint8Array> {
    await this.open();
    return asBytes(await this.device.receiveFeatureReport(reportId));
  }

  private async setReport(reportId: number, payload: Uint8Array): Promise<void> {
    await this.open();
    const bytes = lgsWebHidFeatureBytes(payload, G600_FEATURE_PAYLOAD_SIZE);
    await this.device.sendFeatureReport(reportId, bytes.buffer as ArrayBuffer);
  }

  private async waitUntilActiveLive(): Promise<Uint8Array> {
    const deadline = Date.now() + LIVE_CONFIG_TIMEOUT_MS;
    let raw = await this.getReport(G600_ACTIVE_REPORT_ID);
    while (!g600ActiveIsLive(raw) && Date.now() < deadline) {
      await delay(LIVE_CONFIG_POLL_MS);
      raw = await this.getReport(G600_ACTIVE_REPORT_ID);
    }
    return raw;
  }

  private async readG600Profile(index: number): Promise<G600Profile> {
    const reportId = g600ProfileReportId(index);
    const cached = this.writtenProfiles.get(reportId);
    if (cached) return cached;
    return g600DecodeProfile(await this.getReport(reportId));
  }

  private async writeG600Profile(profile: G600Profile): Promise<G600Profile> {
    const encoded = g600EncodeProfile(profile);
    await this.setReport(encoded[0] ?? profile.reportId, lgsFeaturePayload(encoded));
    this.writtenProfiles.set(profile.reportId, profile);
    const live = g600DecodeActive(await this.waitUntilActiveLive());
    await this.setReport(G600_ACTIVE_REPORT_ID, g600EncodeSetDpiSlot(live.dpiSlot));
    return profile;
  }

  async readStatus(): Promise<MouseStatus> {
    return this.run(async () => {
      this.writtenProfiles.clear();
      const product = this.product();
      if (product.family !== "g600-profile") {
        throw new Error(`LGS family ${product.family} is not implemented yet.`);
      }
      const active = g600DecodeActive(await this.getReport(G600_ACTIVE_REPORT_ID));
      const profile = await this.readG600Profile(active.profileIndex);
      const dpi = g600ActiveDpi(profile, active.dpiSlot);
      const lighting = lightingFromProfile(profile);
      return {
        brand: "Logitech",
        name: product.model,
        ui: {
          family: "logitech-lgs",
          settingsReady: true,
          hideUnsupportedPollingRates: true,
          hideProcessingCard: true,
          defaultDisplayName: product.model,
          dpiStageEditor: {
            maxStages: G600_STAGE_COUNT,
            countEditable: false,
            minDpi: G600_DPI_MIN,
            maxDpi: G600_DPI_MAX,
            stepDpi: G600_DPI_STEP,
          },
        },
        batteryPercent: null,
        batteryState: "Unknown",
        dpi,
        dpiY: dpi,
        dpiStages: profile.dpiStages,
        activeDpiStage: active.dpiSlot,
        pollingRateHz: profile.pollingRateHz,
        supportedPollingRates: [...G600_POLLING_RATES],
        activeProfile: active.profileIndex + 1,
        profileCount: G600_PROFILE_COUNT,
        connectionType: "Wired",
        liftOffDistance: null,
        supportedLiftOffDistances: [],
        lighting,
        firmware: [],
      };
    });
  }

  async setProfile(profile: number): Promise<number> {
    return this.run(async () => {
      const index = profile - 1;
      await this.setReport(G600_ACTIVE_REPORT_ID, g600EncodeSetProfile(index));
      const stored = await this.readG600Profile(index);
      const defaultSlot = stored.defaultSlot > 0 ? stored.defaultSlot - 1 : 0;
      await this.setReport(G600_ACTIVE_REPORT_ID, g600EncodeSetDpiSlot(defaultSlot));
      return index + 1;
    });
  }

  async setActiveDpiStage(stage: number): Promise<number> {
    return this.run(async () => {
      await this.setReport(G600_ACTIVE_REPORT_ID, g600EncodeSetDpiSlot(stage));
      return stage;
    });
  }

  async setPollingRate(hz: number): Promise<number> {
    return this.run(async () => {
      const active = g600DecodeActive(await this.getReport(G600_ACTIVE_REPORT_ID));
      const written = await this.writeG600Profile(
        g600WithPollingRate(await this.readG600Profile(active.profileIndex), hz),
      );
      return written.pollingRateHz;
    });
  }

  async setDpi(dpi: number): Promise<number> {
    return this.run(async () => {
      const active = g600DecodeActive(await this.getReport(G600_ACTIVE_REPORT_ID));
      const written = await this.writeG600Profile(
        g600WithDpiStage(await this.readG600Profile(active.profileIndex), active.dpiSlot, dpi),
      );
      return g600ActiveDpi(written, active.dpiSlot);
    });
  }

  async setDpiStageValue(stage: number, dpi: number): Promise<number> {
    return this.run(async () => {
      const active = g600DecodeActive(await this.getReport(G600_ACTIVE_REPORT_ID));
      const written = await this.writeG600Profile(
        g600WithDpiStage(await this.readG600Profile(active.profileIndex), stage, dpi),
      );
      return written.dpiStages[stage] ?? 0;
    });
  }

  async setDpiStages(stages: number[]): Promise<number[]> {
    return this.run(async () => {
      const active = g600DecodeActive(await this.getReport(G600_ACTIVE_REPORT_ID));
      let profile = await this.readG600Profile(active.profileIndex);
      const count = Math.min(stages.length, G600_STAGE_COUNT);
      for (let slot = 0; slot < count; slot += 1) {
        profile = g600WithDpiStage(profile, slot, stages[slot] ?? 0);
      }
      return (await this.writeG600Profile(profile)).dpiStages;
    });
  }

  async setLighting(lighting: MouseLighting): Promise<MouseLighting> {
    return this.run(async () => {
      const active = g600DecodeActive(await this.getReport(G600_ACTIVE_REPORT_ID));
      const written = await this.writeG600Profile(
        profileWithLighting(await this.readG600Profile(active.profileIndex), lighting),
      );
      return lightingFromProfile(written);
    });
  }
}

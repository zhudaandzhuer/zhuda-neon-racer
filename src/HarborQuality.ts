export type QualityTier = "performance" | "balanced" | "high";
export type QualityMode = "auto" | QualityTier;
export interface QualityPreference { mode: QualityMode; targetFPS: 30 | 60 }
export const QUALITY_STORAGE = "zhuda.harbor.quality.v1";
export const QUALITY_TIERS: QualityTier[] = ["performance", "balanced", "high"];
export const QUALITY_PROFILES = {
  performance: { dpr: 0.8, pixels: 800_000, shadow: 0, shadowDistance: 0, cascades: 1, reflection: [0, 0], reflectionFPS: 0, ao: false, bloom: false, taa: false },
  balanced: { dpr: 1.2, pixels: 1_800_000, shadow: 2048, shadowDistance: 85, cascades: 2, reflection: [640, 400], reflectionFPS: 15, ao: false, bloom: true, taa: true },
  high: { dpr: 2, pixels: 8_294_400, shadow: 4096, shadowDistance: 130, cascades: 4, reflection: [1280, 800], reflectionFPS: 60, ao: true, bloom: true, taa: true },
} as const;
export function isQualityMode(value: unknown): value is QualityMode {
  return value === "auto" || QUALITY_TIERS.includes(value as QualityTier);
}
export function readQualityPreference(raw: string | null): QualityPreference {
  try {
    const p = JSON.parse(raw || "null");
    if (p && isQualityMode(p.mode) && (p.targetFPS === 30 || p.targetFPS === 60))
      return { mode: p.mode, targetFPS: p.targetFPS };
  } catch {}
  return { mode: "auto", targetFPS: 60 };
}
export function initialQuality(hints: { memory?: number; cores?: number; coarse?: boolean }): QualityTier {
  return hints.coarse || (hints.memory !== undefined && hints.memory <= 4) ||
    (hints.cores !== undefined && hints.cores <= 4) ? "performance" : "balanced";
}
/** Budget raster work within the SDK's minimum supported DPR of .5. */
export function qualityDPR(tier: QualityTier, width: number, height: number, nativeDPR: number, scale = 1) {
  const p = QUALITY_PROFILES[tier];
  return Math.max(0.5, Math.min(nativeDPR || 1, p.dpr, Math.sqrt(p.pixels / Math.max(1, width * height))) * scale);
}
/** Uses engine render cadence, never GPU-time claims. Hysteresis prevents rapid toggling. */
export class HarborQualityGovernor {
  tier: QualityTier;
  scale = 1;
  fps = 0;
  p90 = 0;
  reason = "Measuring performance…";
  private samples: number[] = [];
  private windowTime = 0;
  private ignoreUntil = 0;
  private cooldownUntil = 0;
  private upgradeAfter = 0;
  private stable = 0;
  constructor(public preference: QualityPreference, private initial: QualityTier, now = 0) {
    this.tier = preference.mode === "auto" ? initial : preference.mode;
    this.resetMeasurements(now, 4000);
  }
  select(preference: QualityPreference, now: number) {
    this.preference = preference;
    this.tier = preference.mode === "auto" ? this.initial : preference.mode;
    this.scale = 1;
    this.fps = 0; this.p90 = 0;
    this.cooldownUntil = now + 6000;
    this.upgradeAfter = now + 20000;
    this.reason = preference.mode === "auto" ? "Measuring performance…" : "Quality is fixed to your selection.";
    this.resetMeasurements(now, 4000);
  }
  resetMeasurements(now: number, warmup = 2500) {
    this.samples = []; this.windowTime = 0; this.stable = 0;
    this.ignoreUntil = now + warmup;
  }
  sample(ms: number, now: number, visible = true): boolean {
    if (!visible || !Number.isFinite(ms) || ms <= 0 || ms > 5000) {
      this.resetMeasurements(now); return false;
    }
    if (now < this.ignoreUntil) return false;
    this.samples.push(ms); this.windowTime += ms;
    if (this.windowTime < 2500 || this.samples.length < 3) return false;
    this.fps = 1000 * this.samples.length / this.windowTime;
    this.p90 = [...this.samples].sort((a,b)=>a-b)[Math.floor(this.samples.length * .9)];
    const duration = this.windowTime, budget = 1000 / this.preference.targetFPS;
    this.samples = []; this.windowTime = 0;
    if (this.preference.mode !== "auto") return false;
    const slow = this.p90 > budget * 1.35 || this.fps < this.preference.targetFPS * .78;
    this.stable = !slow && this.p90 <= budget * 1.15 ? this.stable + duration : 0;
    if (now < this.cooldownUntil) return false;
    const index = QUALITY_TIERS.indexOf(this.tier);
    if (slow && (index > 0 || this.scale > .7)) {
      if (index > 0) this.tier = QUALITY_TIERS[index - 1];
      else this.scale = Math.max(.7, Math.round((this.scale - .15) * 100) / 100);
      this.reason = "Reduced quality to keep driving responsive.";
      this.cooldownUntil = now + 8000;
      this.upgradeAfter = now + 90000;
    } else if (this.stable >= 20000 && now >= this.upgradeAfter && (index < 2 || this.scale < 1)) {
      if (this.scale < 1) this.scale = Math.min(1, Math.round((this.scale + .15) * 100) / 100);
      else this.tier = QUALITY_TIERS[index + 1];
      this.reason = "Trying sharper quality after stable performance.";
      this.cooldownUntil = now + 15000;
    } else {
      this.reason = slow ? "Lowest quality reached; this scene is still demanding." : "Performance is stable at the current quality.";
      return false;
    }
    this.resetMeasurements(now);
    return true;
  }
}

import { clamp } from "./Tracks";
export const SAVE_KEY = "zhuda.neon-apex.v1";
export type Save = {
  version: 1;
  credits: number;
  stars: number[];
  best: (number | null)[];
  upgrades: number[];
  car: number;
  muted: boolean;
  auto: boolean;
  reduced: boolean;
  races: number;
};
export const freshSave = (): Save => ({
  version: 1,
  credits: 0,
  stars: [0, 0, 0, 0],
  best: [null, null, null, null],
  upgrades: [0, 0, 0],
  car: 0,
  muted: false,
  auto: true,
  reduced: false,
  races: 0,
});
export const totalStars = (s: Save) => s.stars.reduce((a, b) => a + b, 0);
export const unlocked = (s: Save, index: number) =>
  index === 0 || s.stars[index - 1] > 0;
const integer = (v: any, max: number) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.floor(clamp(v, 0, max))
    : 0;
export function parseSave(raw: string | null): Save {
  const s = freshSave();
  if (!raw) return s;
  try {
    const v = JSON.parse(raw);
    if (!v || v.version !== 1) return s;
    s.credits = integer(v.credits, 10000000);
    s.races = integer(v.races, 1000000);
    s.stars = s.stars.map((_, i) => integer(v.stars?.[i], 3));
    // Progress is sequential; damaged saves cannot bypass missing podiums.
    for (let i = 1; i < 4; i++) if (s.stars[i - 1] === 0) s.stars[i] = 0;
    s.best = s.best.map((_, i) =>
      typeof v.best?.[i] === "number" &&
      Number.isFinite(v.best[i]) &&
      v.best[i] > 0
        ? v.best[i]
        : null,
    );
    s.upgrades = s.upgrades.map((_, i) => integer(v.upgrades?.[i], 3));
    s.car = integer(v.car, 2);
    if (totalStars(s) < [0, 4, 8][s.car]) s.car = 0;
    for (const k of ["muted", "auto", "reduced"] as const)
      if (typeof v[k] === "boolean") s[k] = v[k];
  } catch {}
  return s;
}
export const upgradeCost = (level: number) => 300 + level * 250;
export function buyUpgrade(save: Save, index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index > 2) return false;
  const level = save.upgrades[index],
    cost = upgradeCost(level);
  if (level >= 3 || save.credits < cost) return false;
  save.credits -= cost;
  save.upgrades[index]++;
  return true;
}

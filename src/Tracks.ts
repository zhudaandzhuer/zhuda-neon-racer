export type Point = { x: number; y: number };
export type Sample = Point & { angle: number; s: number };
export type Track = {
  id: number;
  name: string;
  subtitle: string;
  district: string;
  color: string;
  laps: number;
  limit: number;
  gold: number;
  width: number;
  ai: number;
  controls: number[][];
  points: Sample[];
  length: number;
  pads: number[];
};

const definitions = [
  {
    name: "港灣暖身",
    subtitle: "HARBOR RUN",
    district: "01 / 濱海物流區",
    color: "#4ce7d0",
    laps: 1,
    limit: 60,
    gold: 19,
    width: 202,
    ai: 215,
    controls: [
      [550, 480],
      [1150, 480],
      [1620, 640],
      [1730, 1060],
      [1500, 1430],
      [850, 1500],
      [420, 1280],
      [330, 830],
    ],
    pads: [0.16, 0.64],
  },
  {
    name: "城際迴路",
    subtitle: "MIDNIGHT LOOP",
    district: "02 / 中央金融區",
    color: "#ffb774",
    laps: 2,
    limit: 110,
    gold: 43,
    width: 190,
    ai: 238,
    controls: [
      [500, 450],
      [1100, 400],
      [1630, 500],
      [1790, 880],
      [1390, 1060],
      [1640, 1450],
      [1170, 1670],
      [650, 1510],
      [350, 1120],
      [540, 820],
    ],
    pads: [0.1, 0.47, 0.81],
  },
  {
    name: "山脊連彎",
    subtitle: "RIDGE RUNNER",
    district: "03 / 北線山麓",
    color: "#ba9cff",
    laps: 2,
    limit: 125,
    gold: 52,
    width: 180,
    ai: 245,
    controls: [
      [450, 440],
      [1050, 360],
      [1650, 510],
      [1710, 890],
      [1230, 800],
      [1050, 1100],
      [1530, 1330],
      [1390, 1640],
      [780, 1640],
      [340, 1400],
      [590, 1050],
      [310, 770],
    ],
    pads: [0.13, 0.51, 0.82],
  },
  {
    name: "核心封環",
    subtitle: "REACTOR FINALE",
    district: "04 / 能源禁區",
    color: "#ff6b8b",
    laps: 3,
    limit: 160,
    gold: 75,
    width: 178,
    ai: 254,
    controls: [
      [500, 400],
      [1120, 400],
      [1650, 540],
      [1780, 950],
      [1530, 1290],
      [1700, 1630],
      [1180, 1750],
      [710, 1520],
      [350, 1680],
      [240, 1200],
      [570, 940],
      [300, 670],
    ],
    pads: [0.13, 0.39, 0.68],
  },
];
export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
export const wrap = (v: number, total: number) => ((v % total) + total) % total;
export const angleDelta = (a: number, b: number) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));

function makeTrack(d: (typeof definitions)[number], id: number): Track {
  const points: Sample[] = [],
    c = d.controls,
    n = c.length;
  for (let i = 0; i < n; i++) {
    const a = c[(i + n - 1) % n],
      b = c[i],
      e = c[(i + 1) % n],
      f = c[(i + 2) % n];
    for (let j = 0; j < 28; j++) {
      const t = j / 28,
        t2 = t * t,
        t3 = t2 * t;
      const axis = (k: number) =>
        0.5 *
        (2 * b[k] +
          (-a[k] + e[k]) * t +
          (2 * a[k] - 5 * b[k] + 4 * e[k] - f[k]) * t2 +
          (-a[k] + 3 * b[k] - 3 * e[k] + f[k]) * t3);
      points.push({ x: axis(0), y: axis(1), angle: 0, s: 0 });
    }
  }
  let length = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    p.s = length;
    p.angle = Math.atan2(q.y - p.y, q.x - p.x);
    length += Math.hypot(q.x - p.x, q.y - p.y);
  });
  return { ...d, id, points, length };
}
export const TRACKS: Track[] = definitions.map(makeTrack);

export function at(track: Track, distance: number, lane = 0): Sample {
  const s = wrap(distance, track.length),
    ps = track.points;
  let lo = 0,
    hi = ps.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ps[mid].s > s) hi = mid - 1;
    else lo = mid;
  }
  const a = ps[lo],
    b = ps[(lo + 1) % ps.length],
    len = (lo === ps.length - 1 ? track.length : b.s) - a.s,
    t = (s - a.s) / len;
  return {
    x: a.x + (b.x - a.x) * t - Math.sin(a.angle) * lane,
    y: a.y + (b.y - a.y) * t + Math.cos(a.angle) * lane,
    angle: a.angle,
    s,
  };
}
export function nearest(track: Track, x: number, y: number) {
  let best = { x: 0, y: 0, s: 0, angle: 0, distance: Infinity, lateral: 0 };
  for (let i = 0; i < track.points.length; i++) {
    const a = track.points[i],
      b = track.points[(i + 1) % track.points.length],
      dx = b.x - a.x,
      dy = b.y - a.y,
      len2 = dx * dx + dy * dy;
    const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / len2, 0, 1),
      px = a.x + t * dx,
      py = a.y + t * dy,
      dist = Math.hypot(x - px, y - py);
    if (dist < best.distance)
      best = {
        x: px,
        y: py,
        s: a.s + t * Math.sqrt(len2),
        angle: a.angle,
        distance: dist,
        lateral: ((x - px) * -dy + (y - py) * dx) / Math.sqrt(len2),
      };
  }
  return best;
}
export function mapPath(track: Track, w = 260, h = 150, pad = 14): string {
  const xs = track.points.map((p) => p.x),
    ys = track.points.map((p) => p.y),
    minX = Math.min(...xs),
    minY = Math.min(...ys);
  const scale = Math.min(
    (w - pad * 2) / (Math.max(...xs) - minX),
    (h - pad * 2) / (Math.max(...ys) - minY),
  );
  const ox = (w - (Math.max(...xs) - minX) * scale) / 2,
    oy = (h - (Math.max(...ys) - minY) * scale) / 2;
  return (
    track.points
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${(ox + (p.x - minX) * scale).toFixed(1)},${(oy + (p.y - minY) * scale).toFixed(1)}`,
      )
      .join(" ") + "Z"
  );
}

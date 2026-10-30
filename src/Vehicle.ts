import { clamp } from "./Tracks";

// Simulation units are 0.1 m; the imported sedan is 5.48 m × 2.40 m.
export const VEHICLE_RADIUS = 12;
export const VEHICLE_HALF_SEGMENT = 15.4;
type Pose = { x: number; y: number; angle: number };

/** Closest points between the two longitudinal capsule segments. */
export function vehicleContact(a: Pose, b: Pose) {
  const h = VEHICLE_HALF_SEGMENT;
  const ax = Math.cos(a.angle), ay = Math.sin(a.angle);
  const bx = Math.cos(b.angle), by = Math.sin(b.angle);
  const p = { x: a.x - ax * h, y: a.y - ay * h };
  const q = { x: b.x - bx * h, y: b.y - by * h };
  const d = { x: ax * h * 2, y: ay * h * 2 };
  const e = { x: bx * h * 2, y: by * h * 2 };
  const rx = p.x - q.x, ry = p.y - q.y;
  const dd = d.x * d.x + d.y * d.y;
  const ee = e.x * e.x + e.y * e.y;
  const de = d.x * e.x + d.y * e.y;
  const dr = d.x * rx + d.y * ry;
  const er = e.x * rx + e.y * ry;
  const denominator = dd * ee - de * de;
  let s = denominator > 1e-8 ? clamp((de * er - dr * ee) / denominator, 0, 1) : 0;
  let t = (de * s + er) / ee;
  if (t < 0) { t = 0; s = clamp(-dr / dd, 0, 1); }
  else if (t > 1) { t = 1; s = clamp((de - dr) / dd, 0, 1); }
  let x = q.x + e.x * t - p.x - d.x * s;
  let y = q.y + e.y * t - p.y - d.y * s;
  const distance = Math.hypot(x, y);
  if (distance >= VEHICLE_RADIUS * 2) return null;
  if (distance < 1e-6) {
    x = b.x - a.x;
    y = b.y - a.y;
    const centerDistance = Math.hypot(x, y);
    if (centerDistance > 1e-6) { x /= centerDistance; y /= centerDistance; }
    else { x = -ay; y = ax; }
  } else { x /= distance; y /= distance; }
  return { x, y, penetration: VEHICLE_RADIUS * 2 - distance };
}

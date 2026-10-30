/** Consumer-owned arcade vehicle dynamics. Coordinates: metres, +Y up, heading 0 = +Z. */
export interface DriveInput {
  throttle: number;
  steer: number;
  handbrake: boolean;
  boost: boolean;
}
export interface DriveObstacle {
  minX: number; maxX: number; minZ: number; maxZ: number;
  minY: number; maxY: number;
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const approach = (n: number, target: number, rate: number, dt: number) =>
  n + clamp(target - n, -rate * dt, rate * dt);
export const wrapAngle = (n: number) => Math.atan2(Math.sin(n), Math.cos(n));

export function harborHeight(x: number, z: number): number | null {
  if (Math.abs(x) <= 8 && z >= -60 && z <= 180) return 0;
  if (Math.abs(x) <= 8 && z > 180 && z <= 234)
    return -4.994 * (z - 180) / 54;
  if (x >= -75.5 && x <= 75 && z >= 234 && z <= 260) return -4.994;
  if (x >= -75.5 && x <= -20.5 && z >= -65 && z <= 260) return -4.994;
  if (x >= 17 && x <= 75 && z >= -50 && z <= 260) return -4.994;
  return null;
}

/** Capsule footprint; samples front/rear over actual paving and solid obstacles. */
export function harborDriveable(x: number, z: number, yaw: number,
  obstacles: DriveObstacle[] = []): boolean {
  const y = harborHeight(x, z);
  if (y === null) return false;
  const forwardX = Math.sin(yaw), forwardZ = Math.cos(yaw), radius = 1.06;
  for (const along of [-1.65, 0, 1.65]) {
    const cx = x + along * forwardX, cz = z + along * forwardZ;
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const h = harborHeight(cx + radius * Math.cos(angle), cz + radius * Math.sin(angle));
      if (h === null || Math.abs(h - y) > 0.65) return false;
    }
    for (const b of obstacles) {
      if (b.maxY < y + 0.1 || b.minY > y + 1.55) continue;
      const dx = cx - clamp(cx, b.minX, b.maxX), dz = cz - clamp(cz, b.minZ, b.maxZ);
      if (dx * dx + dz * dz < radius * radius) return false;
    }
  }
  return true;
}

export class HarborVehicle {
  x = 0; z = 0; y = 0; yaw = 0;
  vx = 0; vz = 0; speed = 0; steering = 0; yawRate = 0;
  roll = 0; pitch = 0; groundPitch = 0; wheelTravel = 0;
  acceleration = 0; lateralAcceleration = 0; contacts = 0;
  elapsed = 0;
  private accumulator = 0;
  private pitchVelocity = 0;
  private rollVelocity = 0;
  constructor(readonly obstacles: DriveObstacle[] = []) {}
  reset(x: number, z: number, yaw: number) {
    Object.assign(this, {x, z, yaw, y: harborHeight(x, z) ?? -4.994,
      vx: 0, vz: 0, speed: 0, steering: 0, yawRate: 0, roll: 0, pitch: 0,
      groundPitch: 0, wheelTravel: 0, acceleration: 0, lateralAcceleration: 0,
      accumulator: 0, pitchVelocity: 0, rollVelocity: 0});
    this.elapsed = 0;
  }
  /** Fixed steps prevent different frame rates from changing grip, turning or suspension. */
  update(dt: number, input: DriveInput) {
    this.accumulator += clamp(dt, 0, 0.25);
    while (this.accumulator + 1e-9 >= 1 / 120) {
      this.step(1 / 120, input);
      this.accumulator -= 1 / 120;
    }
  }
  private step(dt: number, input: DriveInput) {
    this.elapsed += dt;
    const throttle = clamp(input.throttle, -1, 1), steer = clamp(input.steer, -1, 1);
    let fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let longitudinal = this.vx * fx + this.vz * fz;
    const oldSpeed = longitudinal, absolute = Math.abs(longitudinal);
    // Opposite pedal first brakes; holding it continues into reverse once stopped.
    let force = throttle === 0 ? 0 : Math.sign(throttle) *
      (Math.sign(throttle) !== Math.sign(longitudinal) && absolute > 0.15
        ? 11 : throttle > 0 ? (input.boost ? 8 : 6.1) : 3.8);
    if (input.handbrake) longitudinal = approach(longitudinal, 0, 8.5, dt);
    else longitudinal += force * dt;
    const drag = 0.32 + 0.0038 * longitudinal * longitudinal;
    longitudinal = approach(longitudinal, 0, drag, dt);
    longitudinal = clamp(longitudinal, -7, input.boost ? 36 : 27);
    const limit = 0.58 / (1 + absolute / 19);
    this.steering = approach(this.steering, steer * limit, 1.7, dt);
    const requestedRate = longitudinal / 3.37 * Math.tan(this.steering) *
      (input.handbrake ? 1.5 : 1);
    const maxRate = 8.5 / Math.max(absolute, 2);
    this.yawRate += (clamp(requestedRate, -maxRate, maxRate) - this.yawRate) *
      (1 - Math.exp(-8 * dt));
    if (absolute < 0.02 && !throttle) this.yawRate = 0;
    const previousYaw = this.yaw;
    this.yaw = wrapAngle(this.yaw + this.yawRate * dt);
    // Retain world momentum while tyres pull it toward the chassis direction.
    const momentumX = this.vx + fx * (longitudinal - oldSpeed),
      momentumZ = this.vz + fz * (longitudinal - oldSpeed);
    fx = Math.sin(this.yaw); fz = Math.cos(this.yaw);
    const lateral = momentumX * fz - momentumZ * fx;
    const grip = Math.exp(-(input.handbrake ? 1.3 : 9.5) * dt);
    this.vx = fx * longitudinal + fz * lateral * grip;
    this.vz = fz * longitudinal - fx * lateral * grip;
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    if (harborDriveable(nx, nz, this.yaw, this.obstacles)) {
      this.x = nx; this.z = nz;
    } else {
      this.contacts++;
      // Slide along a wall; remove the incoming component instead of teleporting.
      const canX = harborDriveable(nx, this.z, this.yaw, this.obstacles);
      const canZ = harborDriveable(this.x, nz, this.yaw, this.obstacles);
      if (canX) this.x = nx; else this.vx *= -0.1;
      if (canZ) this.z = nz; else this.vz *= -0.1;
      if (!harborDriveable(this.x, this.z, this.yaw, this.obstacles)) this.yaw = previousYaw;
      this.yawRate *= 0.5;
    }
    this.y = harborHeight(this.x, this.z) ?? this.y;
    this.speed = this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
    this.wheelTravel += this.speed * dt;
    this.acceleration = clamp((this.speed - oldSpeed) / dt, -12, 10);
    this.lateralAcceleration = this.speed * this.yawRate;
    const pitchTarget = -this.acceleration * 0.0036;
    const rollTarget = -clamp(this.lateralAcceleration, -9, 9) * 0.006;
    this.pitchVelocity += ((pitchTarget - this.pitch) * 100 - this.pitchVelocity * 18) * dt;
    this.rollVelocity += ((rollTarget - this.roll) * 100 - this.rollVelocity * 18) * dt;
    this.pitch += this.pitchVelocity * dt;
    this.roll += this.rollVelocity * dt;
    const front = harborHeight(this.x + Math.sin(this.yaw) * 1.5, this.z + Math.cos(this.yaw) * 1.5) ?? this.y;
    const rear = harborHeight(this.x - Math.sin(this.yaw) * 1.5, this.z - Math.cos(this.yaw) * 1.5) ?? this.y;
    this.groundPitch = -Math.atan2(front - rear, 3);
  }
  snapshot() {
    return {x:this.x, y:this.y, z:this.z, yaw:this.yaw, speed:this.speed,
      steering:this.steering, yawRate:this.yawRate, roll:this.roll, pitch:this.pitch,
      wheelTravel:this.wheelTravel, contacts:this.contacts};
  }
}

/** Stop the chase camera before it enters a solid facade/container. */
export function cameraObstruction(from: number[], to: number[], obstacles: DriveObstacle[]) {
  let nearest = 1;
  for (const b of obstacles) {
    let lo = 0, hi = nearest;
    for (let axis = 0; axis < 3; axis++) {
      const min = [b.minX,b.minY,b.minZ][axis] - 0.25,
        max = [b.maxX,b.maxY,b.maxZ][axis] + 0.25, d = to[axis] - from[axis];
      if (Math.abs(d) < 1e-8) {if (from[axis] < min || from[axis] > max) {lo=2;break;}}
      else {const a=(min-from[axis])/d,c=(max-from[axis])/d;
        lo=Math.max(lo,Math.min(a,c));hi=Math.min(hi,Math.max(a,c));}
    }
    if (lo >= 0 && lo <= hi) nearest = Math.min(nearest, Math.max(0.1,lo - 0.025));
  }
  return nearest;
}

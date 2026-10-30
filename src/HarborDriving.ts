/** Consumer-owned arcade vehicle dynamics. Coordinates: metres, +Y up, heading 0 = +Z. */
export interface DriveInput {
  throttle: number;
  /** Positive steers toward local +X (the vehicle's left with +Z forward). */
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

// Counter-clockwise perimeter of the connected bridge/ramp/quay paving in harborHeight.
// Interior joins have no wall, so the vehicle can cross the ramp and forecourt freely.
const paving: [number, number][] = [[-75.5,-65],[-20.5,-65],[-20.5,234],[-8,234],
  [-8,-60],[8,-60],[8,234],[17,234],[17,-50],[75,-50],[75,260],[-75.5,260]];
const BODY_RADIUS = 1.06, BODY_HALF_SPINE = 1.65, CONTACT_SKIN = .002;
interface Contact { gap: number; nx: number; nz: number }

/** Vector from the closest point on CD to the closest point on AB. */
function segmentSeparation(ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number): [number, number] {
  const ux=bx-ax, uz=bz-az, vx=dx-cx, vz=dz-cz, wx=ax-cx, wz=az-cz,
    a=ux*ux+uz*uz, b=ux*vx+uz*vz, c=ux*wx+uz*wz, e=vx*vx+vz*vz,
    f=vx*wx+vz*wz, denominator=a*e-b*b;
  let s=denominator>1e-10 ? clamp((b*f-c*e)/denominator,0,1) : 0;
  let t=(b*s+f)/e;
  if(t<0){t=0;s=clamp(-c/a,0,1);}
  else if(t>1){t=1;s=clamp((b-c)/a,0,1);}
  return [wx+s*ux-t*vx,wz+s*uz-t*vz];
}

/** Exact capsule against paving edges and solid boxes, with a normal into free space. */
function bodyContact(x: number, z: number, yaw: number, obstacles: DriveObstacle[]): Contact {
  const fx=Math.sin(yaw)*BODY_HALF_SPINE, fz=Math.cos(yaw)*BODY_HALF_SPINE,
    ax=x-fx, az=z-fz, bx=x+fx, bz=z+fz, y=harborHeight(x,z);
  const contact: Contact = {gap:Infinity,nx:0,nz:0};
  const edge=(cx: number,cz: number,dx: number,dz: number)=>{
    const [sx,sz]=segmentSeparation(ax,az,bx,bz,cx,cz,dx,dz), distance=Math.hypot(sx,sz),
      gap=distance-BODY_RADIUS;
    if(gap<contact.gap){
      const length=Math.hypot(dx-cx,dz-cz);
      contact.gap=gap;
      contact.nx=distance>1e-9?sx/distance:-(dz-cz)/length;
      contact.nz=distance>1e-9?sz/distance:(dx-cx)/length;
    }
  };
  for(let i=0;i<paving.length;i++){
    const a=paving[i],b=paving[(i+1)%paving.length];edge(a[0],a[1],b[0],b[1]);
  }
  if(y===null || harborHeight(ax,az)===null || harborHeight(bx,bz)===null) contact.gap=-BODY_RADIUS;
  for(const b of obstacles){
    if(y===null || b.maxY<y+.1 || b.minY>y+1.55)continue;
    // Only nearby boxes can touch this fixed-step swept footprint.
    if(b.maxX<Math.min(ax,bx)-BODY_RADIUS-1 || b.minX>Math.max(ax,bx)+BODY_RADIUS+1 ||
      b.maxZ<Math.min(az,bz)-BODY_RADIUS-1 || b.minZ>Math.max(az,bz)+BODY_RADIUS+1)continue;
    edge(b.minX,b.minZ,b.maxX,b.minZ);edge(b.maxX,b.minZ,b.maxX,b.maxZ);
    edge(b.maxX,b.maxZ,b.minX,b.maxZ);edge(b.minX,b.maxZ,b.minX,b.minZ);
    const inside=(px:number,pz:number)=>px>b.minX&&px<b.maxX&&pz>b.minZ&&pz<b.maxZ;
    if(inside(ax,az)||inside(bx,bz))contact.gap=-BODY_RADIUS;
  }
  return contact;
}

export function harborDriveable(x: number, z: number, yaw: number,
  obstacles: DriveObstacle[] = []): boolean {
  return bodyContact(x,z,yaw,obstacles).gap>=-1e-8;
}

/** Advance to contact, then spend the remaining motion along the contact tangent. */
function moveBody(x: number, z: number, yaw: number, vx: number, vz: number,
  dt: number, obstacles: DriveObstacle[]) {
  let dx=vx*dt,dz=vz*dt,blocked=false;
  // A fixed step travels at most .3 m, well below the 2.12 m capsule diameter.
  // Each accepted position is checked together; independent axis moves cannot overlap a corner.
  for(let i=0;i<4 && Math.hypot(dx,dz)>1e-9;i++){
    if(bodyContact(x+dx,z+dz,yaw,obstacles).gap>=CONTACT_SKIN){x+=dx;z+=dz;break;}
    blocked=true;
    let lo=0,hi=1;
    for(let n=0;n<14;n++){
      const mid=(lo+hi)/2;
      if(bodyContact(x+dx*mid,z+dz*mid,yaw,obstacles).gap>=CONTACT_SKIN)lo=mid;else hi=mid;
    }
    const normal=bodyContact(x+dx*hi,z+dz*hi,yaw,obstacles);
    x+=dx*lo;z+=dz*lo;dx*=1-lo;dz*=1-lo;
    const into=dx*normal.nx+dz*normal.nz,velocityInto=vx*normal.nx+vz*normal.nz;
    if(velocityInto<0){vx-=normal.nx*velocityInto;vz-=normal.nz*velocityInto;}
    if(into>=-1e-10)break;
    dx-=normal.nx*into;dz-=normal.nz*into;
  }
  return {x,z,vx,vz,blocked};
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
      accumulator: 0, pitchVelocity: 0, rollVelocity: 0, contacts: 0});
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
    const previousYaw = this.yaw, turn = this.yawRate * dt;
    const requestedYaw = wrapAngle(previousYaw + turn);
    // Retain world momentum while tyres pull it toward the chassis direction.
    const momentumX = this.vx + fx * (longitudinal - oldSpeed),
      momentumZ = this.vz + fz * (longitudinal - oldSpeed);
    fx = Math.sin(requestedYaw); fz = Math.cos(requestedYaw);
    const lateral = momentumX * fz - momentumZ * fx;
    const grip = Math.exp(-(input.handbrake ? 1.3 : 9.5) * dt);
    this.vx = fx * longitudinal + fz * lateral * grip;
    this.vz = fz * longitudinal - fx * lateral * grip;
    // Resolve translation with the last valid orientation before attempting to rotate.
    // A blocked nose/side must not prevent reverse motion that makes room to turn.
    const move=moveBody(this.x,this.z,previousYaw,this.vx,this.vz,dt,this.obstacles);
    this.x=move.x;this.z=move.z;this.vx=move.vx;this.vz=move.vz;
    let blocked=move.blocked;
    if(bodyContact(this.x,this.z,requestedYaw,this.obstacles).gap>=CONTACT_SKIN)this.yaw=requestedYaw;
    else {
      blocked=true;
      let lo=0,hi=1;
      for(let n=0;n<14;n++){
        const mid=(lo+hi)/2;
        if(bodyContact(this.x,this.z,previousYaw+turn*mid,this.obstacles).gap>=CONTACT_SKIN)lo=mid;else hi=mid;
      }
      this.yaw=wrapAngle(previousYaw+turn*lo);
      this.yawRate=turn*lo/dt;
    }
    if(blocked)this.contacts++;
    this.y = harborHeight(this.x, this.z) ?? this.y;
    this.speed = this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
    this.wheelTravel += this.speed * dt;
    this.acceleration = clamp((this.speed - oldSpeed) / dt, -12, 10);
    this.lateralAcceleration = this.speed * this.yawRate;
    const pitchTarget = -this.acceleration * 0.0036;
    const rollTarget = clamp(this.lateralAcceleration, -9, 9) * 0.006;
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

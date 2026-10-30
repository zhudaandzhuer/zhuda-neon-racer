import {
  TRACKS,
  at,
  nearest,
  angleDelta,
  clamp,
  wrap,
  type Track,
} from "./Tracks";
import { type Save, unlocked } from "./Save";
export type Input = {
  steer: number;
  throttle: boolean;
  brake: boolean;
  nitro: boolean;
};
export type Car = {
  x: number;
  y: number;
  angle: number;
  speed: number;
  vx: number;
  vy: number;
  progress: number;
  lastS: number;
  nitro: number;
  boosting: boolean;
  drifting: boolean;
  wallCooldown: number;
  padCooldown: number;
  finished: boolean;
  finishTime: number;
  color: string;
  name: string;
  lane: number;
  nextGate: number;
  gates: number;
  hit: boolean;
};
export type Result = {
  won: boolean;
  place: number;
  time: number;
  stars: number;
  reward: number;
  reason: "finish" | "timeout";
  newBest: boolean;
};
export type Event = {
  type: "wall" | "pad" | "lap" | "finish";
  x: number;
  y: number;
};
export class Race {
  track: Track;
  cars: Car[] = [];
  time = 0;
  countdown = 3;
  phase: "countdown" | "racing" | "finished" = "countdown";
  result: Result | null = null;
  events: Event[] = [];
  driftTime = 0;
  boostTime = 0;
  collisions = 0;
  lap = 1;
  constructor(
    public trackId: number,
    public save: Save,
  ) {
    if (!TRACKS[trackId] || !unlocked(save, trackId))
      throw new Error("賽道尚未解鎖");
    this.track = TRACKS[trackId];
    [
      ["#d9fc74", "#ffd6a0", "#e1bdff"][save.car],
      "#ff786c",
      "#a593ff",
      "#5ddbd8",
    ].forEach((color, i) => {
      const s = 100 - Math.floor(i / 2) * 65,
        lane = i % 2 === 0 ? -31 : 31,
        p = at(this.track, s, lane);
      this.cars.push({
        x: p.x,
        y: p.y,
        angle: p.angle,
        speed: 0,
        vx: 0,
        vy: 0,
        progress: s,
        lastS: s,
        nitro: 70,
        boosting: false,
        drifting: false,
        wallCooldown: 0,
        padCooldown: 0,
        finished: false,
        finishTime: 0,
        color,
        name: ["YOU", "ROOK", "VESPER", "ECHO"][i],
        lane,
        nextGate: 1,
        gates: 0,
        hit: false,
      });
    });
  }
  get player() {
    return this.cars[0];
  }
  get position() {
    return (
      1 +
      this.cars
        .slice(1)
        .filter((c) => c.finished || c.progress > this.player.progress).length
    );
  }
  step(dt: number, input: Input) {
    if (this.phase === "finished") return;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.05)
      throw new Error("固定步進超出範圍");
    this.events = [];
    if (this.phase === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = "racing";
        this.countdown = 0;
      }
      return;
    }
    this.time += dt;
    for (let i = 0; i < 4; i++) {
      const c = this.cars[i];
      if (c.finished) continue;
      this.drive(c, dt, i === 0 ? input : this.aiInput(i), i);
    }
    // Physical contact can cost momentum, but cannot move a car across a gate.
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) {
        const a = this.cars[i],
          b = this.cars[j],
          dx = b.x - a.x,
          dy = b.y - a.y,
          d = Math.hypot(dx, dy);
        if (d > 0 && d < 30 && !a.finished && !b.finished) {
          const push = (30 - d) * 0.52;
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
          a.speed *= 0.997;
          b.speed *= 0.997;
        }
      }
    this.lap = Math.min(this.track.laps, Math.floor(this.player.gates / 8) + 1);
    if (this.player.finished) this.finish("finish");
    else if (this.time >= this.track.limit) this.finish("timeout");
  }
  aiInput(index: number): Input {
    const c = this.cars[index],
      t = this.track,
      n = nearest(t, c.x, c.y),
      look = at(t, n.s + 62 + c.speed * 0.16, c.lane);
    const delta = angleDelta(Math.atan2(look.y - c.y, look.x - c.x), c.angle);
    const bend = Math.abs(angleDelta(at(t, n.s + 145).angle, n.angle));
    const target =
      (index === 0 ? 320 : t.ai + (index - 1) * 9) *
      (bend > 0.65 ? 0.64 : bend > 0.35 ? 0.82 : 1);
    return {
      steer: clamp(delta * 2.5, -1, 1),
      throttle: c.speed < target,
      brake: c.speed > target + 22,
      nitro:
        index === 0 && Math.abs(delta) < 0.1 && bend < 0.18 && c.nitro > 35,
    };
  }
  private drive(c: Car, dt: number, input: Input, index: number) {
    const before = nearest(this.track, c.x, c.y),
      player = index === 0;
    c.hit = false;
    c.wallCooldown = Math.max(0, c.wallCooldown - dt);
    c.padCooldown = Math.max(0, c.padCooldown - dt);
    const steer = clamp(Number.isFinite(input.steer) ? input.steer : 0, -1, 1);
    c.boosting = input.nitro && c.nitro > 1 && c.speed > 55 && !input.brake;
    c.drifting = input.brake && Math.abs(steer) > 0.25 && c.speed > 115;
    const car = player ? this.save.car : 0,
      up = player ? this.save.upgrades : [0, 0, 0];
    const top = player
      ? 335 + up[0] * 12 + [0, 15, -8][car]
      : this.track.ai + 28 + (index - 1) * 9;
    const max = c.boosting ? top + 125 : top;
    const acceleration = input.throttle ? 145 + up[0] * 7 : -35;
    c.speed = clamp(
      c.speed + (acceleration - (input.brake ? 180 : 0)) * dt,
      0,
      max,
    );
    if (c.boosting) c.speed = Math.min(max, c.speed + 185 * dt);
    c.nitro = clamp(
      c.nitro + (c.boosting ? -(26 - up[2] * 2) : c.drifting ? 23 : 7) * dt,
      0,
      100,
    );
    c.angle +=
      steer *
      (1.45 + Math.min(c.speed / 280, 1.2)) *
      (c.drifting ? 1.15 : 1) *
      clamp(c.speed / 60, 0, 1) *
      dt;
    const grip = (c.drifting ? 3.4 : 8) + up[1] * 0.65 + (car === 2 ? 1.3 : 0);
    const blend = 1 - Math.exp(-grip * dt);
    c.vx += (Math.cos(c.angle) * c.speed - c.vx) * blend;
    c.vy += (Math.sin(c.angle) * c.speed - c.vy) * blend;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    const near = nearest(this.track, c.x, c.y),
      edge = this.track.width / 2 - 17;
    if (near.distance > edge) {
      const dx = c.x - near.x,
        dy = c.y - near.y;
      c.x = near.x + (dx / near.distance) * edge;
      c.y = near.y + (dy / near.distance) * edge;
      // Glancing contact slides along the barrier; a head-on hit costs more speed.
      const alignment = Math.abs(Math.cos(angleDelta(c.angle, near.angle)));
      c.speed *= Math.pow(0.3 + 0.65 * alignment, dt * 9);
      const v = c.vx * Math.cos(near.angle) + c.vy * Math.sin(near.angle);
      c.vx = Math.cos(near.angle) * v * 0.95;
      c.vy = Math.sin(near.angle) * v * 0.95;
      if (c.wallCooldown === 0) {
        c.wallCooldown = 0.25;
        c.hit = true;
        if (player) {
          this.collisions++;
          this.events.push({ type: "wall", x: c.x, y: c.y });
        }
      }
    }
    const delta =
      wrap(near.s - c.lastS + this.track.length / 2, this.track.length) -
      this.track.length / 2;
    if (Math.abs(delta) < 70) {
      c.progress += delta;
      // Eight sequential sectors per lap prevent reverse driving or a shortcut from awarding a lap.
      const gateS = (c.nextGate * this.track.length) / 8;
      if (c.progress >= gateS && c.progress - gateS < 70) {
        c.gates++;
        c.nextGate++;
        if (player && c.gates % 8 === 0)
          this.events.push({ type: "lap", x: c.x, y: c.y });
      }
    }
    c.lastS = near.s;
    if (
      c.padCooldown === 0 &&
      this.track.pads.some(
        (p) =>
          Math.abs(
            wrap(
              near.s - p * this.track.length + this.track.length / 2,
              this.track.length,
            ) -
              this.track.length / 2,
          ) < 28,
      ) &&
      near.distance < 55
    ) {
      c.padCooldown = 2;
      c.nitro = clamp(c.nitro + 22, 0, 100);
      c.speed = Math.min(max + 20, c.speed + 70);
      if (player) this.events.push({ type: "pad", x: c.x, y: c.y });
    }
    if (player) {
      if (c.boosting) this.boostTime += dt;
      if (c.drifting) this.driftTime += dt;
    }
    if (c.gates >= 8 * this.track.laps) {
      c.finished = true;
      c.finishTime = this.time;
      c.boosting = false;
    }
  }
  private finish(reason: "finish" | "timeout") {
    if (this.result) return;
    this.phase = "finished";
    const place = this.position,
      won = reason === "finish" && place <= 3;
    const stars = won
      ? 1 + (place === 1 ? 1 : 0) + (this.time <= this.track.gold ? 1 : 0)
      : 0;
    const reward = won ? 200 + (4 - place) * 100 + stars * 50 : 0;
    const newBest =
      won &&
      (this.save.best[this.trackId] === null ||
        this.time < this.save.best[this.trackId]!);
    this.result = {
      won,
      place,
      time: this.time,
      stars,
      reward,
      reason,
      newBest,
    };
    if (won) {
      this.save.credits += reward;
      this.save.stars[this.trackId] = Math.max(
        this.save.stars[this.trackId],
        stars,
      );
      if (newBest) this.save.best[this.trackId] = this.time;
    }
    this.save.races++;
    this.events.push({ type: "finish", x: this.player.x, y: this.player.y });
  }
}

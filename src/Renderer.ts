import {
  ZhudaParticleSystem,
  ZhudaLayaParticleRenderer,
  ZhudaRibbonTrail,
  ZhudaLayaRibbonRenderer,
} from "zhuda-laya-engine";
import { trackArt, carArt, textureArt } from "./Art";
import { TRACKS, at, type Track } from "./Tracks";
import { type Race } from "./Model";
declare const Laya: any;
export class Renderer {
  root = new Laya.Sprite();
  road = new Laya.Sprite();
  effects = new Laya.Sprite();
  actors = new Laya.Sprite();
  markers = new Laya.Sprite();
  textures = new Map<string, any>();
  cars: any[] = [];
  systems: ZhudaParticleSystem[] = [];
  particles: ZhudaLayaParticleRenderer[] = [];
  trails: ZhudaRibbonTrail[] = [];
  ribbons: ZhudaLayaRibbonRenderer[] = [];
  trackId = -1;
  private maps = new Map<number, any>();
  private generation = 0;
  private cx = 0;
  private cy = 0;
  private resetCamera = true;
  async init() {
    Laya.stage.addChild(this.root);
    this.root.addChild(this.road);
    this.root.addChild(this.effects);
    this.root.addChild(this.actors);
    this.root.addChild(this.markers);
    for (const key of ["glow", "smoke", "ribbon"])
      this.textures.set(key, await this.load(textureArt(key)));
    for (const color of ["#d9fc74", "#ffd6a0", "#e1bdff"])
      this.textures.set("player-" + color, await this.load(carArt(color)));
    for (const [i, color] of [
      "#d9fc74",
      "#ff786c",
      "#a593ff",
      "#5ddbd8",
    ].entries()) {
      const tex = await this.load(carArt(color)),
        s = new Laya.Sprite();
      s.texture = tex;
      s.size(45, 70);
      s.pivot(22.5, 35);
      this.actors.addChild(s);
      this.cars.push(s);
    }
    const specs: any[] = [
      {
        id: "nitro",
        texture: "glow",
        maxParticles: 160,
        seed: 17,
        space: "world",
        blend: "additive",
        shape: { type: "box", width: 6, height: 30 },
        rate: 150,
        lifetime: [0.12, 0.4],
        speed: [60, 150],
        angle: [2.95, 3.34],
        size: [9, 23],
        stretch: 2,
        alignToVelocity: true,
        colorOverLife: [
          { time: 0, color: "#e9ffc0" },
          { time: 0.5, color: "#51f3db" },
          { time: 1, color: "#2391c6" },
        ],
        alphaOverLife: [
          { time: 0, value: 0.7 },
          { time: 1, value: 0 },
        ],
      },
      {
        id: "drift",
        texture: "smoke",
        maxParticles: 120,
        seed: 33,
        space: "world",
        blend: "alpha",
        shape: { type: "box", width: 9, height: 33 },
        rate: 60,
        lifetime: [0.35, 0.8],
        speed: [8, 24],
        angle: [2.4, 3.9],
        size: [12, 25],
        sizeOverLife: [
          { time: 0, value: 0.5 },
          { time: 1, value: 2.5 },
        ],
        colorOverLife: [
          { time: 0, color: "#b9d2c5" },
          { time: 1, color: "#7b9f9e" },
        ],
        alphaOverLife: [
          { time: 0, value: 0.24 },
          { time: 1, value: 0 },
        ],
      },
      {
        id: "spark",
        texture: "glow",
        maxParticles: 80,
        seed: 51,
        space: "world",
        blend: "additive",
        shape: { type: "point" },
        rate: 0,
        bursts: [{ time: 0, count: 20 }],
        duration: 0.04,
        lifetime: [0.12, 0.4],
        speed: [80, 230],
        angle: [0, 6.28],
        size: [2, 5],
        stretch: 4,
        alignToVelocity: true,
        colorOverLife: [
          { time: 0, color: "#fff7bf" },
          { time: 1, color: "#ff9465" },
        ],
        alphaOverLife: [
          { time: 0, value: 1 },
          { time: 1, value: 0 },
        ],
      },
    ];
    this.systems = specs.map((s) => new ZhudaParticleSystem(s));
    this.particles = this.systems.map(
      (s) =>
        new ZhudaLayaParticleRenderer(
          s,
          this.effects,
          (k) => this.textures.get(k),
          6,
        ),
    );
    this.systems[0].play();
    this.systems[1].play();
    for (const i of [0, 1]) {
      const trail = new ZhudaRibbonTrail({
        maxPoints: 80,
        lifetime: 0.5,
        width: 11,
        minDistance: 3,
        teleportDistance: 170,
      });
      this.trails.push(trail);
      this.ribbons.push(
        new ZhudaLayaRibbonRenderer(
          trail,
          this.effects,
          this.textures.get("ribbon"),
          "#68ffe0",
          "additive",
        ),
      );
    }
    await this.selectTrack(0);
  }
  private async load(c: HTMLCanvasElement) {
    const t = await Laya.loader.load({
      url: c.toDataURL(),
      type: Laya.Loader.IMAGE,
    });
    t.lock = true;
    if (t.bitmap) t.bitmap.lock = true;
    return t;
  }
  async selectTrack(id: number) {
    const generation = ++this.generation;
    if (!this.maps.has(id))
      this.maps.set(id, await this.load(trackArt(TRACKS[id])));
    if (generation !== this.generation) return;
    this.trackId = id;
    this.road.texture = this.maps.get(id);
    this.road.size(2150, 2100);
    this.reset();
  }
  reset() {
    for (const s of this.systems) s.clear();
    for (const t of this.trails) t.clear();
    this.resetCamera = true;
  }
  update(race: Race, dt: number, reduced: boolean) {
    const p = race.player,
      c = Math.cos(p.angle),
      sn = Math.sin(p.angle),
      active = race.phase === "racing";
    this.systems[0].intensity = active && p.boosting && !reduced ? 1 : 0;
    this.systems[1].intensity = active && p.drifting && !reduced ? 1 : 0;
    for (const s of this.systems.slice(0, 2))
      s.setTransform(p.x - c * 20, p.y - sn * 20, p.angle);
    for (const e of race.events)
      if (e.type === "wall" || e.type === "pad") {
        this.systems[2].setTransform(e.x, e.y);
        this.systems[2].play();
      }
    for (const s of this.systems) s.update(dt);
    this.trails.forEach((t, i) => {
      const side = i === 0 ? -16 : 16;
      t.update(
        dt,
        p.x + c * 18 - sn * side,
        p.y + sn * 18 + c * side,
        active && p.boosting && !reduced,
      );
    });
  }
  draw(race: Race | null, selected: number, dt: number, inGame: boolean) {
    const t = TRACKS[selected],
      w = Laya.stage.width,
      h = Laya.stage.height;
    if (inGame && race) {
      const p = race.player,
        look = 90;
      const x = p.x + Math.cos(p.angle) * look,
        y = p.y + Math.sin(p.angle) * look;
      const k = this.resetCamera ? 1 : 1 - Math.exp(-5 * dt);
      this.cx += (x - this.cx) * k;
      this.cy += (y - this.cy) * k;
      this.resetCamera = false;
      const scale =
        Math.max(0.5, Math.min(w / 1000, h / 670, 1.35)) *
        (p.boosting ? 0.93 : 1);
      this.root.scale(scale, scale);
      this.root.pos(w * 0.5 - this.cx * scale, h * 0.48 - this.cy * scale);
      race.cars.forEach((c, i) => {
        const s = this.cars[i];
        if (i === 0) s.texture = this.textures.get("player-" + c.color);
        s.visible = true;
        s.pos(c.x, c.y);
        s.rotation = (c.angle * 180) / Math.PI + 90;
      });
      const g = this.markers.graphics;
      g.clear();
      g.drawPoly(p.x, p.y - 52, [-6, -7, 6, -7, 0, 0], "#d9fc74");
      for (const r of this.particles) r.render();
      for (const r of this.ribbons) r.render();
    } else {
      const scale = Math.min(w / 1750, h / 1600) * 1.25;
      this.root.scale(scale, scale);
      this.root.pos(w * 0.72 - 1050 * scale, h * 0.43 - 1000 * scale);
      this.cars.forEach((s, i) => {
        const p = at(t, 100 - i * 55, i % 2 === 0 ? -28 : 28);
        s.visible = true;
        s.pos(p.x, p.y);
        s.rotation = (p.angle * 180) / Math.PI + 90;
      });
      this.effects.visible = false;
      this.markers.graphics.clear();
    }
    this.effects.visible = inGame;
  }
  stats() {
    return {
      particles: this.systems.reduce((s, p) => s + p.aliveCount, 0),
      trailPoints: this.trails.reduce((s, p) => s + p.pointCount, 0),
      maps: this.maps.size,
      finite: this.systems.every((s) =>
        s.snapshot().every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      ),
    };
  }
}

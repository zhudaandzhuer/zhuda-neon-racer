import {
  ZhudaParticleSystem3D,
  ZhudaLayaParticleRenderer3D,
  ZhudaRibbonTrail3D,
  ZhudaLayaRibbonRenderer3D,
  createSurfaceMaterial,
  ZhudaRuntimeProfiler,
  resolveCameraBoom,
  ZhudaShaderMaterial,
  inspectSceneResources,
  ZhudaModelLibrary,
} from "zhuda-laya-engine";
import { textureArt } from "./Art";
import { Geometry, type V } from "./Geometry";
import { World, roadHeight, roadPoint, SCALE } from "./World";
import { TRACKS, at, nearest, angleDelta } from "./Tracks";
import type { Race } from "./Model";
import { createSkylineIBL } from "./Environment";
import playerModel from "../public/models/maextro-s800.json";
import rivalModel from "../public/models/maextro-s800-rival.json";
declare const Laya: any;
export class Renderer {
  scene: any;
  camera: any;
  world!: World;
  cars: any[] = [];
  meshes: any[] = [];
  materials: any[] = [];
  systems: ZhudaParticleSystem3D[] = [];
  particles: ZhudaLayaParticleRenderer3D[] = [];
  trails: ZhudaRibbonTrail3D[] = [];
  ribbons: ZhudaLayaRibbonRenderer3D[] = [];
  trackId = -1;
  private maps = new Set<number>();
  private resetCamera = true;
  private clock = 0;
  private heading = 0;
  private cx = 0;
  private cy = 0;
  private cz = 0;
  private profiler = new ZhudaRuntimeProfiler();
  private draws = 0;
  private triangles = 0;
  private frameIntervals: number[] = [];
  private previous = 0;
  private post: any;
  private contactShadow!: ZhudaShaderMaterial;
  private accentMaterials: any[] = [];
  private carLibrary = new ZhudaModelLibrary(2);
  private carInstances: any[] = [];
  private glow: any;
  private rearFlames: any[] = [];
  private boostEnvelope = 0;
  async init() {
    const L = Laya;
    this.scene = new L.Scene3D();
    L.stage.addChild(this.scene);
    this.scene.ambientMode = L.AmbientMode.SolidColor;
    this.scene.ambientColor = new L.Color(0.85, 0.9, 1, 1);
    this.scene.iblTex = createSkylineIBL();
    this.scene.iblTexRGBD = false;
    this.scene.reflectionIntensity = 0.8;
    this.scene.enableFog = true;
    this.scene.fogColor = new L.Color(0.17, 0.13, 0.23, 1);
    this.scene.fogStart = 160;
    this.scene.fogRange = 380;
    this.camera = new L.Camera(0, 0.1, 1000);
    this.camera.fieldOfView = 64;
    this.camera.clearColor = new L.Color(0.08, 0.08, 0.16, 1);
    this.scene.addChild(this.camera);
    if (!matchMedia("(pointer:coarse)").matches) {
      this.post = new L.PostProcess();
      const bloom = new L.BloomEffect();
      bloom.intensity = 0.65;
      bloom.threshold = 0.72;
      bloom.softKnee = 0.6;
      bloom.diffusion = 3;
      bloom.fastMode = true;
      bloom.resolutionScale = 0.5;
      this.post.addEffect(bloom);
      this.camera.postProcess = this.post;
    }
    const light = new L.Sprite3D();
    this.scene.addChild(light);
    const sun = light.addComponent(L.DirectionLightCom);
    sun.color = new L.Color(1, 0.9, 0.78, 1);
    sun.intensity = 1.6;
    light.transform.rotationEuler = new L.Vector3(-28, -55, 0);
    const fill = new L.Sprite3D("cool-rim-light");
    this.scene.addChild(fill);
    const fillLight = fill.addComponent(L.DirectionLightCom);
    fillLight.color = new L.Color(0.45, 0.7, 1, 1);
    fillLight.intensity = 0.45;
    fill.transform.rotationEuler = new L.Vector3(-18, 125, 0);
    const glow = await L.loader.load({
        url: textureArt("glow").toDataURL(),
        type: L.Loader.IMAGE,
      }),
      ribbon = await L.loader.load({
        url: textureArt("ribbon").toDataURL(),
        type: L.Loader.IMAGE,
      });
    glow.lock = ribbon.lock = true;
    if (glow.bitmap) glow.bitmap.lock = true;
    if (ribbon.bitmap) ribbon.bitmap.lock = true;
    this.glow = glow;
    this.contactShadow = new ZhudaShaderMaterial({
      schemaVersion: 1,
      dimension: 3,
      name: "ZhudaNeonContactShadow",
      blend: "alpha",
      depthWrite: false,
      doubleSided: true,
      uniforms: {},
      surface:
        "vec4 zhudaSurface(vec2 uv,vec3 p,vec3 n){float r=length((uv-.5)*2.0);return vec4(.0,.005,.015,(1.0-smoothstep(.4,1.0,r))*.55);}",
    });
    for (let i = 0; i < 4; i++)
      await this.makeCar(i, ["#d9fc74", "#ff786c", "#a593ff", "#5ddbd8"][i]);
    const specs: any[] = [
      {
        id: "nitro3d",
        texture: "glow",
        maxParticles: 220,
        seed: 17,
        space: "world",
        blend: "additive",
        shape: { type: "box", width: 1.2, height: 0.2, depth: 0.1 },
        rate: 170,
        lifetime: [0.12, 0.38],
        speed: [8, 18],
        direction: { x: 0, y: 0, z: -1 },
        spread: 0.12,
        size: [0.3, 0.8],
        stretch: 2,
        billboard: "velocity",
        colorOverLife: [
          { time: 0, color: "#eefff4" },
          { time: 0.3, color: "#68fceb" },
          { time: 1, color: "#5262ff" },
        ],
        alphaOverLife: [
          { time: 0, value: 0.8 },
          { time: 1, value: 0 },
        ],
        sizeOverLife: [
          { time: 0, value: 1 },
          { time: 1, value: 0.1 },
        ],
      },
      {
        id: "drift3d",
        texture: "glow",
        maxParticles: 100,
        seed: 33,
        space: "world",
        blend: "alpha",
        shape: { type: "box", width: 1.7, height: 0, depth: 0.1 },
        rate: 60,
        lifetime: [0.3, 0.7],
        speed: [0.8, 2],
        direction: { x: 0, y: 1, z: 0 },
        spread: 0.7,
        size: [0.4, 1],
        colorOverLife: [
          { time: 0, color: "#bd9ee8" },
          { time: 1, color: "#554476" },
        ],
        alphaOverLife: [
          { time: 0, value: 0.32 },
          { time: 1, value: 0 },
        ],
      },
      {
        id: "spark3d",
        texture: "glow",
        maxParticles: 100,
        seed: 55,
        space: "world",
        blend: "additive",
        shape: { type: "point" },
        rate: 0,
        bursts: [{ time: 0, count: 22 }],
        duration: 0.12,
        loop: false,
        lifetime: [0.2, 0.5],
        speed: [3, 10],
        direction: { x: 0, y: 1, z: 0 },
        spread: 1.5,
        acceleration: { x: 0, y: -12, z: 0 },
        size: [0.08, 0.18],
        colorOverLife: [
          { time: 0, color: "#fff6ac" },
          { time: 1, color: "#ff4e73" },
        ],
        alphaOverLife: [
          { time: 0, value: 1 },
          { time: 1, value: 0 },
        ],
      },
    ];
    for (const spec of specs) {
      const s = new ZhudaParticleSystem3D(spec);
      this.systems.push(s);
      this.particles.push(
        new ZhudaLayaParticleRenderer3D(s, this.scene, () => glow),
      );
    }
    this.systems[0].play();
    this.systems[1].play();
    for (let i = 0; i < 4; i++) {
      const trail = new ZhudaRibbonTrail3D({
        maxPoints: 90,
        lifetime: 0.65,
        width: i < 2 ? 0.28 : 0.12,
        minDistance: 0.12,
        teleportDistance: 20,
      });
      this.trails.push(trail);
      this.ribbons.push(
        new ZhudaLayaRibbonRenderer3D(
          trail,
          this.scene,
          ribbon,
          i < 2 ? "#58ffe0" : "#b1a2ff",
          "additive",
        ),
      );
    }
    await this.selectTrack(0);
    const canvas =
      (document.querySelector("#layaCanvas") as HTMLCanvasElement) ||
      document.querySelector("canvas");
    if (canvas)
      this.profiler.attach(
        canvas.getContext("webgl2") || canvas.getContext("webgl"),
      );
    this.profiler.beginFrame();
  }
  private mat(hex: string, lit = true) {
    const h = parseInt(hex.slice(1), 16),
      m = createSurfaceMaterial({
        type: lit ? "pbr" : "unlit",
        color: [
          ((h >> 16) & 255) / 255,
          ((h >> 8) & 255) / 255,
          (h & 255) / 255,
          1,
        ],
        metallic: lit ? 0.45 : 0,
        roughness: 0.28,
      });
    this.materials.push(m);
    return m;
  }
  private async makeCar(i: number, color: string) {
    const root = new Laya.Sprite3D("racer-" + i);
    this.scene.addChild(root);
    this.cars[i] = root;
    const shadow = new Geometry();
    shadow.quad(
      [-1.45, 0.015, -3.1], [1.45, 0.015, -3.1],
      [1.45, 0.015, 3.1], [-1.45, 0.015, 3.1], [0, 1, 0],
    );
    this.meshes.push(shadow.build(root, this.contactShadow.material, "contact-shadow"));
    const asset = i === 0 ? playerModel : rivalModel;
    const instance = await this.carLibrary.instantiate(
      new URL("models/" + asset.file + "?v=" + asset.sha256.slice(0, 12), document.baseURI).href,
      { retries: 1 },
    );
    root.addChild(instance.node);
    instance.node.name = "maextro-s800-imported";
    this.carInstances.push(instance);

    // The source's silver/black PBR body is preserved. Race liveries are light accents.
    const accent = this.mat(color, false);
    this.accentMaterials[i] = accent;
    const trim = new Geometry();
    for (const x of [-1.02, 1.02]) trim.box(x, 0.15, 0, 0.035, 0.025, 3.5);
    this.meshes.push(trim.build(root, accent, "race-accent"));
    const light = this.mat("#d2ffff", false);
    const jets = new Geometry();
    for (const x of [-0.55, 0.55]) jets.box(x, 0.3, -2.8, 0.22, 0.1, 0.45);
    const flame = jets.build(root, light, "nitro-cores");
    flame.node.active = false;
    this.rearFlames[i] = flame.node;
    this.meshes.push(flame);
  }
  async selectTrack(id: number) {
    if (this.trackId === id) return;
    this.world?.dispose();
    this.world = new World(TRACKS[id], this.scene);
    this.trackId = id;
    this.maps.add(id);
    this.reset();
  }
  reset() {
    for (const s of this.systems) s.clear();
    for (const t of this.trails) t.clear();
    this.resetCamera = true;
    this.boostEnvelope = 0;
  }
  update(race: Race, dt: number, reduced: boolean) {
    if (this.post) this.post.enable = !reduced;
    const p = race.player,
      c = Math.cos(p.angle),
      sn = Math.sin(p.angle),
      active = race.phase === "racing",
      s = nearest(race.track, p.x, p.y).s,
      y = roadHeight(race.track, s),
      rotation = {
        x: 0,
        y: Math.sin((Math.PI / 2 - p.angle) / 2),
        z: 0,
        w: Math.cos((Math.PI / 2 - p.angle) / 2),
      };
    this.systems[0].intensity = active && p.boosting && !reduced ? 1 : 0;
    this.systems[1].intensity = active && p.drifting && !reduced ? 1 : 0;
    this.systems[0].setTransform(
      (p.x - c * 29) * SCALE,
      y + 0.45,
      (p.y - sn * 29) * SCALE,
      rotation,
    );
    this.systems[1].setTransform(
      (p.x - c * 18) * SCALE,
      y + 0.1,
      (p.y - sn * 18) * SCALE,
      rotation,
    );
    for (const e of race.events)
      if (e.type === "wall" || e.type === "pad") {
        this.systems[2].setTransform(e.x * SCALE, y + 0.4, e.y * SCALE);
        this.systems[2].play(true);
      }
    for (const system of this.systems) system.update(dt);
    for (let i = 0; i < this.trails.length; i++) {
      const side = (i % 2 ? 1 : -1) * (i < 2 ? 10 : 12),
        front = i < 2 ? -23 : 18;
      this.trails[i].update(
        dt,
        (p.x + c * front - sn * side) * SCALE,
        y + (i < 2 ? 0.48 : 0.7),
        (p.y + sn * front + c * side) * SCALE,
        active && p.boosting && !reduced,
      );
    }
  }
  draw(race: Race | null, selected: number, dt: number, inGame: boolean) {
    this.clock += dt;
    this.world.update(this.clock);
    const track = TRACKS[selected];
    if (inGame && race) {
      const p = race.player,
        near = nearest(track, p.x, p.y),
        h = roadHeight(track, near.s),
        blend = this.resetCamera ? 1 : 1 - Math.exp(-7 * dt);
      this.heading += angleDelta(p.angle, this.heading) * blend;
      this.boostEnvelope +=
        (Number(p.boosting) - this.boostEnvelope) * (1 - Math.exp(-5 * dt));
      const c = Math.cos(this.heading),
        s = Math.sin(this.heading),
        back = 10.5 + this.boostEnvelope * 1.8;
      const desired = {
          x: p.x * SCALE - c * back,
          y: h + 4.4,
          z: p.y * SCALE - s * back,
        },
        focus = { x: p.x * SCALE, y: h + 1.5, z: p.y * SCALE };
      const safe = resolveCameraBoom(focus, desired, {
        queries: this.world.queries,
        radius: 0.3,
        clearance: 0.15,
      });
      this.cx = safe.position.x;
      this.cy = safe.position.y;
      this.cz = safe.position.z;
      this.camera.transform.position = new Laya.Vector3(
        this.cx,
        this.cy,
        this.cz,
      );
      this.camera.transform.lookAt(
        new Laya.Vector3(p.x * SCALE + c * 9, h + 1, p.y * SCALE + s * 9),
        new Laya.Vector3(0, 1, 0),
      );
      this.camera.fieldOfView +=
        (64 + this.boostEnvelope * 9 - this.camera.fieldOfView) *
        (this.resetCamera ? 1 : 1 - Math.exp(-5 * dt));
      this.resetCamera = false;
      race.cars.forEach((car, i) =>
        this.placeCar(
          i,
          car.x,
          car.y,
          car.angle,
          nearest(track, car.x, car.y).s,
          car.boosting,
          car.color,
        ),
      );
      for (const r of this.particles) r.render(this.camera);
      for (const r of this.ribbons) r.render(this.camera);
    } else {
      const distance = (this.clock * 75) % track.length,
        p = at(track, distance),
        pos = roadPoint(track, distance, -28, 1),
        focus = roadPoint(track, distance + 36, 0, 1),
        angle = p.angle;
      this.camera.transform.position = new Laya.Vector3(
        pos[0] - Math.cos(angle) * 6,
        pos[1] + 4.8,
        pos[2] - Math.sin(angle) * 6,
      );
      this.camera.transform.lookAt(
        new Laya.Vector3(...focus),
        new Laya.Vector3(0, 1, 0),
      );
      this.camera.fieldOfView = 62;
      for (let i = 0; i < 4; i++) {
        const s = distance + 20 - i * 45,
          p = at(track, s, i % 2 === 0 ? 31 : -31);
        this.placeCar(
          i,
          p.x,
          p.y,
          p.angle,
          s,
          false,
          ["#d9fc74", "#ff786c", "#a593ff", "#5ddbd8"][i],
        );
      }
      for (const r of this.particles) r.node.active = false;
      for (const r of this.ribbons) r.node.active = false;
      this.resetCamera = true;
    }
    document.body.style.setProperty("--boost", String(this.boostEnvelope));
    const now = performance.now();
    if (this.previous) {
      const ms = now - this.previous;
      if (ms < 5000) {
        this.frameIntervals.push(ms);
        if (this.frameIntervals.length > 3600) this.frameIntervals.shift();
      }
      const f = this.profiler.endFrame(ms, 0);
      this.draws = f.drawCalls;
      this.triangles = f.triangles;
      this.profiler.beginFrame();
    }
    this.previous = now;
  }
  private placeCar(
    i: number,
    x: number,
    z: number,
    angle: number,
    s: number,
    boosting: boolean,
    color: string,
  ) {
    const car = this.cars[i],
      t = TRACKS[this.trackId],
      ahead = roadHeight(t, s + 3),
      behind = roadHeight(t, s - 3),
      pitch = (-Math.atan2(ahead - behind, 6) * 180) / Math.PI;
    car.transform.position = new Laya.Vector3(
      x * SCALE,
      roadHeight(t, s) + 0.05,
      z * SCALE,
    );
    car.transform.rotationEuler = new Laya.Vector3(
      pitch,
      ((Math.PI / 2 - angle) * 180) / Math.PI,
      0,
    );
    this.rearFlames[i].active = boosting;
    if (i === 0) {
      const h = parseInt(color.slice(1), 16);
      this.accentMaterials[0].albedoColor = new Laya.Color(
        ((h >> 16) & 255) / 255,
        ((h >> 8) & 255) / 255,
        (h & 255) / 255,
        1,
      );
    }
  }
  stats() {
    const f = [...this.frameIntervals].sort((a, b) => a - b);
    return {
      resources: inspectSceneResources(),
      dimension: 3,
      vehicle: {
        asset: "maextro-s800",
        importedInstances: this.carInstances.length,
        playerTriangles: playerModel.triangles,
        rivalTriangles: rivalModel.triangles,
        payloadBytes: playerModel.bytes + rivalModel.bytes,
        library: this.carLibrary.report(),
      },
      particles: this.systems.reduce((s, p) => s + p.aliveCount, 0),
      trailPoints: this.trails.reduce((s, t) => s + t.pointCount, 0),
      maps: this.maps.size,
      finite: this.systems.every((s) =>
        s
          .snapshot()
          .every(
            (p) =>
              Number.isFinite(p.x) &&
              Number.isFinite(p.y) &&
              Number.isFinite(p.z),
          ),
      ),
      drawCalls: this.draws,
      triangles: this.triangles,
      p95: f[Math.floor(f.length * 0.95)] || 0,
      terrain: this.world.terrains.map((t) => t.report()),
      camera: { x: this.cx, y: this.cy, z: this.cz },
    };
  }
}

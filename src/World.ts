import {
  ZhudaShaderMaterial,
  ZhudaHeightfield,
  ZhudaTerrain3D,
  createSurfaceMaterial,
  disposeSurfaceMaterial,
  ZhudaSceneQueries,
} from "zhuda-laya-engine";
import { Geometry, type V } from "./Geometry";
import { at, nearest, type Track } from "./Tracks";
declare const Laya: any;
export const SCALE = 0.1;
export function roadHeight(t: Track, s: number) {
  const a = (s / t.length) * Math.PI * 2;
  return 15 + Math.sin(a) * 4 + Math.sin(a * 2 + t.id) * 2;
}
export function roadPoint(t: Track, s: number, lane = 0, dy = 0): V {
  const p = at(t, s, lane);
  return [p.x * SCALE, roadHeight(t, s) + dy, p.y * SCALE];
}
const rgb = (s: string): [number, number, number] => [
  parseInt(s.slice(1, 3), 16) / 255,
  parseInt(s.slice(3, 5), 16) / 255,
  parseInt(s.slice(5, 7), 16) / 255,
];
export class World {
  root = new Laya.Sprite3D("NeonWorld");
  meshes: any[] = [];
  materials: any[] = [];
  shaders: ZhudaShaderMaterial[] = [];
  terrains: ZhudaTerrain3D[] = [];
  queries = new ZhudaSceneQueries();
  private batches = new Map<any, Geometry>();
  constructor(
    public track: Track,
    parent: any,
  ) {
    parent.addChild(this.root);
    this.build();
  }
  mat(hex: string, lit = true) {
    const m = createSurfaceMaterial({
      type: lit ? "pbr" : "unlit",
      color: [...rgb(hex), 1],
      metallic: lit ? 0.15 : 0,
      roughness: 0.55,
    });
    this.materials.push(m);
    return m;
  }
  shader(
    name: string,
    uniforms: any,
    surface: string,
    doubleSided = false,
    fog = true,
  ) {
    const s = new ZhudaShaderMaterial({
      schemaVersion: 1,
      dimension: 3,
      name: "Zhuda" + name,
      uniforms,
      surface,
      doubleSided,
      fog,
    });
    this.shaders.push(s);
    return s;
  }
  batch(m: any) {
    if (!this.batches.has(m)) this.batches.set(m, new Geometry());
    return this.batches.get(m)!;
  }
  box(
    m: any,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    yaw = 0,
  ) {
    this.batch(m).box(x, y, z, w, h, d, yaw);
  }
  build() {
    const t = this.track,
      accent = rgb(t.color),
      asphalt = this.shader(
        "NeonRoad3D",
        { u_ZhudaAccent: { type: "vec3", value: accent } },
        `vec4 zhudaSurface(vec2 uv,vec3 p,vec3 n){vec3 base=mix(vec3(.008,.014,.025),vec3(.02,.025,.045),uv.x);float lane=(1.0-smoothstep(.003,.008,abs(uv.x-.333)))+(1.0-smoothstep(.003,.008,abs(uv.x-.667)));float dash=step(.45,fract(uv.y*.5));base+=vec3(.32,.46,.55)*lane*dash;float sheen=pow(max(0.0,sin(p.x*.016+p.z*.012)),12.0);base+=u_ZhudaAccent*sheen*.06;float seams=1.0-smoothstep(.0,.018,fract(uv.y*.3));return vec4(base+vec3(.06)*seams,1.0);}`,
      ),
      deck = this.mat("#20283f"),
      white = this.mat("#d8eff3", false),
      dark = this.mat("#14182d"),
      accentM = this.mat(t.color, false),
      pink = this.mat("#ff4f9c", false),
      gold = this.mat("#ffb478", false),
      glass = this.mat("#304567"),
      windows = this.mat("#8ddae1", false);
    // A closed elevated ribbon, with alternating curbs and luminous guard rails.
    for (let i = 0; i < t.points.length; i++) {
      const a = t.points[i],
        b = t.points[(i + 1) % t.points.length],
        sa = a.s,
        sb = i === t.points.length - 1 ? t.length : b.s,
        hw = t.width / 2,
        ribbon = (m: any, l0: number, l1: number, h = 0) =>
          this.batch(m).quad(
            roadPoint(t, sa, l0, h),
            roadPoint(t, sb, l0, h),
            roadPoint(t, sb, l1, h),
            roadPoint(t, sa, l1, h),
            [0, 1, 0],
            [
              l0 / t.width + 0.5,
              sa / 12,
              l0 / t.width + 0.5,
              sb / 12,
              l1 / t.width + 0.5,
              sb / 12,
              l1 / t.width + 0.5,
              sa / 12,
            ],
          );
      ribbon(asphalt.material, -hw, hw);
      ribbon(i % 4 < 2 ? white : accentM, -hw - 6, -hw, 0.03);
      ribbon(i % 4 < 2 ? white : pink, hw, hw + 6, 0.03);
      ribbon(accentM, -hw - 8, -hw - 6, 0.7);
      ribbon(pink, hw + 6, hw + 8, 0.7);
      for (const side of [-1, 1]) {
        const lane = side * (hw + 8);
        this.batch(deck).quad(
          roadPoint(t, sa, lane),
          roadPoint(t, sa, lane, -1.4),
          roadPoint(t, sb, lane, -1.4),
          roadPoint(t, sb, lane),
          [Math.sin(a.angle) * -side, 0, Math.cos(a.angle) * side],
        );
      }
      this.batch(deck).quad(
        roadPoint(t, sa, -hw - 8, -1.4),
        roadPoint(t, sa, hw + 8, -1.4),
        roadPoint(t, sb, hw + 8, -1.4),
        roadPoint(t, sb, -hw - 8, -1.4),
        [0, -1, 0],
      );
      if (i % 12 === 0)
        for (const side of [-1, 1]) {
          const p = roadPoint(t, sa, side * (hw + 8));
          this.box(deck, p[0], p[1] + 0.5, p[2], 0.35, 1.8, 0.35);
        }
      if (i % 28 === 0) {
        const p = roadPoint(t, sa);
        this.box(deck, p[0], p[1] / 2 - 5, p[2], 2, p[1] + 10, 2);
      }
    }
    // Start gantry and light gates create readable corners and strong depth cues.
    for (const [j, f] of [0, 0.23, 0.48, 0.75].entries()) {
      const s = t.length * f + 35,
        p = roadPoint(t, s),
        a = at(t, s).angle,
        yaw = Math.PI / 2 - a;
      for (const side of [-1, 1]) {
        const v = roadPoint(t, s, side * (t.width / 2 + 14));
        this.box(dark, v[0], v[1] + 4.6, v[2], 1.2, 9.2, 1.2, yaw);
        this.box(
          j % 2 ? pink : accentM,
          v[0],
          v[1] + 4.6,
          v[2],
          0.2,
          8.8,
          1.3,
          yaw,
        );
      }
      this.box(dark, p[0], p[1] + 9, p[2], t.width * SCALE + 4, 1.3, 1.4, yaw);
      this.box(
        j % 2 ? pink : accentM,
        p[0],
        p[1] + 8.3,
        p[2],
        t.width * SCALE + 4,
        0.16,
        1.5,
        yaw,
      );
    }
    // Energy strips award nitro through the existing race rules.
    for (const f of t.pads)
      for (let j = 0; j < 5; j++) {
        const s = f * t.length - 20 + j * 8,
          p = roadPoint(t, s, 0, 0.06),
          yaw = Math.PI / 2 - at(t, s).angle;
        this.box(accentM, p[0], p[1], p[2], 10, 0.05, 0.38, yaw);
      }
    // Fixed-seed skyline. It never changes the race simulation or blocks the road.
    let seed = 622 + t.id * 137;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 100; i++) {
      const x = -60 + random() * 330,
        z = -60 + random() * 330;
      if (
        nearest(t, x / SCALE, z / SCALE).distance * SCALE <
        (t.width * SCALE) / 2 + 9
      )
        continue;
      const w = 4 + random() * 10,
        d = 4 + random() * 10,
        h = 9 + random() * 63,
        y = -12;
      this.box(i % 3 ? dark : glass, x, y + h / 2, z, w, h, d);
      this.box(
        i % 4 ? accentM : pink,
        x,
        y + h + 0.05,
        z,
        w + 0.1,
        0.15,
        d + 0.1,
      );
      for (let row = 0; row < h / 3; row++)
        for (const side of [-1, 1]) {
          const gy = y + 2 + row * 3;
          this.box(
            (row + i) % 4 ? windows : gold,
            x,
            gy,
            z + side * (d / 2 + 0.02),
            w * 0.75,
            0.16,
            0.04,
          );
        }
      if (i % 3 === 0) this.box(accentM, x, y + h + 3, z, 0.15, 6, 0.15);
    }
    // The centerpiece, a luminous launch tower surrounded by three sky rings.
    const cx = 100,
      cz = 100;
    this.box(glass, cx, 21, cz, 15, 66, 15);
    this.box(dark, cx, 62, cz, 8, 16, 8);
    this.box(pink, cx, 79, cz, 0.6, 20, 0.6);
    for (let ring = 0; ring < 3; ring++)
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2,
          r = 23 + ring * 5;
        this.box(
          ring === 1 ? pink : accentM,
          cx + Math.cos(a) * r,
          38 + ring * 11,
          cz + Math.sin(a) * r,
          3.9,
          0.3,
          0.6,
          -a,
        );
      }
    // True heightfield islands have closed rocky sides and undersides.
    const terrainShader = this.shader(
        "NeonIslandSurface",
        {},
        `vec4 zhudaSurface(vec2 uv,vec3 p,vec3 n){float slope=1.0-abs(n.y);vec3 grass=mix(vec3(.07,.25,.23),vec3(.12,.44,.33),smoothstep(0.0,5.0,p.y));vec3 rock=mix(vec3(.10,.09,.18),vec3(.23,.16,.28),.5+.5*sin(p.y*1.8));return vec4(mix(grass,rock,smoothstep(.12,.65,slope))*(.6+.4*max(0.0,dot(n,normalize(vec3(.3,1.0,.4))))),1.0);}`,
      ),
      rockShader = this.shader(
        "NeonIslandRock",
        {},
        `vec4 zhudaSurface(vec2 uv,vec3 p,vec3 n){float band=.5+.5*sin(p.y*.8);return vec4(mix(vec3(.055,.055,.12),vec3(.19,.12,.22),band)*(.7+.3*abs(n.y)),1.0);}`,
      );
    for (const [j, center] of [
      [35, 95],
      [170, 55],
      [150, 170],
      [-30, 180],
      [240, 150],
    ].entries()) {
      const cells = 24,
        size = 2.6,
        half = (cells * size) / 2,
        heights = Array.from({ length: (cells + 1) ** 2 }, (_, i) => {
          const x = ((i % (cells + 1)) - cells / 2) / (cells / 2),
            z = (Math.floor(i / (cells + 1)) - cells / 2) / (cells / 2);
          return (
            Math.max(0, 1 - Math.hypot(x, z)) *
            (7 + Math.sin(x * 5 + j) * 2 + Math.cos(z * 6) * 2)
          );
        });
      const field = new ZhudaHeightfield({
          schemaVersion: 1,
          dimension: 3,
          cellsX: cells,
          cellsZ: cells,
          cellSize: size,
          origin: [-half, -half],
          heights,
        }),
        terrain = new ZhudaTerrain3D(field, {
          parent: this.root,
          material: terrainShader.material,
          solid: { depth: 18, material: rockShader.material },
          chunkCells: 32,
          maxResidentChunks: 1,
        });
      terrain.root.transform.position = new Laya.Vector3(
        center[0],
        -9,
        center[1],
      );
      terrain.setRegion({ minX: -half, minZ: -half, maxX: half, maxZ: half });
      this.terrains.push(terrain);
      this.queries.register(terrain.queryProvider("island-" + j));
    }
    // A procedural sunset sky and moving ocean use public shader contracts.
    const sky = this.shader(
      "NeonSunsetSky",
      {
        u_ZhudaHorizon: {
          type: "vec3",
          value:
            t.id === 1
              ? [0.15, 0.06, 0.27]
              : t.id === 3
                ? [0.28, 0.04, 0.17]
                : [0.65, 0.25, 0.27],
        },
        u_ZhudaZenith: { type: "vec3", value: [0.025, 0.045, 0.12] },
      },
      `vec4 zhudaSurface(vec2 uv,vec3 p,vec3 n){vec3 d=normalize(p);float h=clamp(d.y*1.8,0.0,1.0);vec3 color=mix(u_ZhudaHorizon,u_ZhudaZenith,pow(h,.6));vec3 sun=normalize(vec3(1.0,.18,.27));float s=dot(d,sun);color+=vec3(1.0,.42,.12)*pow(max(s,0.0),22.0)*.35;color=mix(color,vec3(1.0,.72,.4),smoothstep(.996,.997,s));float stars=pow(fract(sin(dot(floor(d.xz*480.0),vec2(12.98,78.23)))*43758.54),90.0)*smoothstep(.15,.6,d.y);color+=vec3(.1)*stars*smoothstep(.6,.9,d.y);return vec4(color,1.0);}`,
      true,
      false,
    );
    const skyNode = new Laya.MeshSprite3D(
      Laya.PrimitiveMesh.createSphere(650, 32, 32),
    );
    skyNode.meshRenderer.sharedMaterial = sky.material;
    this.root.addChild(skyNode);
    this.meshes.push({
      dispose: () => {
        const mesh = skyNode.meshFilter.sharedMesh;
        skyNode.destroy();
        mesh.destroy();
      },
    });
    const water = this.shader(
      "NeonOcean3D",
      { u_ZhudaTime: { type: "float", value: 0 } },
      `vec4 zhudaSurface(vec2 uv,vec3 p,vec3 n){float a=sin(p.x*.13+p.z*.17+u_ZhudaTime*.5),b=sin(p.z*.39-p.x*.09-u_ZhudaTime*.7);vec3 c=mix(vec3(.025,.065,.14),vec3(.07,.19,.27),.5+.25*(a+b));float streak=pow(max(0.0,sin(p.z*.55+sin(p.x*.1)+u_ZhudaTime*.7)),22.0);c+=vec3(.13,.19,.22)*streak;return vec4(c,1.0);}`,
    );
    this.batch(water.material).quad(
      [-600, -13, -600],
      [600, -13, -600],
      [600, -13, 600],
      [-600, -13, 600],
      [0, 1, 0],
    );
    for (const [m, g] of this.batches)
      this.meshes.push(g.build(this.root, m, "static-batch"));
    this.batches.clear();
  }
  update(time: number) {
    for (const s of this.shaders)
      if (s.spec.uniforms?.u_ZhudaTime) s.setUniform("u_ZhudaTime", time);
  }
  dispose() {
    for (const t of this.terrains) t.dispose();
    for (const m of this.meshes) m.dispose();
    this.root.destroy(true);
    for (const s of this.shaders) s.dispose();
    for (const m of this.materials) disposeSurfaceMaterial(m);
    this.queries.clear();
  }
}

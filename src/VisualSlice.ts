import {
  ZhudaEngine,
  ZhudaDynamicMesh,
  computeMeshTangents,
  ZhudaLitSurfaceMaterial,
  ZhudaShaderMaterial,
  ZhudaFilmicPipeline,
  ZhudaPlanarReflection,
  createPrefilteredEnvironment,
  createSurfaceMaterial,
  ZhudaModelLibrary,
  inspectSceneResources,
} from "zhuda-laya-engine";
import { Geometry, type V } from "./Geometry";
import { HarborVehicle, harborHeight, cameraObstruction, wrapAngle, type DriveObstacle } from "./HarborDriving";
import { verifyEnvironmentUpload } from "./VisualVerification";
import environment from "../public/visual-assets/harbor-ibl.json";
import carAsset from "../public/visual-assets/maextro-s800-hero.json";
import scenery from "../public/visual-assets/scenery.json";
declare const Laya: any;
const $ = (id: string) => document.getElementById(id)!;
const radians = (n: number) => (n * Math.PI) / 180;
const materialNodes: any[] = [];
const meshes: ZhudaDynamicMesh[] = [];
const normalTextures: any[] = [];
function mesh(g: Geometry, material: any, parent: any, name: string) {
  const data = {
    positions: new Float32Array(g.p),
    normals: new Float32Array(g.n),
    uvs: new Float32Array(g.uv),
    indices: new Uint16Array(g.ix),
  };
  const result = new ZhudaDynamicMesh(
    { ...data, tangents: computeMeshTangents(data) },
    parent,
  );
  result.node.name = name;
  result.node.meshRenderer.sharedMaterial = material;
  result.node.meshRenderer.castShadow = true;
  result.node.meshRenderer.receiveShadow = true;
  meshes.push(result);
  return result.node;
}
function roundedBox(w: number, h: number, d: number, radius = 0.04) {
  const g = new Geometry(),
    half = [w / 2, h / 2, d / 2];
  for (let face = 0; face < 6; face++) {
    const axis = Math.floor(face / 2),
      sign = face % 2 ? -1 : 1,
      u = (axis + 1) % 3,
      v = (axis + 2) % 3;
    const steps = 6,
      start = g.p.length / 3;
    for (let y = 0; y <= steps; y++)
      for (let x = 0; x <= steps; x++) {
        const fractions = [-1, -0.98, -0.8, 0, 0.8, 0.98, 1];
        const p = [0, 0, 0];
        p[axis] = half[axis] * sign;
        p[u] = half[u] * fractions[x];
        p[v] = half[v] * fractions[y];
        const core = p.map((n, k) =>
          Math.max(
            -Math.max(0, half[k] - radius),
            Math.min(Math.max(0, half[k] - radius), n),
          ),
        );
        const normal = p.map((n, k) => n - core[k]);
        const len = Math.hypot(...normal) || 1;
        g.p.push(...core.map((n, k) => n + (normal[k] / len) * radius));
        g.n.push(...normal.map((n) => n / len));
        g.uv.push((fractions[x] + 1) * half[u], (fractions[y] + 1) * half[v]);
      }
    for (let y = 0; y < steps; y++)
      for (let x = 0; x < steps; x++) {
        const a = start + y * (steps + 1) + x,
          b = a + 1,
          c = a + steps + 2,
          e = a + steps + 1;
        g.ix.push(...(sign < 0 ? [a, b, c, a, c, e] : [a, c, b, a, e, c]));
      }
  }
  return g;
}
function tubes(g: Geometry, a: V, b: V, r: number) {
  const v = b.map((n, i) => n - a[i]),
    length = Math.hypot(...v),
    dir = v.map((n) => n / length);
  const cross = (u: number[], v: number[]) => [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  let right = cross(dir, Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  const len = Math.hypot(...right);
  right = right.map((n) => n / len);
  const up = cross(right, dir);
  const point = (p: V, t: number): V =>
    p.map(
      (n, k) => n + r * (Math.cos(t) * right[k] + Math.sin(t) * up[k]),
    ) as V;
  for (let i = 0; i < 8; i++) {
    const t = (i * Math.PI) / 4,
      next = ((i + 1) * Math.PI) / 4,
      normal = right.map(
        (n, k) => n * Math.cos(t + 0.3927) + up[k] * Math.sin(t + 0.3927),
      ) as V;
    g.quad(point(a, t), point(a, next), point(b, next), point(b, t), normal, [
      0,
      0,
      r,
      0,
      r,
      length,
      0,
      length,
    ]);
  }
}
async function texture(file: string, color = false) {
  const image = new Image();
  image.src = new URL("visual-assets/" + file, document.baseURI).href;
  await image.decode();
  const t = new Laya.Texture2D(
    image.naturalWidth,
    image.naturalHeight,
    Laya.TextureFormat.R8G8B8A8,
    true,
    false,
    color,
  );
  t.setImageData(image, false, false);
  t.wrapModeU = t.wrapModeV = Laya.WrapMode.Repeat;
  t.anisoLevel = 16;
  return t;
}
class HarborStudy {
  ready = false;
  scene: any;
  camera: any;
  pipeline!: ZhudaFilmicPipeline;
  sun: any;
  sky!: ZhudaShaderMaterial;
  car: any;
  carInstance: any;
  warehouse: any;
  library = new ZhudaModelLibrary(1);
  view = "hero";
  moving = false;
  freeExplore = false;
  private driveObstacles: DriveObstacle[] = [];
  vehicle = new HarborVehicle(this.driveObstacles);
  drivingCar: any;
  drivingBody: any;
  wheels: {steer: any; axle: any; front: boolean; side: number}[] = [];
  private driveSpawn: V = [-1.4, 0, 1.5];
  private freeCameraX = 0;
  private freeCameraY = 3.4;
  private freeCameraZ = -8;
  private freeCameraYaw = Math.PI;
  private freePitch = 0.34;
  private freeLookIdle = 0;
  private freeDistance = 8.6;
  private freeKeys = new Set<string>();
  private freePointer: { id: number; x: number; y: number } | null = null;
  get freeYaw() { return this.vehicle.yaw * 180 / Math.PI; }
  get freeBodyRoll() { return this.vehicle.roll * 180 / Math.PI; }
  comparison = false;
  time = 0;
  frames = 0;
  surfaces: ZhudaLitSurfaceMaterial[] = [];
  environment: any;
  private last = 0;
  private frameIntervals: number[] = [];
  reflection!: ZhudaPlanarReflection;
  puddle!: ZhudaShaderMaterial;
  verifyEnvironmentUpload = verifyEnvironmentUpload;
  private enterFreeExplore() {
    const p = this.car.transform.position;
    this.driveSpawn = [p.x, p.y, p.z];
    this.vehicle.reset(p.x, p.z, Math.PI);
    this.freeCameraYaw = this.vehicle.yaw;
    this.freePitch = 0.34;
    this.freeLookIdle = 0;
    this.freeKeys.clear();
    this.freeExplore = true;
    this.moving = false;
    this.view = "free";
    this.car.active = false;
    this.drivingCar.active = true;
    this.updateDrivingModel();
    document.body.classList.add("exploring");
    $("explore").setAttribute("aria-pressed", "true");
    $("explore").textContent = "EXIT DRIVE";
    $("motion").setAttribute("aria-pressed", "false");
    document.querySelectorAll("[data-view]").forEach(v => v.setAttribute("aria-pressed", "false"));
    this.resetChaseCamera();
    this.pipeline.resetHistory();
  }
  private resetChaseCamera() {
    const v = this.vehicle;
    this.freeCameraYaw = v.yaw;
    this.freeCameraX = v.x - Math.sin(v.yaw) * this.freeDistance;
    this.freeCameraY = v.y + 3.5;
    this.freeCameraZ = v.z - Math.cos(v.yaw) * this.freeDistance;
  }
  private resetDriving() {
    this.vehicle.reset(this.driveSpawn[0], this.driveSpawn[2], Math.PI);
    this.freeKeys.clear();
    this.freePointer = null;
    this.freeLookIdle = 0;
    this.resetChaseCamera();
    this.updateDrivingModel();
    this.pipeline.resetHistory();
  }
  private exitFreeExplore() {
    this.freeExplore = false;
    this.freeKeys.clear();
    this.freePointer = null;
    this.drivingCar.active = false;
    this.car.active = true;
    document.body.classList.remove("exploring");
    $("explore").setAttribute("aria-pressed", "false");
    $("explore").textContent = "EXPLORE";
    this.view = "hero";
    this.car.transform.rotationEuler = new Laya.Vector3(0, 180, 0);
    this.pipeline.resetHistory();
  }
  private updateDrivingModel() {
    const v = this.vehicle, deg = 180 / Math.PI;
    this.drivingCar.transform.position = new Laya.Vector3(v.x,v.y,v.z);
    this.drivingCar.transform.rotationEuler = new Laya.Vector3(v.groundPitch * deg, v.yaw * deg, 0);
    this.drivingBody.transform.localRotationEuler = new Laya.Vector3(v.pitch * deg,0,v.roll * deg);
    this.drivingBody.transform.localPosition = new Laya.Vector3(0,-Math.abs(v.roll) * 0.08,0);
    for (const w of this.wheels) {
      const radius = Math.abs(v.steering) > 0.001 ? 3.37 / Math.tan(Math.abs(v.steering)) : 1e8;
      const inside = Math.sign(v.steering) === w.side;
      const steer = w.front ? Math.sign(v.steering) * Math.atan(3.37 / Math.max(1, radius + (inside ? -0.86 : 0.86))) : 0;
      w.steer.transform.localRotationEuler = new Laya.Vector3(0,steer * deg,0);
      w.axle.transform.localRotationEuler = new Laya.Vector3(v.wheelTravel / 0.388 * deg % 360,0,0);
    }
  }
  private freeStep(dt: number) {
    this.vehicle.update(dt, {
      throttle: Number(this.freeKeys.has("KeyW") || this.freeKeys.has("ArrowUp")) - Number(this.freeKeys.has("KeyS") || this.freeKeys.has("ArrowDown")),
      steer: Number(this.freeKeys.has("KeyD") || this.freeKeys.has("ArrowRight")) - Number(this.freeKeys.has("KeyA") || this.freeKeys.has("ArrowLeft")),
      boost: this.freeKeys.has("ShiftLeft") || this.freeKeys.has("ShiftRight"),
      handbrake: this.freeKeys.has("Space"),
    });
    this.updateDrivingModel();
    if (this.freeLookIdle > 0) this.freeLookIdle -= dt;
    else if (!this.freePointer && Math.abs(this.vehicle.speed) > 0.5) {
      this.freeCameraYaw += wrapAngle(this.vehicle.yaw - this.freeCameraYaw) * (1-Math.exp(-2.4*dt));
    }
    $("speed-value").textContent = String(Math.round(Math.abs(this.vehicle.speed) * 3.6)).padStart(3,"0");
    $("gear-value").textContent = this.vehicle.speed < -0.2 ? "R" : Math.abs(this.vehicle.speed) < 0.2 ? "N" : "D";
  }
  private freePose(dt: number) {
    const v = this.vehicle, angle = this.freeCameraYaw,
      distance = this.freeDistance + Math.min(2.3, Math.abs(v.speed)*0.065),
      follow = 1 - Math.exp(-6.5 * Math.min(0.25,dt)),
      target: V = [v.x + Math.sin(v.yaw)*1.2,v.y+0.95,v.z+Math.cos(v.yaw)*1.2],
      desired: V = [v.x-Math.sin(angle)*distance*Math.cos(this.freePitch),v.y+1.1+Math.sin(this.freePitch)*distance,v.z-Math.cos(angle)*distance*Math.cos(this.freePitch)];
    this.freeCameraX += (desired[0]-this.freeCameraX)*follow;
    this.freeCameraY += (desired[1]-this.freeCameraY)*follow;
    this.freeCameraZ += (desired[2]-this.freeCameraZ)*follow;
    const eye: V = [this.freeCameraX,this.freeCameraY,this.freeCameraZ],
      obstruction = cameraObstruction(target,eye,this.driveObstacles);
    for(let i=0;i<3;i++) eye[i]=target[i]+(eye[i]-target[i])*obstruction;
    eye[1]=Math.max(eye[1],(harborHeight(eye[0],eye[2]) ?? -7)+0.3);
    return {eye,target,fov:56+Math.min(7,Math.abs(v.speed)*0.2)};
  }
  rebuildPipeline() {
    this.pipeline?.dispose();
    this.pipeline = new ZhudaFilmicPipeline(this.camera, {
      exposure: 1.45,
      contrast: 1.025,
      saturation: 0.94,
      aoIntensity: 0.4,
      aoRadius: 0.45,
      bloomIntensity: 0.08,
      temporalAA: true,
    });
  }
  async init() {
    await ZhudaEngine.boot({
      width: innerWidth,
      height: innerHeight,
      features: ["core", "3d", "gltf", "postProcess"],
      dprCap: 2,
      antialias: true,
      preserveDrawingBuffer: false,
      bgColor: "#131924",
    });
    const l = Laya;
    this.scene = new l.Scene3D();
    l.stage.addChild(this.scene);
    this.scene.enableFog = true;
    this.scene.fogColor = new l.Color(0.32, 0.38, 0.46, 1);
    this.scene.fogStart = 170;
    this.scene.fogRange = 700;
    this.scene.ambientIntensity = 1.2;
    this.scene.reflectionIntensity = 1;
    this.camera = new l.Camera(0, 0.08, 1500);
    this.camera.fieldOfView = 43;
    this.camera.clearColor = new l.Color(0.13, 0.18, 0.23, 1);
    this.scene.addChild(this.camera);
    this.rebuildPipeline();
    const sunNode = new l.Sprite3D("sun");
    this.scene.addChild(sunNode);
    this.sun = sunNode.addComponent(l.DirectionLightCom);
    this.sun.color = new l.Color(1, 0.79, 0.57, 1);
    this.sun.intensity = 2.4;
    this.sun.shadowMode = l.ShadowMode.SoftHigh;
    this.sun.shadowResolution = 4096;
    this.sun.shadowDistance = 130;
    this.sun.shadowCascadesMode = l.ShadowCascadesMode.FourCascades;
    this.sun.shadowDepthBias = 0.7;
    this.sun.shadowNormalBias = 0.7;
    const sd = environment.sunDirection;
    sunNode.transform.lookAt(
      new l.Vector3(-sd[0], -sd[1], -sd[2]),
      new l.Vector3(0, 1, 0),
      false,
    );
    $("progress").textContent =
      "Preparing physical materials and convolved HDR light…";
    const [
      bytes,
      skyTexture,
      asphalt,
      anormal,
      arough,
      concrete,
      cnormal,
      crough,
    ] = await Promise.all([
      fetch(new URL("visual-assets/harbor-ibl.bin", document.baseURI)).then(
        (r) => {
          if (!r.ok) throw Error("HDR light download failed");
          return r.arrayBuffer();
        },
      ),
      l.loader.load(
        new URL("visual-assets/kloppenheim_06_puresky_4k.hdr", document.baseURI)
          .href,
      ),
      texture("asphalt-color.jpg", true),
      texture("asphalt-normal.jpg"),
      texture("asphalt-metallic-smoothness.png"),
      texture("concrete-color.jpg", true),
      texture("concrete-normal.jpg"),
      texture("concrete-metallic-smoothness.png"),
    ]);
    this.environment = createPrefilteredEnvironment(
      environment,
      new Float32Array(bytes),
    );
    this.environment.apply(this.scene);
    normalTextures.push(anormal, cnormal);
    this.sky = new ZhudaShaderMaterial(
      {
        schemaVersion: 1,
        name: "ZhudaHarborHDRSky",
        dimension: 3,
        fog: false,
        doubleSided: true,
        depthWrite: false,
        uniforms: { u_ZhudaSky: { type: "texture2D" } },
        surface: `vec4 zhudaSurface(vec2 uv,vec3 p,vec3 n){vec3 d=normalize(p-u_CameraPos);vec2 st=vec2(atan(d.z,d.x)/6.2831853+.5,acos(clamp(d.y,-1.0,1.0))/3.14159265);return vec4(zhudaSample_u_ZhudaSky(st).rgb,1.0);}`,
      },
      { u_ZhudaSky: skyTexture },
    );
    const skyNode = new l.MeshSprite3D(
      l.PrimitiveMesh.createSphere(1000, 64, 64),
    );
    skyNode.name = "physical-hdr-sky";
    skyNode.meshRenderer.sharedMaterial = this.sky.material;
    this.scene.addChild(skyNode);
    const lit = (
      name: string,
      color: [number, number, number, number],
      rough = 0.6,
      metallic = 0,
      textures?: any,
      surface?: string,
    ) => {
      const s = new ZhudaLitSurfaceMaterial({
        name: "ZhudaHarbor" + name,
        normalConvention: "opengl",
        uniforms: { u_ZhudaWet: { type: "float", value: 0.7 } },
        material: {
          color,
          roughness: rough,
          metallic,
          textures,
          clearCoat: name === "Asphalt" ? 0.3 : 0,
          clearCoatRoughness: 0.12,
        },
        surface:
          surface ||
          "void zhudaSurface(inout ZhudaLitSurface s,vec2 uv,vec3 p,vec3 n){}",
      });
      this.surfaces.push(s);
      return s.material;
    };
    const road = lit(
      "Asphalt",
      [0.66, 0.68, 0.7, 1],
      0.96,
      0,
      { albedo: asphalt, normal: anormal, metallicGloss: arough },
      `float zhudaNoise(vec2 p){return sin(p.x*.32+sin(p.y*.21))*sin(p.y*.14+p.x*.07)*.5+.5;}void zhudaSurface(inout ZhudaLitSurface s,vec2 uv,vec3 p,vec3 n){float wet=smoothstep(.43,.78,zhudaNoise(p.xz))*u_ZhudaWet*.45;float tire=exp(-pow((abs(p.x)-2.0)*2.5,2.0));s.baseColor*=mix(1.0,.5,wet)*(1.0-tire*.14);s.roughness=mix(max(.48,s.roughness),.13,wet);}`,
    );
    const concreteMat = lit("Concrete", [1, 1, 1, 1], 0.85, 0, {
      albedo: concrete,
      normal: cnormal,
      metallicGloss: crough,
    });
    const metal = lit("Steel", [0.19, 0.23, 0.25, 1], 0.3, 0.87);
    const dark = lit("Rubber", [0.035, 0.041, 0.044, 1], 0.85, 0);
    const white = lit(
      "RoadPaint",
      [0.7, 0.69, 0.61, 1],
      0.65,
      0,
      undefined,
      `void zhudaSurface(inout ZhudaLitSurface s,vec2 uv,vec3 p,vec3 n){s.baseColor*=.8+.2*sin(p.z*139.0)*sin(p.x*173.0);}`,
    );
    const glass = lit("Glass", [0.075, 0.13, 0.17, 1], 0.11, 0.82);
    const trim = lit("Aluminum", [0.43, 0.48, 0.51, 1], 0.28, 0.9);
    const box = (
      name: string,
      mat: any,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      r = 0.035,
    ) => {
      const node = mesh(roundedBox(w, h, d, r), mat, this.scene, name);
      node.transform.position = new l.Vector3(x, y, z);
      if (["shipping-container", "warehouse-main", "crane-leg", "crane-outboard-leg",
        "crane-wheel-bogie", "loading-bollard", "streetlamp-base"].includes(name))
        this.driveObstacles.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2,minY:y-h/2,maxY:y+h/2});
      if (y + h / 2 <= 0.027) node.layer = 2;
      materialNodes.push(node);
      return node;
    };
    // Complete civil structure, 240 metres of physically sized waterfront highway.
    const roadG = new Geometry();
    roadG.quad(
      [-8, 0, -60],
      [8, 0, -60],
      [8, 0, 180],
      [-8, 0, 180],
      [0, 1, 0],
      [0, 0, 4, 0, 4, 60, 0, 60],
    );
    mesh(roadG, road, this.scene, "wet-asphalt").layer = 2;
    box("bridge-deck", concreteMat, 0, -0.65, 60, 18, 1.25, 240, 0.08);
    // Continuous, visible access ramp from bridge level to the quay forecourt.
    const ramp = new Geometry(), rampNormal = [0,1,4.994/54] as V;
    const rn = Math.hypot(...rampNormal);
    ramp.quad([-8,0,180],[8,0,180],[8,-4.994,234],[-8,-4.994,234],rampNormal.map(n=>n/rn) as V,[0,0,4,0,4,13.5,0,13.5]);
    mesh(ramp,road,this.scene,"harbor-access-ramp").layer=2;
    const rampSides = new Geometry();
    for(const x of [-8,8]) {
      rampSides.quad([x,0,180],[x,-0.8,180],[x,-5.794,234],[x,-4.994,234],[Math.sign(x),0,0]);
      tubes(rampSides,[x,0.65,180],[x,-4.344,234],0.09);
    }
    mesh(rampSides,concreteMat,this.scene,"ramp-structure-and-rails");
    for (const side of [-1, 1]) {
      box(
        "paved-shoulder",
        concreteMat,
        side * 8.5,
        0.12,
        60,
        1,
        0.25,
        240,
        0.02,
      );
      box(
        "expansion-rail",
        metal,
        side * 8.98,
        0.21,
        60,
        0.08,
        0.05,
        240,
        0.015,
      );
      for (let z = -58; z < 180; z += 4) {
        // Jersey profile, chamfered edges and bolted galvanized metal rails.
        const g = new Geometry(),
          profile = [
            [-0.33, 0],
            [0.33, 0],
            [0.33, 0.25],
            [0.13, 0.63],
            [0.13, 1.12],
            [-0.13, 1.12],
            [-0.13, 0.63],
            [-0.33, 0.25],
          ];
        for (let j = 0; j < profile.length; j++) {
          const a = profile[j],
            b = profile[(j + 1) % profile.length];
          const dx = b[0] - a[0],
            dy = b[1] - a[1],
            len = Math.hypot(dx, dy);
          g.quad(
            [a[0], a[1], -1.96],
            [b[0], b[1], -1.96],
            [b[0], b[1], 1.96],
            [a[0], a[1], 1.96],
            [dy / len, -dx / len, 0],
            [0, 0, len, 0, len, 3.92, 0, 3.92],
          );
        }
        if (z >= -14 && z <= 22) {
          const asset = scenery[1],
            instance = await this.library.instantiate(
              new URL(
                "visual-assets/" +
                  asset.file +
                  "?v=" +
                  asset.sha256.slice(0, 12),
                document.baseURI,
              ).href,
            );
          const barrier = instance.node;
          barrier.name = "authored-jersey-barrier";
          this.scene.addChild(barrier);
          barrier.transform.position = new l.Vector3(side * 8.6, 0.25, z);
          barrier.transform.rotationEuler = new l.Vector3(0, 90, 0);
        } else {
          const barrier = mesh(g, concreteMat, this.scene, "jersey-barrier");
          barrier.transform.position = new l.Vector3(side * 8.6, 0.25, z);
        }
        if (z % 12 === 2 && !(z >= -14 && z <= 22)) {
          box(
            "reflector-bracket",
            metal,
            side * 8.28,
            1.05,
            z,
            0.08,
            0.14,
            0.22,
            0.01,
          );
          box(
            "road-reflector",
            white,
            side * 8.21,
            1.06,
            z,
            0.018,
            0.08,
            0.1,
            0.005,
          );
        }
      }
      // Rail posts, joints, realistic spacing. Details are modelled rather than painted neon.
      for (let z = -60; z < 180; z += 3.8) {
        box("rail-post", metal, side * 9.1, 1.4, z, 0.12, 2.65, 0.12, 0.02);
      }
      for (const y of [1.7, 2.3])
        box("safety-rail", metal, side * 9.1, y, 60, 0.1, 0.09, 240, 0.015);
    }
    for (let z = -58; z < 180; z += 9) {
      for (const x of [-2.67, 2.67])
        box("lane-marking", white, x, 0.006, z, 0.12, 0.012, 3, 0.004);
    }
    for (const x of [-7.55, 7.55])
      box("edge-marking", white, x, 0.008, 60, 0.14, 0.014, 240, 0.004);
    for (let z = -45; z < 180; z += 24) {
      for (const side of [-1, 1]) {
        const x = side * 9.2;
        box("streetlamp-base", metal, x, 0.4, z, 0.32, 0.8, 0.32, 0.04);
        box("streetlamp-pole", trim, x, 5.4, z, 0.15, 10, 0.15, 0.025);
        box(
          "streetlamp-arm",
          trim,
          x - side * 0.85,
          10.4,
          z,
          1.8,
          0.12,
          0.12,
          0.02,
        );
        const lamp = createSurfaceMaterial({
          type: "pbr",
          color: [0.55, 0.5, 0.4, 1],
          emission: [3.2, 2.55, 1.7],
          roughness: 0.4,
        });
        box(
          "streetlamp-diffuser",
          lamp,
          x - side * 1.55,
          10.31,
          z,
          0.65,
          0.07,
          0.28,
          0.02,
        );
      }
      box("pier-column", concreteMat, 0, -6.8, z, 1.8, 12, 3.4, 0.16);
      box("pier-cap", concreteMat, 0, -1.7, z, 15, 1.4, 2.1, 0.1);
    }
    for (let z = -40; z < 180; z += 20)
      box("expansion-joint", dark, 0, 0.014, z, 16, 0.025, 0.035, 0.008);
    // Repairs, drainage and access covers have physical scale and placement.
    // They break up the road according to use, rather than arbitrary decoration.
    const repair = lit("AsphaltRepair", [0.36, 0.38, 0.39, 1], 0.92, 0, {
      albedo: asphalt,
      normal: anormal,
      metallicGloss: arough,
    });
    for (const [x, z, w, d] of [
      [-1.3, -5.2, 1.4, 2.8],
      [4.8, 17, 1.8, 3.5],
      [-5.4, 50, 2.1, 2.2],
      [0.8, 80, 1.7, 4.2],
    ]) {
      const g = new Geometry(),
        outline = [
          [-w, -d * 0.8],
          [-w * 0.85, -d],
          [w * 0.9, -d * 0.94],
          [w, -d * 0.6],
          [w * 0.96, d],
          [-w * 0.95, d * 0.92],
        ];
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i],
          b = outline[(i + 1) % outline.length];
        g.quad(
          [x, 0.004, z],
          [x + a[0], 0.004, z + a[1]],
          [x + b[0], 0.004, z + b[1]],
          [x, 0.004, z],
          [0, 1, 0],
          [
            x / 4,
            z / 4,
            (x + a[0]) / 4,
            (z + a[1]) / 4,
            (x + b[0]) / 4,
            (z + b[1]) / 4,
            x / 4,
            z / 4,
          ],
        );
      }
      const patch = mesh(g, repair, this.scene, "asphalt-utility-repair");
      patch.layer = 2;
      patch.meshRenderer.castShadow = false;
    }
    const castIron = lit("CastIron", [0.055, 0.061, 0.064, 1], 0.78, 0.65);
    for (let z = -34; z < 180; z += 24) {
      for (const side of [-1, 1]) {
        const x = side * 7.86;
        box(
          "drain-concrete-collar",
          concreteMat,
          x,
          0.006,
          z,
          0.66,
          0.016,
          1.22,
          0.01,
        );
        box("drain-dark-opening", dark, x, 0.017, z, 0.52, 0.01, 1.06, 0.005);
        for (const dz of [-0.51, 0.51])
          box(
            "drain-frame",
            castIron,
            x,
            0.027,
            z + dz,
            0.54,
            0.018,
            0.03,
            0.003,
          );
        for (let bar = 0; bar < 13; bar++)
          box(
            "drain-grate",
            castIron,
            x,
            0.027,
            z - 0.45 + bar * 0.075,
            0.52,
            0.018,
            0.024,
            0.003,
          );
      }
    }
    for (const [x, z] of [
      [-0.4, 8.5],
      [4.4, 57],
    ]) {
      const cover = new l.MeshSprite3D(
        l.PrimitiveMesh.createCylinder(0.31, 0.018, 48),
      );
      this.scene.addChild(cover);
      cover.name = "cast-iron-access-cover";
      cover.transform.position = new l.Vector3(x, 0.012, z);
      cover.meshRenderer.sharedMaterial = castIron;
      cover.meshRenderer.receiveShadow = true;
      cover.layer = 2;
      for (let line = -3; line <= 3; line++) {
        const offset = line * 0.07,
          length = 2 * Math.sqrt(0.28 ** 2 - offset ** 2);
        box(
          "cover-rib",
          metal,
          x + offset,
          0.025,
          z,
          0.012,
          0.007,
          length,
          0.002,
        );
      }
    }
    // Close industrial architecture: distinct roofs, loading bays, facade rhythm and rooftop equipment.
    const facade = lit("Facade", [0.9, 0.88, 0.84, 1], 0.78, 0, {
      albedo: concrete,
      normal: cnormal,
      metallicGloss: crough,
    });
    box("east-warehouse-quay", concreteMat, 46, -6, 105, 58, 2, 310, 0.12);
    box("harbor-forecourt", concreteMat, -0.25, -6, 247, 150.5, 2, 26, 0.1);
    for (let block = 0; block < 3; block++) {
      const z = 95 + block * 38,
        height = [14, 24, 17][block];
      box(
        "warehouse-main",
        facade,
        30,
        height / 2 - 5,
        z,
        24,
        height,
        27,
        0.12,
      );
      box("warehouse-roof", metal, 30, height - 4.9, z, 24.5, 0.3, 27.5, 0.07);
      for (let floor = 0; floor < height / 3.2 - 1; floor++)
        for (let bay = 0; bay < 7; bay++) {
          box(
            "facade-window",
            glass,
            17.91,
            -1 + floor * 3.2,
            z - 11 + bay * 3.5,
            0.08,
            1.95,
            2.7,
            0.015,
          );
          box(
            "window-transom",
            trim,
            17.84,
            -0.02 + floor * 3.2,
            z - 11 + bay * 3.5,
            0.08,
            0.055,
            2.75,
            0.008,
          );
        }
      for (let col = 0; col < 8; col++)
        box(
          "facade-fin",
          concreteMat,
          17.8,
          height / 2 - 5,
          z - 12.4 + col * 3.55,
          0.32,
          height,
          0.16,
          0.02,
        );
      for (let unit = 0; unit < 3; unit++) {
        box(
          "roof-HVAC",
          metal,
          25 + unit * 4,
          height - 4.15,
          z - 5 + unit * 3,
          2.5,
          1.4,
          3,
          0.12,
        );
        for (let vent = 0; vent < 6; vent++)
          box(
            "HVAC-louver",
            dark,
            23.72 + unit * 4,
            height - 4.2 + vent * 0.15,
            z - 5 + unit * 3,
            0.03,
            0.04,
            2.5,
            0.005,
          );
      }
    }
    // Harbour-side container stacks, cranes, quay and distant skyline provide coherent scale.
    box("quay", concreteMat, -48, -6, 97.5, 55, 2, 325, 0.12);
    for (const [x0, x1, z0, z1] of [
      [-75.5, -20.5, -65, 260],
      [17, 75, -50, 260],
      [-75.5, 75, 234, 260],
    ]) {
      const paving = new Geometry();
      paving.quad(
        [x0, -4.994, z0],
        [x1, -4.994, z0],
        [x1, -4.994, z1],
        [x0, -4.994, z1],
        [0, 1, 0],
        [
          0,
          0,
          (x1 - x0) / 4,
          0,
          (x1 - x0) / 4,
          (z1 - z0) / 4,
          0,
          (z1 - z0) / 4,
        ],
      );
      mesh(paving, repair, this.scene, "quay-asphalt-paving").layer = 2;
    }
    const rust = lit("ContainerOxide", [0.22, 0.07, 0.035, 1], 0.76, 0.03);
    const containerPaint = lit(
      "ContainerPaint",
      [0.065, 0.11, 0.14, 1],
      0.68,
      0.02,
    );
    for (let i = 0; i < 18; i++) {
      const x = -30 - (i % 3) * 5,
        z = -15 + Math.floor(i / 3) * 28,
        mat = i % 3 === 0 ? rust : containerPaint;
      if (z > 32 && z < 80) continue;
      box("shipping-container", mat, x, -3.7, z, 2.44, 2.6, 12.2, 0.045);
      for (const side of [-1, 1])
        for (let rib = 0; rib < 20; rib++)
          box(
            "container-corrugation",
            mat,
            x + side * 1.235,
            -3.7,
            z - 5.7 + rib * 0.6,
            0.065,
            2.4,
            0.12,
            0.015,
          );
      for (const side of [-1, 1]) {
        box(
          "container-corner-post",
          mat,
          x + side * 1.16,
          -3.7,
          z - 6.11,
          0.12,
          2.6,
          0.08,
          0.015,
        );
        box(
          "container-locking-bar",
          trim,
          x + side * 0.61,
          -3.7,
          z - 6.15,
          0.035,
          2.35,
          0.035,
          0.01,
        );
      }
      box(
        "container-door-seam",
        dark,
        x,
        -3.7,
        z - 6.125,
        0.015,
        2.45,
        0.01,
        0.002,
      );
    }
    const warehouseAsset = scenery.find(
      (asset) => asset.file === "dock_warehouse.glb",
    )!;
    const warehouseInstance = await this.library.instantiate(
      new URL(
        "visual-assets/" +
          warehouseAsset.file +
          "?v=" +
          warehouseAsset.sha256.slice(0, 12),
        document.baseURI,
      ).href,
    );
    this.warehouse = warehouseInstance.node;
    this.warehouse.name = "authored-three-bay-dock-warehouse";
    this.scene.addChild(this.warehouse);
    this.warehouse.transform.position = new l.Vector3(-47, -5, 60);
    this.warehouse.transform.rotationEuler = new l.Vector3(0, 90, 0);
    this.driveObstacles.push({minX:-56,maxX:-38,minZ:45,maxZ:75,minY:-5,maxY:13});
    const yellow = lit("DockSafetyPaint", [0.48, 0.31, 0.065, 1], 0.8, 0);
    for (const z of [48, 56, 64, 72]) {
      box(
        "loading-apron-line",
        yellow,
        -31.5,
        -4.982,
        z,
        10.5,
        0.012,
        0.11,
        0.003,
      );
      box(
        "loading-bollard-foot",
        castIron,
        -35.7,
        -4.965,
        z,
        0.31,
        0.065,
        0.31,
        0.025,
      );
      box("loading-bollard", yellow, -35.7, -4.46, z, 0.19, 1.0, 0.19, 0.06);
      box(
        "bollard-protective-band",
        dark,
        -35.7,
        -4.24,
        z,
        0.195,
        0.16,
        0.195,
        0.06,
      );
    }
    for (const z of [25, 105]) {
      box("crane-leg", metal, -63, 15, z, 1.6, 40, 1.6, 0.05);
      box("crane-leg", metal, -37, 15, z, 1.6, 40, 1.6, 0.05);
      box("crane-top", rust, -50, 35, z, 30, 2, 2, 0.07);
      box("crane-boom", metal, -65, 37, z, 64, 1.3, 1.3, 0.04);
      for (let step = 0; step < 8; step++)
        box("crane-brace", rust, -63 + step * 3.7, 33, z, 1, 0.4, 2.6, 0.015);
      const bracing = new Geometry(),
        cables = new Geometry();
      for (const dz of [-6, 6]) {
        for (const x of [-63, -37]) {
          box("crane-outboard-leg", metal, x, 15, z + dz, 1.2, 40, 1.2, 0.04);
          box("crane-wheel-bogie", rust, x, -4.1, z + dz, 3, 1.6, 2, 0.08);
          tubes(bracing, [x, -3, z + dz], [x, 29, z - dz], 0.15);
        }
        tubes(bracing, [-96, 37, z + dz], [-63, 44, z + dz], 0.18);
        tubes(bracing, [-63, 44, z + dz], [-32, 37, z + dz], 0.18);
        tubes(bracing, [-96, 37, z + dz], [-32, 37, z + dz], 0.22);
        tubes(bracing, [-63, 44, z + dz], [-63, 35, z + dz], 0.18);
        for (let j = 0; j < 9; j++)
          tubes(
            bracing,
            [-96 + j * 7, 37, z + dz],
            [-92.5 + j * 7, 39 + Math.sin((j / 9) * Math.PI) * 4, z + dz],
            0.08,
          );
        for (const x of [-81, -75])
          tubes(cables, [x, 37, z + dz], [x, 2.1, z + dz], 0.025);
        for (let rung = 0; rung < 40; rung++)
          tubes(
            bracing,
            [-63.7, rung * 0.8 - 3, z + dz - 0.7],
            [-62.3, rung * 0.8 - 3, z + dz - 0.7],
            0.027,
          );
      }
      box("crane-trolley", rust, -78, 36.8, z, 7, 1.8, 13, 0.08);
      box("crane-spreader", rust, -78, 1.8, z, 7, 0.6, 13, 0.04);
      for (const x of [-63, -37])
        for (const y of [29, 35, 44])
          tubes(bracing, [x, y, z - 6], [x, y, z + 6], 0.16);
      mesh(bracing, metal, this.scene, "crane-engineered-truss");
      mesh(cables, dark, this.scene, "crane-hoist-cables");
    }
    const sea = lit(
      "Ocean",
      [0.04, 0.075, 0.1, 1],
      0.18,
      0.4,
      { normal: anormal },
      `void zhudaSurface(inout ZhudaLitSurface s,vec2 uv,vec3 p,vec3 n){s.roughness=.17+.04*sin(p.z*.08);}`,
    );
    const water = new Geometry();
    water.quad(
      [-900, -7, -800],
      [900, -7, -800],
      [900, -7, 900],
      [-900, -7, 900],
      [0, 1, 0],
      [0, 0, 90, 0, 90, 85, 0, 85],
    );
    mesh(water, sea, this.scene, "harbor-water").layer = 2;
    const distant = lit(
      "Skyline",
      [0.54, 0.58, 0.6, 1],
      0.55,
      0.1,
      undefined,
      `void zhudaSurface(inout ZhudaLitSurface s,vec2 uv,vec3 p,vec3 n){float along=abs(n.x)>.5?p.z:p.x;vec2 g=fract(vec2(along/1.65,p.y/3.4));float pane=step(.075,g.x)*step(g.x,.925)*step(.14,g.y)*step(g.y,.9);float variation=fract(sin(floor(along/1.65)*63.7+floor(p.y/3.4)*17.3)*43758.5);s.baseColor=mix(s.baseColor,vec3(.085,.13,.17)*mix(.65,1.15,variation),pane);s.roughness=mix(.62,.2,pane);s.metallic=mix(.12,.35,pane);}`,
    );
    box(
      "distant-connected-waterfront",
      concreteMat,
      0,
      -9,
      370,
      460,
      8,
      340,
      0.1,
    );
    for (let i = 0; i < 8; i++) {
      const x = -100 + i * 32,
        z = 260 + Math.sin(i * 5) * 50,
        h = 24 + ((i * 29) % 55);
      box(
        "distant-city",
        distant,
        x,
        h / 2 - 5,
        z,
        12 + (i % 3) * 6,
        h,
        18 + (i % 4) * 5,
        0.1,
      );
      box("roof-crown", metal, x, h - 4, z, 8, h * 0.04, 12, 0.06);
    }
    // Manufactured architecture is imported with planar panels and real mullions.
    // The generated, uneven candidate is intentionally not the delivered model.
    for (const [x, z, yaw, scale] of [
      [-92, 220, 35, 1],
      [52, 192, -65, 0.72],
    ]) {
      const asset = scenery[0],
        instance = await this.library.instantiate(
          new URL(
            "visual-assets/" + asset.file + "?v=" + asset.sha256.slice(0, 12),
            document.baseURI,
          ).href,
        );
      this.scene.addChild(instance.node);
      instance.node.name = "manufactured-curtain-wall-tower";
      instance.node.transform.position = new l.Vector3(x, -5, z);
      instance.node.transform.rotationEuler = new l.Vector3(0, yaw, 0);
      instance.node.transform.localScale = new l.Vector3(scale, scale, scale);
    }
    // Actual scene reflection, blended only into shallow pools; the main road stays rough.
    this.reflection = new ZhudaPlanarReflection(this.scene, {
      width: 1280,
      height: 800,
      planeY: 0.026,
      excludedLayer: 2,
    });
    this.puddle = new ZhudaShaderMaterial(
      {
        schemaVersion: 1,
        name: "ZhudaHarborPlanarWater",
        dimension: 3,
        blend: "alpha",
        depthWrite: false,
        uniforms: {
          u_ZhudaReflection: { type: "texture2D" },
          u_ZhudaEye: { type: "vec3", value: [0, 0, 0] },
          ...Object.fromEntries(
            [0, 1, 2, 3].map((i) => [
              "u_ZhudaProjection" + i,
              { type: "vec4" as const, value: [0, 0, 0, 0] },
            ]),
          ),
        },
        surface: `vec4 zhudaSurface(vec2 uv,vec3 p,vec3 n){vec4 clip=mat4(u_ZhudaProjection0,u_ZhudaProjection1,u_ZhudaProjection2,u_ZhudaProjection3)*vec4(p,1.0);vec2 st=clip.xy/clip.w*.5+.5;float edge=smoothstep(.0,.12,uv.x)*smoothstep(.0,.12,1.0-uv.x)*smoothstep(.0,.08,uv.y)*smoothstep(.0,.08,1.0-uv.y);edge*=smoothstep(.1,.3,.5+.23*sin(uv.y*39.0)+.2*sin(uv.x*17.0+uv.y*21.0));float f=.04+.96*pow(1.0-max(0.0,dot(normalize(u_ZhudaEye-p),n)),5.0);vec3 c=texture2D(u_ZhudaReflection,st).rgb;return vec4(c,edge*f*.8);}`,
      },
      { u_ZhudaReflection: this.reflection.texture },
    );
    const pools = new Geometry();
    for (const [x, z, w, d] of [
      [-4.7, -2, 1.1, 11],
      [5.5, 8, 1.7, 17],
      [-6.3, 22, 1.2, 14],
      [0.6, 45, 0.9, 9],
      [5.1, 65, 1.5, 22],
      [-5.8, 91, 1.4, 16],
    ])
      pools.quad(
        [x - w, 0.027, z - d],
        [x + w, 0.027, z - d],
        [x + w, 0.027, z + d],
        [x - w, 0.027, z + d],
        [0, 1, 0],
      );
    const poolNode = mesh(
      pools,
      this.puddle.material,
      this.scene,
      "shallow-planar-pools",
    );
    poolNode.layer = 2;
    poolNode.meshRenderer.castShadow = false;
    $("progress").textContent = "Placing S800 in the physical lighting scene…";
    this.carInstance = await this.library.instantiate(
      new URL(
        "visual-assets/" + carAsset.file + "?v=" + carAsset.sha256.slice(0, 12),
        document.baseURI,
      ).href,
      { independentMaterials: true },
    );
    this.car = this.carInstance.node;
    this.car.name = "hero-s800";
    this.scene.addChild(this.car);
    this.car.transform.position = new l.Vector3(-1.4, 0, 1.5);
    this.car.transform.rotationEuler = new l.Vector3(0, 180, 0);
    const walk = (n: any, normalScale?: number) => {
      const render = n.meshRenderer || n.getComponent(l.MeshRenderer);
      if (render) {
        render.castShadow = true;
        render.receiveShadow = true;
        if (normalScale !== undefined)
          // The glTF loader uses Material with glTF shader uniforms.
          for (const m of render.sharedMaterials)
            if ("normalTextureScale" in m) m.normalTextureScale = normalScale;
            else m.setFloat("u_NormalScale", normalScale);
      }
      for (let i = 0; i < n.numChildren; i++)
        walk(n.getChildAt(i), normalScale);
    };
    walk(this.car, 0.25);
    walk(this.warehouse);
    $("progress").textContent = "Preparing independent steering and wheel assemblies…";
    const driveAsset = await this.library.instantiate(new URL("visual-assets/maextro-s800-driving.glb?v=487ad7cb03d3",document.baseURI).href,{independentMaterials:true});
    this.drivingCar = driveAsset.node;
    this.drivingCar.name = "s800-independent-wheels";
    this.scene.addChild(this.drivingCar);
    const find = (node: any, name: string): any => {
      if(node.name === name) return node;
      for(let i=0;i<node.numChildren;i++) {const found=find(node.getChildAt(i),name);if(found)return found;}
      return null;
    };
    const root = find(this.drivingCar,"Maextro_S800_Root");
    if(!root) throw Error("Driving GLB root missing");
    this.drivingBody = new l.Sprite3D("suspended-body");
    const parts = Array.from({length:root.numChildren},(_,i)=>root.getChildAt(i));
    root.addChild(this.drivingBody);
    for(const part of parts) if(!part.name.startsWith("wheel_")) this.drivingBody.addChild(part);
    for(const key of ["FL","FR","RL","RR"]) {
      const steer=find(root,"wheel_"+key), axle=find(root,"wheel_"+key+"_axle");
      if(!steer||!axle) throw Error("Driving wheel missing: "+key);
      this.wheels.push({steer,axle,front:key.startsWith("F"),side:steer.transform.localPosition.x > 0 ? 1 : -1});
    }
    const disableClips = (node:any) => { const animator=node.getComponent(l.Animator);if(animator)animator.enabled=false;for(let i=0;i<node.numChildren;i++)disableClips(node.getChildAt(i)); };
    disableClips(this.drivingCar);
    walk(this.drivingCar);
    this.drivingCar.active = false;

    const navigationCodes = new Set([
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowLeft",
      "ArrowDown",
      "ArrowRight",
      "ShiftLeft",
      "ShiftRight",
      "Space",
    ]);
    window.addEventListener("keydown", (event) => {
      if (event.code === "KeyR" && this.freeExplore && !event.repeat) {this.resetDriving();event.preventDefault();return;}
      if (!this.freeExplore || !navigationCodes.has(event.code)) return;
      this.freeKeys.add(event.code);
      if (this.freeExplore) event.preventDefault();
    });
    window.addEventListener("keyup", (event) => {
      if (navigationCodes.has(event.code)) this.freeKeys.delete(event.code);
    });
    const clearInput = () => {this.freeKeys.clear();this.freePointer=null;};
    window.addEventListener("blur", clearInput);
    document.addEventListener("visibilitychange", () => {if(document.hidden)clearInput();this.last=performance.now();});
    $("reset-drive").onclick=()=>this.resetDriving();
    document.querySelectorAll<HTMLButtonElement>("[data-free-key]").forEach((button) => {
      const code = button.dataset.freeKey!;
      const release = () => this.freeKeys.delete(code);
      button.addEventListener("pointerdown", (event) => {
        if (!this.freeExplore) return;
        this.freeKeys.add(code);
        button.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
    });
    window.addEventListener("pointerdown", (event) => {
      if (!this.freeExplore || (event.target as Element)?.closest("button,a"))
        return;
      if(this.freePointer) return;
      this.freePointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      (event.target as Element).setPointerCapture?.(event.pointerId);
    });
    window.addEventListener("pointermove", (event) => {
      if (!this.freePointer || event.pointerId !== this.freePointer.id) return;
      const dx = event.clientX - this.freePointer.x,
        dy = event.clientY - this.freePointer.y;
      this.freePointer.x = event.clientX;
      this.freePointer.y = event.clientY;
      this.freeCameraYaw -= dx * 0.004;
      this.freePitch = Math.max(0.08, Math.min(1.05, this.freePitch + dy * 0.004));
      this.freeLookIdle = 1.8;
      event.preventDefault();
    });
    window.addEventListener("pointercancel", (event) => {if(this.freePointer?.id===event.pointerId)this.freePointer=null;});
    window.addEventListener("pointerup", (event) => {
      if (this.freePointer?.id === event.pointerId) this.freePointer = null;
    });
    document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(
      (b) =>
        (b.onclick = () => {
          if (this.freeExplore) this.exitFreeExplore();
          this.view = b.dataset.view!;
          if (this.view === "dock") {
            this.moving = false;
            $("motion").setAttribute("aria-pressed", "false");
          }
          this.pipeline.resetHistory();
          document
            .querySelectorAll("[data-view]")
            .forEach((v) => v.setAttribute("aria-pressed", String(v === b)));
          this.draw(0);
        }),
    );
    $("explore").onclick = () => {
      if (this.freeExplore) this.exitFreeExplore();
      else this.enterFreeExplore();
    };
    $("motion").onclick = () => {
      if (this.freeExplore) this.exitFreeExplore();
      if (this.view === "dock")
        document
          .querySelector<HTMLButtonElement>('[data-view="hero"]')!
          .click();
      this.moving = !this.moving;
      $("motion").setAttribute("aria-pressed", String(this.moving));
    };
    $("compare").onclick = () => {
      this.comparison = !this.comparison;
      $("compare").setAttribute("aria-pressed", String(this.comparison));
      this.pipeline.ao.active = !this.comparison;
      this.scene.reflectionIntensity = this.comparison ? 0 : 1;
      this.sun.shadowMode = this.comparison
        ? l.ShadowMode.None
        : l.ShadowMode.SoftHigh;
    };
    document.querySelector("canvas")!.style.touchAction="none";
    const requestedView = new URLSearchParams(location.search).get("view");
    if (
      requestedView &&
      ["hero", "road", "wide", "detail", "dock"].includes(requestedView)
    )
      document
        .querySelector<HTMLButtonElement>(`[data-view="${requestedView}"]`)!
        .click();
    this.last = performance.now();
    this.ready = true;
    $("loading").hidden = true;
    $("status").textContent = "Live 3D scene · first visual study";
    const frame = () => {
      const now = performance.now(),
        dt = Math.min(1, (now - this.last) / 1000);
      this.frameIntervals.push(now - this.last);
      if (this.frameIntervals.length > 600) this.frameIntervals.shift();
      this.last = now;
      this.draw(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  draw(dt: number) {
    const oldLoop = Math.floor((this.time * 8) / 110);
    if (this.moving) this.time += dt;
    if (this.freeExplore) this.freeStep(dt);
    if (Math.floor((this.time * 8) / 110) !== oldLoop)
      this.pipeline.resetHistory();
    this.frames++;
    const z = 1.5 + ((this.time * 8) % 110);
    if (!this.freeExplore)
      this.car.transform.position =
        this.view === "dock"
          ? new Laya.Vector3(-29, -4.994, 52)
          : new Laya.Vector3(-1.4, 0, z);
    const poses: Record<string, { eye: V; target: V; fov: number }> = {
      hero: {
        eye: [6.4, 1.5, z - 8.7],
        target: [-0.8, 0.85, z + 1.5],
        fov: 43,
      },
      road: { eye: [2.4, 1.2, z - 14], target: [-1.1, 0.8, z + 15], fov: 49 },
      wide: { eye: [17, 10, z - 22], target: [-18, 3, z + 44], fov: 53 },
      detail: {
        eye: [2.1, 0.75, z - 3.8],
        target: [-1.5, 0.65, z + 0.7],
        fov: 42,
      },
      dock: {
        eye: [-22, -3.7, 42],
        target: [-34, -2.4, 58],
        fov: 44,
      },
    };
    const p = this.freeExplore ? this.freePose(dt) : poses[this.view] || poses.hero;
    this.camera.fieldOfView = p.fov;
    this.camera.transform.position = new Laya.Vector3(...p.eye);
    this.camera.transform.lookAt(
      new Laya.Vector3(...p.target),
      new Laya.Vector3(0, 1, 0),
      false,
    );
    const columns = this.reflection.update(
      p.eye,
      p.target,
      p.fov,
      innerWidth / innerHeight,
    );
    for (let i = 0; i < 4; i++)
      this.puddle.setUniform("u_ZhudaProjection" + i, columns[i]);
    this.puddle.setUniform("u_ZhudaEye", p.eye);
    if (this.frames % 30 === 0) {
      $("status").textContent =
        `HDR / GGX IBL / PBR / SHADOWS / ACES\n${this.freeExplore ? `Harbor free drive · ${Math.round(Math.abs(this.vehicle.speed)*3.6)} km/h` : this.comparison ? "A/B: shadows, IBL and AO disabled" : "Live 3D scene · first visual study"}`;
    }
  }
  report() {
    const warehouseRenderers: any[] = [];
    const visit = (node: any) => {
      const renderer =
        node.meshRenderer || node.getComponent(Laya.MeshRenderer);
      if (renderer) warehouseRenderers.push(renderer);
      for (let i = 0; i < node.numChildren; i++) visit(node.getChildAt(i));
    };
    if (this.warehouse) visit(this.warehouse);
    const warehouseMin = [0, 1, 2].map((axis) =>
      Math.min(
        ...warehouseRenderers.map(
          (r) => r.bounds.getMin()[["x", "y", "z"][axis]],
        ),
      ),
    );
    const warehouseMax = [0, 1, 2].map((axis) =>
      Math.max(
        ...warehouseRenderers.map(
          (r) => r.bounds.getMax()[["x", "y", "z"][axis]],
        ),
      ),
    );
    return {
      ready: this.ready,
      view: this.view,
      moving: this.moving,
      freeExplore: this.freeExplore,
      freePosition: [this.vehicle.x, this.vehicle.z],
      freeSpeed: this.vehicle.speed,
      freeYaw: this.freeYaw,
      driving: this.vehicle.snapshot(),
      wheels: this.wheels.map(w=>({steering:w.steer.transform.localRotationEuler.y,spin:w.axle.transform.localRotationEuler.x})),
      hdr: this.camera.enableHDR,
      ibl: this.environment.texture.width,
      shadows: this.sun.shadowMode,
      materials: this.surfaces.length,
      meshCount: meshes.length,
      resources: inspectSceneResources(),
      model: this.library.report(),
      carMaterial: {
        normalScale: this.carInstance.materials[0].getFloat("u_NormalScale"),
        normalTextureSize: [
          this.carInstance.materials[0].getTexture("u_NormalTexture")?.width,
          this.carInstance.materials[0].getTexture("u_NormalTexture")?.height,
        ],
      },
      warehouse: {
        min: warehouseMin,
        max: warehouseMax,
        renderers: warehouseRenderers.length,
        shadowCasters: warehouseRenderers.filter((r) => r.castShadow).length,
        shadowReceivers: warehouseRenderers.filter((r) => r.receiveShadow)
          .length,
      },
      normalMapTextures: normalTextures.map((t) => ({
        width: t.width,
        height: t.height,
      })),
      frameIntervalP95:
        [...this.frameIntervals].sort((a, b) => a - b)[
          Math.floor(this.frameIntervals.length * 0.95)
        ] ?? 0,
      scope: "first visual slice; no claim of UE parity or mobile performance",
    };
  }
}
const study = new HarborStudy();
(window as any).harborStudy = study;
study.init().catch((e) => {
  console.error(e);
  $("progress").textContent = String(e);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import { inflateSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
// Chrome emits non-interlaced RGB/RGBA PNG. Decode actual screenshot pixels;
// status text and PNG byte differences are not lighting evidence.
function pixels(base64) {
  const b = Buffer.from(base64, "base64"),
    idat = [];
  let width, height, channels;
  for (let at = 8; at < b.length; ) {
    const n = b.readUInt32BE(at),
      kind = b.toString("ascii", at + 4, at + 8),
      data = b.subarray(at + 8, at + 8 + n);
    if (kind === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      channels = data[9] === 2 ? 3 : data[9] === 6 ? 4 : 0;
      assert.ok(channels);
      assert.equal(data[12], 0);
    }
    if (kind === "IDAT") idat.push(data);
    at += n + 12;
  }
  const raw = inflateSync(Buffer.concat(idat)),
    stride = width * channels,
    out = new Uint8Array(height * stride);
  let at = 0;
  const paeth = (a, b, c) => {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[at++];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const pos = y * stride + x,
        a = x >= channels ? out[pos - channels] : 0,
        b = y ? out[pos - stride] : 0,
        c = y && x >= channels ? out[pos - stride - channels] : 0;
      out[pos] =
        (raw[at++] +
          (filter === 1
            ? a
            : filter === 2
              ? b
              : filter === 3
                ? Math.floor((a + b) / 2)
                : filter === 4
                  ? paeth(a, b, c)
                  : 0)) &
        255;
    }
  }
  return { width, height, channels, data: out };
}
function difference(a, b) {
  a = pixels(a);
  b = pixels(b);
  assert.equal(a.data.length, b.data.length);
  let changed = 0,
    total = 0;
  for (let i = 0; i < a.data.length; i += a.channels) {
    const d =
      (Math.abs(a.data[i] - b.data[i]) +
        Math.abs(a.data[i + 1] - b.data[i + 1]) +
        Math.abs(a.data[i + 2] - b.data[i + 2])) /
      3;
    total += d;
    if (d > 6) changed++;
  }
  return {
    changedFraction: changed / (a.width * a.height),
    meanChannelDifference: total / (a.width * a.height),
  };
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  evidence = path.join(root, "evidence");
fs.mkdirSync(evidence, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "neon-apex-qa-")),
  url =
    process.env.GAME_URL ||
    "http://localhost:8908/zhuda-neon-racer/visual.html";
let server, socket;
const errors = [],
  failures = [],
  checks = [];
const viewport = process.env.CI
  ? { width: 1024, height: 768 }
  : { width: 1600, height: 1000 };
const pass = (check) => {
  checks.push(check);
  console.log("PASS " + check);
};
if (!process.env.GAME_URL) {
  server = spawn(process.execPath, ["scripts/server.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: "8908", BASE_PATH: "/zhuda-neon-racer" },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    await delay(100);
  }
}
const chrome = spawn(
  process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);
try {
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let i = 0; !fs.existsSync(portFile) && i < 100; i++) await delay(100);
  assert.ok(fs.existsSync(portFile));
  const port = fs.readFileSync(portFile, "utf8").split("\n")[0],
    targets = await (await fetch(`http://localhost:${port}/json/list`)).json();
  socket = new WebSocket(
    targets.find((t) => t.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((r, j) => {
    socket.onopen = r;
    socket.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  const rejectPending = (error) => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    pending.clear();
  };
  socket.onclose = () =>
    rejectPending(new Error("Chrome target closed during WebGL verification"));
  socket.onerror = () =>
    rejectPending(new Error("Chrome debugging transport failed"));
  socket.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) clearTimeout(p.timer);
      m.error
        ? p?.reject(new Error(JSON.stringify(m.error)))
        : p?.resolve(m.result);
    } else if (m.method === "Inspector.targetCrashed")
      rejectPending(
        new Error("Chrome renderer crashed during WebGL verification"),
      );
    else if (m.method === "Runtime.exceptionThrown")
      errors.push(m.params.exceptionDetails);
    else if (
      m.method === "Runtime.consoleAPICalled" &&
      m.params.type === "error"
    )
      errors.push(m.params.args.map((a) => a.value || a.description));
    else if (
      m.method === "Runtime.consoleAPICalled" &&
      String(m.params.args[0]?.value).startsWith("[QA]")
    )
      console.log(m.params.args.map((a) => a.value || a.description).join(" "));
    else if (m.method === "Network.loadingFailed" && !m.params.canceled)
      failures.push(m.params.errorText);
  };
  const cdp = (method, params = {}, timeoutMs = 120000) =>
    new Promise((r, j) => {
      if (socket.readyState !== WebSocket.OPEN)
        return j(new Error("Chrome debugging target is no longer connected"));
      const n = ++id;
      const timer = setTimeout(() => {
        pending.delete(n);
        j(new Error(`Chrome timed out after ${timeoutMs} ms: ${method}`));
      }, timeoutMs);
      pending.set(n, { resolve: r, reject: j, timer });
      socket.send(JSON.stringify({ id: n, method, params }));
    });
  const ev = async (expression, timeoutMs) => {
    const r = await cdp(
      "Runtime.evaluate",
      {
        expression,
        awaitPromise: true,
        returnByValue: true,
      },
      timeoutMs,
    );
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const wait = async (expression, seconds = 10) => {
    for (let i = 0; i < seconds * 10; i++) {
      if (await ev(expression)) return;
      await delay(100);
    }
    throw new Error(
      "Timed out: " +
        expression +
        "\n" +
        JSON.stringify(await ev("window.neonGame?.snapshot()")),
    );
  };
  const click = (id) =>
    ev(`document.getElementById(${JSON.stringify(id)}).click()`);
  const shot = async (name) => {
    await delay(120);
    const { data } = await cdp("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(
      path.join(evidence, name + ".png"),
      Buffer.from(data, "base64"),
    );
  };
  const key = (type, code, key) =>
    cdp("Input.dispatchKeyEvent", {
      type,
      code,
      key,
      windowsVirtualKeyCode:
        {
          KeyW: 87,
          ArrowRight: 39,
          ArrowLeft: 37,
          ArrowDown: 40,
          ArrowUp: 38,
          Space: 32,
          Escape: 27,
        }[
          code
        ] || 0,
    });
  await cdp("Page.enable");
  await cdp("Inspector.enable");
  await cdp("Runtime.enable");
  await cdp("Network.enable");
  await cdp("Emulation.setDeviceMetricsOverride", {
    ...viewport,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp("Page.navigate", { url });
  await wait("window.harborStudy?.ready", 60);
  await delay(1000);
  const settle = async (frames = 6) => {
    const before = await ev("harborStudy.frames");
    await wait(`harborStudy.frames>=${before + frames}`, 30);
  };
  const crop = async () =>
    (
      await cdp("Page.captureScreenshot", {
        format: "png",
        clip: {
          x: viewport.width / 16,
          y: 160,
          width: (viewport.width * 7) / 8,
          height: viewport.height - 300,
          scale: 1,
        },
      })
    ).data;
  await settle();
  const axes = await ev("harborStudy.verifyEnvironmentUpload()");
  assert.deepEqual(axes.actual, axes.expected);
  const mip = await ev("harborStudy.verifyEnvironmentUpload(.5)");
  for (let i = 0; i < 24; i++)
    assert.ok(
      Math.abs(mip.actual[i] - mip.expected[i]) <= 1,
      JSON.stringify(mip),
    );
  pass(
    "GPU readback verifies all six cubemap axes and fractional-mip trilinear interpolation",
  );
  const initial = await ev("harborStudy.report()");
  assert.equal(initial.ready, true);
  assert.equal(initial.hdr, true);
  assert.equal(initial.ibl, 256);
  assert.ok(initial.meshCount > 500);
  assert.equal(initial.model.instances, 25);
  assert.equal(initial.carMaterial.normalScale, 0.25);
  assert.deepEqual(initial.carMaterial.normalTextureSize, [4096, 4096]);
  for (const [actual, expected] of [
    [initial.warehouse.min, [-56, -5, 45]],
    [initial.warehouse.max, [-38, 13, 75]],
  ])
    actual.forEach((n, i) =>
      assert.ok(
        Math.abs(n - expected[i]) < 0.01,
        JSON.stringify(initial.warehouse),
      ),
    );
  assert.ok(initial.warehouse.renderers > 0);
  assert.equal(initial.warehouse.shadowCasters, initial.warehouse.renderers);
  assert.equal(initial.warehouse.shadowReceivers, initial.warehouse.renderers);
  assert.equal(await ev("harborStudy.environment.texture.mipmapCount"), 9);
  const material = await ev(
    `(()=>{const m=harborStudy.surfaces[0].material;return {color:[m.albedoColor.r,m.albedoColor.g,m.albedoColor.b],metallic:m.metallic,smoothness:m.smoothness,normal:[m.normalTexture.width,m.normalTexture.height],albedo:[m.albedoTexture.width,m.albedoTexture.height],convention:harborStudy.surfaces[0].spec.normalConvention};})()`,
  );
  assert.deepEqual(material.color, [0.66, 0.68, 0.7]);
  assert.equal(material.metallic, 0);
  assert.ok(Math.abs(material.smoothness - 0.04) < 1e-6);
  assert.deepEqual(material.normal, [2048, 2048]);
  assert.equal(material.convention, "opengl");
  await shot("visual-hero");
  pass(
    "scene-linear HDR with nine GGX mips, 320K-triangle/4K GLB, imported hard-surface towers and verified PBR texture/factor bindings",
  );
  pass(
    "imported warehouse has the correct rotated metre bounds, touches the quay and enables shadows on every renderer",
  );
  for (const view of ["road", "wide", "detail", "dock"]) {
    await ev(`document.querySelector('[data-view="${view}"]').click()`);
    await settle();
    assert.equal(await ev("harborStudy.view"), view);
    await shot("visual-" + view);
  }
  pass(
    "five camera cuts render and settle using temporal antialiasing, including the imported recessed loading-bay warehouse",
  );
  await ev("document.querySelector('[data-view=detail]').click()");
  await settle();
  const restrainedNormal = await crop();
  await ev(
    "harborStudy.carInstance.materials.forEach(m=>m.setFloat('u_NormalScale',1))",
  );
  await settle();
  const carNormalDifference = difference(restrainedNormal, await crop());
  assert.ok(
    carNormalDifference.changedFraction > 0.001,
    JSON.stringify(carNormalDifference),
  );
  await ev(
    "harborStudy.carInstance.materials.forEach(m=>m.setFloat('u_NormalScale',.25))",
  );
  await settle();
  pass(
    "the imported glTF 4K normal texture uses the actual shader uniform and changes rendered car pixels at strength .25 versus 1",
  );
  await ev("document.querySelector('[data-view=hero]').click()");
  await settle();
  const before = await ev("harborStudy.car.transform.position.z");
  await click("motion");
  await delay(1400);
  const after = await ev("harborStudy.car.transform.position.z");
  assert.ok(after > before + 0.5);
  await click("motion");
  const stopped = await ev("harborStudy.car.transform.position.z");
  await settle();
  assert.ok(
    Math.abs((await ev("harborStudy.car.transform.position.z")) - stopped) <
      1e-5,
    "Stopping DRIVE must preserve the vehicle position",
  );
  pass("drive control moves the actual GLB and camera");
  await click("explore");
  await settle();
  assert.equal(await ev("harborStudy.report().freeExplore"), true);
  await key("keyDown", "KeyW", "w");
  const handling = await ev(`(async()=>{
    const v=harborStudy.vehicle;
    const advance=async seconds=>{const end=v.elapsed+seconds;while(v.elapsed<end)await new Promise(requestAnimationFrame);};
    const key=(type,code)=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true}));
    try {
      await advance(1);
      const acceleration=harborStudy.report();
      key('keydown','ArrowRight');await advance(.55);
      const turning=harborStudy.report();
      key('keyup','ArrowRight');key('keyup','KeyW');await advance(.45);
      const coast=harborStudy.report();
      key('keydown','Space');await advance(1.5);
      return {acceleration,turning,coast,brake:harborStudy.report(),active:harborStudy.drivingCar.active,originalHidden:!harborStudy.car.active};
    } finally {for(const code of ['KeyW','ArrowRight','Space'])key('keyup',code);}
  })()`,180000);
  assert.ok(handling.acceleration.freeSpeed>3, 'throttle builds speed');
  assert.ok(handling.active && handling.originalHidden);
  const turnRadians=(handling.turning.freeYaw-handling.acceleration.freeYaw)*Math.PI/180;
  assert.ok(Math.abs(Math.atan2(Math.sin(turnRadians),Math.cos(turnRadians)))>Math.PI/180, 'moving vehicle follows a turning arc');
  assert.ok(Math.abs(handling.turning.driving.roll)>.001, 'suspension reacts to lateral acceleration');
  assert.ok(handling.coast.freeSpeed>handling.turning.freeSpeed*.6, 'release retains momentum');
  assert.ok(Math.abs(handling.brake.freeSpeed)<.15, 'handbrake stops the vehicle');
  assert.equal(handling.turning.wheels.length,4);
  assert.ok(handling.turning.wheels.slice(0,2).every(w=>Math.abs(w.steering)>1));
  assert.ok(handling.turning.wheels.every(w=>Math.abs(w.spin)>1));
  await shot('visual-driving');
  // Drag orbit must alter only the camera, never the car's steering/heading.
  const orbitBefore=await ev('({yaw:harborStudy.freeYaw,camera:harborStudy.freeCameraYaw})');
  await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:viewport.width*.65,y:viewport.height*.5,button:'left',clickCount:1});
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:viewport.width*.8,y:viewport.height*.5,button:'left',buttons:1});
  await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:viewport.width*.8,y:viewport.height*.5,button:'left',clickCount:1});
  const orbitAfter=await ev('({yaw:harborStudy.freeYaw,camera:harborStudy.freeCameraYaw})');
  assert.ok(Math.abs(orbitAfter.camera-orbitBefore.camera)>.1);
  assert.ok(Math.abs(orbitAfter.yaw-orbitBefore.yaw)<.01);
  await click('reset-drive');
  await cdp('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
  const touchButton=await ev(`(()=>{const r=document.querySelector('[data-free-key=KeyW]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...touchButton,id:1}]});
  assert.ok(await ev('harborStudy.freeKeys.has("KeyW")'));
  await cdp('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  assert.equal(await ev('harborStudy.freeKeys.size'),0);
  await cdp('Emulation.setTouchEmulationEnabled',{enabled:false});
  await click("explore");
  await settle();
  pass("vehicle accelerates, coasts, brakes and turns on real independent steering/spinning wheel nodes; orbit preserves heading and touch cancellation clears input");
  await ev("document.querySelector('[data-view=hero]').click()");
  await settle();
  const reflected = await crop();
  const reflection = await ev(
    `({width:harborStudy.reflection.texture.width,height:harborStudy.reflection.texture.height,eyeY:harborStudy.camera.transform.position.y,reflectedY:harborStudy.reflection.camera.transform.position.y,isTarget:harborStudy.reflection.camera.renderTarget===harborStudy.reflection.texture})`,
  );
  assert.equal(reflection.isTarget, true);
  assert.ok(Math.abs(reflection.eyeY + reflection.reflectedY - 0.052) < 1e-5);
  await ev(
    "harborStudy.puddle.setTexture('u_ZhudaReflection',Laya.Texture2D.blackTexture)",
  );
  await settle();
  const noReflection = await crop();
  const reflectionDifference = difference(reflected, noReflection);
  assert.ok(
    reflectionDifference.changedFraction > 0.001,
    JSON.stringify(reflectionDifference),
  );
  await ev(
    "harborStudy.puddle.setTexture('u_ZhudaReflection',harborStudy.reflection.texture)",
  );
  await settle();
  pass(
    "real HDR mirror camera has reflected pose and its render target changes pool pixels",
  );
  const shadowed = await crop();
  await ev("harborStudy.sun.shadowMode=Laya.ShadowMode.None");
  await settle();
  const shadowDifference = difference(shadowed, await crop());
  assert.ok(
    shadowDifference.changedFraction > 0.001,
    JSON.stringify(shadowDifference),
  );
  await ev("harborStudy.sun.shadowMode=Laya.ShadowMode.SoftHigh");
  await settle();
  pass("native car/building shadow casters change actual ground pixels");
  const lit = await crop();
  await click("compare");
  await settle();
  await shot("visual-ab");
  const unlit = await crop(),
    lightingDifference = difference(lit, unlit);
  assert.ok(
    lightingDifference.changedFraction > 0.02,
    JSON.stringify(lightingDifference),
  );
  assert.equal(await ev("harborStudy.sun.shadowMode"), 0);
  await click("compare");
  await settle();
  pass(
    "lighting A/B changes actual scene pixels outside UI and disables shadow map, IBL and AO",
  );
  const teardown = await ev(
    `(async()=>{const snapshots=[];for(let i=0;i<30;i++){const old=harborStudy.pipeline;harborStudy.rebuildPipeline();if(!old.grade._lutTex.destroyed||!old.grade._lutBuilderMat.destroyed)throw Error('Owned LUT/material leaked');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));snapshots.push(harborStudy.report().resources);if((i+1)%5===0)console.log('[QA] Drawn pipeline replacements '+(i+1)+'/30');}return {start:snapshots[4],end:snapshots[29]};})()`,
    300000,
  );
  assert.ok(
    teardown.end.counts.renderTarget <= teardown.start.counts.renderTarget + 2,
    JSON.stringify(teardown),
  );
  assert.ok(
    teardown.end.resources <= teardown.start.resources + 3,
    JSON.stringify(teardown),
  );
  pass(
    "30 HDR/AO/bloom/ACES/TAA chain replacements release owned LUTs/materials and reach bounded resource counts",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  const report = {
    passed: true,
    url,
    checkedAt: new Date().toISOString(),
    viewport,
    checks,
    scene: initial,
    axes,
    mip,
    material,
    reflection,
    reflectionDifference,
    shadowDifference,
    lightingDifference,
    carNormalDifference,
    handling,
    teardown,
    errors,
    failures,
  };
  fs.writeFileSync(
    path.join(evidence, "visual-verification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  socket?.close();
  chrome.kill("SIGTERM");
  server?.kill("SIGTERM");
  await delay(300);
  fs.rmSync(profile, { recursive: true, force: true });
}

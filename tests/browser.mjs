import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  evidence = path.join(root, "evidence");
fs.mkdirSync(evidence, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "neon-apex-qa-")),
  url = process.env.GAME_URL || "http://localhost:8908/zhuda-neon-racer/";
let server, socket;
const errors = [],
  failures = [],
  checks = [];
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
  socket.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error
        ? p?.reject(new Error(JSON.stringify(m.error)))
        : p?.resolve(m.result);
    } else if (m.method === "Runtime.exceptionThrown")
      errors.push(m.params.exceptionDetails);
    else if (
      m.method === "Runtime.consoleAPICalled" &&
      m.params.type === "error"
    )
      errors.push(m.params.args.map((a) => a.value || a.description));
    else if (m.method === "Network.loadingFailed" && !m.params.canceled)
      failures.push(m.params.errorText);
  };
  const cdp = (method, params = {}) =>
    new Promise((r, j) => {
      const n = ++id;
      pending.set(n, { resolve: r, reject: j });
      socket.send(JSON.stringify({ id: n, method, params }));
    });
  const ev = async (expression) => {
    const r = await cdp("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
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
        { ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, Space: 32, Escape: 27 }[
          code
        ] || 0,
    });
  const load = async () => {
    await cdp("Page.navigate", { url });
    await wait("window.neonGame?.ready", 20);
    assert.equal(
      await ev('document.getElementById("title-screen").hidden'),
      false,
    );
    await click("title-enter");
  };
  const setViewport = (width, height, mobile = false) =>
    cdp("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Network.enable");
  await cdp("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__drawCalls=0;const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){const gl=original.call(this,type,...args);if(gl&&/webgl/.test(type)&&!gl.__counted){gl.__counted=true;for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'])if(gl[name]){const draw=gl[name].bind(gl);gl[name]=(...args)=>{window.__drawCalls++;return draw(...args);};}}return gl;};`,
  });
  await setViewport(1440, 900);
  await load();
  assert.equal(await ev("neonGame.snapshot().save.races"), 0);
  assert.ok(await ev("window.__drawCalls>0"));
  await shot("01-home");
  await ev("document.querySelector('[data-track=\"2\"]').click()");
  assert.equal(await ev("neonGame.selected"), 0);
  assert.match(
    await ev('document.getElementById("toast").textContent'),
    /前三/,
  );
  checks.push("locked circuits do not start");
  await click("start");
  assert.equal(await ev("neonGame.modalKind"), "help");
  await shot("02-briefing");
  await click("help-go");
  await wait("neonGame.race?.phase==='racing'");
  await delay(1250);
  const before = await ev("neonGame.snapshot()");
  await key("keyDown", "ArrowRight", "ArrowRight");
  await delay(180);
  await key("keyUp", "ArrowRight", "ArrowRight");
  const steered = await ev("neonGame.snapshot()");
  assert.ok(
    steered.car.angle > before.car.angle + 0.1,
    "keyboard changes the car heading",
  );
  await key("keyDown", "Space", " ");
  await delay(450);
  const boosted = await ev("neonGame.snapshot()");
  assert.ok(boosted.car.boosting);
  assert.equal(boosted.render.dimension,3);
  assert.ok(boosted.render.triangles>10000);
  assert.ok(boosted.render.terrain.every(t=>t.solidDepth===18 && t.renderMeshes===2));
  assert.ok(boosted.render.particles > 0 && boosted.render.trailPoints > 0);
  await shot("03-nitro");
  await key("keyUp", "Space", " ");
  checks.push(
    "real keyboard steering and nitro create engine particles and historical trails",
  );
  await click("pause");
  const paused = await ev("neonGame.race.time");
  await delay(450);
  assert.equal(await ev("neonGame.race.time"), paused);
  await shot("04-pause");
  await click("restart");
  await wait("neonGame.race?.phase==='racing'");
  // Drive the real simulation with its path-following driver, without teleporting or setting a result.
  await ev(
    "window.normalInput=neonGame.input;neonGame.input=()=>neonGame.race.aiInput(0)",
  );
  await wait("neonGame.modalKind==='result'", 30);
  const won = await ev("neonGame.snapshot()");
  assert.ok(won.result.won);
  assert.equal(won.car.gates, 8);
  assert.ok(won.save.credits > 0 && won.save.stars[0] > 0);
  await shot("05-podium");
  checks.push("complete live WebGL race -> podium -> credits -> unlock");
  await click("result-menu");
  await click("garage-open");
  await shot("06-garage");
  const credits = await ev("neonGame.save.credits");
  await ev("document.querySelector('[data-upgrade=\"0\"]').click()");
  assert.equal(await ev("neonGame.save.upgrades[0]"), 1);
  assert.equal(await ev("neonGame.save.credits"), credits - 300);
  await click("garage-done");
  await click("settings-open");
  await ev(
    "const auto=document.getElementById('auto-setting');auto.checked=false;auto.dispatchEvent(new Event('change'))",
  );
  await ev(
    "const sound=document.getElementById('sound-setting');sound.checked=false;sound.dispatchEvent(new Event('change'))",
  );
  const downloads = path.join(evidence, "downloads");
  fs.mkdirSync(downloads, { recursive: true });
  await cdp("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloads,
  });
  await click("backup");
  for (
    let i = 0;
    i < 50 && !fs.existsSync(path.join(downloads, "neon-apex-save.json"));
    i++
  )
    await delay(100);
  const backup = JSON.parse(
    fs.readFileSync(path.join(downloads, "neon-apex-save.json"), "utf8"),
  );
  assert.equal(backup.upgrades[0], 1);
  await load();
  const saved = await ev("neonGame.snapshot().save");
  assert.equal(saved.upgrades[0], 1);
  assert.equal(saved.auto, false);
  assert.equal(saved.muted, true);
  assert.equal(saved.stars[0], won.save.stars[0]);
  checks.push(
    "purchases, audio/throttle preferences and progress survive reload; backup downloads valid JSON",
  );
  // Re-import the downloaded backup into a different fixture state through the file picker.
  await ev(
    "neonGame.save.credits=0;neonGame.save.upgrades=[0,0,0];neonGame.persist()",
  );
  await click("settings-open");
  const { root: doc } = await cdp("DOM.getDocument");
  const { nodeId } = await cdp("DOM.querySelector", {
    nodeId: doc.nodeId,
    selector: "#save-file",
  });
  const confirmed = new Promise((resolve) => {
    const previous = socket.onmessage;
    socket.onmessage = (event) => {
      const m = JSON.parse(event.data);
      if (m.method === "Page.javascriptDialogOpening") {
        cdp("Page.handleJavaScriptDialog", { accept: true }).then(resolve);
      }
      previous(event);
    };
  });
  await cdp("DOM.setFileInputFiles", {
    nodeId,
    files: [path.join(downloads, "neon-apex-save.json")],
  });
  await confirmed;
  await wait("neonGame.save.upgrades[0]===1");
  assert.equal(await ev("neonGame.save.credits"), backup.credits);
  await click("settings-done");
  checks.push(
    "exported save restores progress through the actual file input and overwrite confirmation",
  );
  // Use a clean racing configuration after preserving the test save.
  await ev(
    "neonGame.save.auto=true;neonGame.applySettings();neonGame.persist()",
  );
  for (const [width, height] of [
    [390, 844],
    [844, 390],
  ]) {
    await setViewport(width, height, true);
    await delay(250);
    assert.ok(
      await ev("document.documentElement.scrollWidth<=innerWidth"),
      "no horizontal overflow",
    );
    await shot(width === 390 ? "07-mobile-home" : "08-landscape-home");
  }
  await cdp("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
  await ev("neonGame.startRace(0)");
  await wait("neonGame.race?.phase==='racing'");
  await delay(1400);
  const rects = await ev(
    `['left','nitro'].map(control=>{const r=document.querySelector('[data-control="'+control+'"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})`,
  );
  const angle = await ev("neonGame.race.player.angle");
  await cdp("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: rects.map((p, id) => ({
      ...p,
      id,
      radiusX: 4,
      radiusY: 4,
      force: 1,
    })),
  });
  await delay(280);
  const touch = await ev("neonGame.snapshot()");
  assert.ok(touch.car.angle < angle - 0.1);
  assert.equal(touch.car.boosting, true);
  assert.equal(await ev("neonGame.touch.size"), 2);
  await shot("09-touch-race");
  await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert.equal(await ev("neonGame.touch.size"), 0);
  checks.push(
    "simultaneous steering + nitro touch input, capture release, landscape layout",
  );
  await click("pause");
  await setViewport(390, 844, true);
  await delay(200);
  assert.ok(await ev("document.documentElement.scrollWidth<=innerWidth"));
  await shot("10-mobile-pause");
  await click("resume");
  await shot("11-mobile-race");
  await click("pause");
  await click("leave");
  await ev("neonGame.startRace(0)");
  await wait("neonGame.race?.phase==='racing'");
  // Boundary fixture for the timeout UI; complete no-input loss is covered by model tests.
  await ev("neonGame.race.time=neonGame.race.track.limit-.05");
  await wait("neonGame.modalKind==='result'");
  const loss = await ev("neonGame.snapshot()");
  assert.equal(loss.result.won, false);
  assert.equal(loss.result.reward, 0);
  await shot("12-timeout");
  checks.push("timeout boundary reaches a retryable loss with no reward");
  await click("result-menu");
  await setViewport(1440, 900);
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
  // Render each authored environment; unlocking here is a render fixture only.
  await ev("neonGame.save.stars=[3,3,3,3]");
  for (let id = 1; id < 4; id++) {
    await ev(`neonGame.startRace(${id})`);
    await wait(`neonGame.renderer.trackId===${id}&&neonGame.inGame`);
    await shot("circuit-" + id);
    assert.ok(await ev("neonGame.renderer.stats().finite"));
    await click("pause");
    await click("leave");
  }
  checks.push("all four authored environments render through the public SDK");
  const resourceCycles=await ev(`(async()=>{const counts=[];for(let i=0;i<12;i++){await neonGame.renderer.selectTrack(i%4);await new Promise(r=>requestAnimationFrame(r));Laya.Resource.destroyUnusedResources(false);counts.push(neonGame.renderer.stats().resources.resources);}return counts;})()`);
  assert.ok(Math.max(...resourceCycles.slice(4))-Math.min(...resourceCycles.slice(4))<=6,JSON.stringify(resourceCycles));
  checks.push("3D worlds release bounded resources across twelve track changes");
  await ev("localStorage.setItem('zhuda.neon-apex.v1','{broken')");
  await load();
  assert.equal(await ev("neonGame.save.credits"), 0);
  assert.equal(await ev("neonGame.save.races"), 0);
  checks.push("corrupt stored data recovers to a playable fresh game");
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  const report = {
    passed: true,
    url,
    checkedAt: new Date().toISOString(),
    checks,
    liveRace: { result: won.result, gates: won.car.gates },
    touch: { steer: true, nitro: true, particles: touch.render.particles },
    webglDrawCalls: await ev("__drawCalls"),
    resourceCycles,
    renderDimension:3,
    errors,
    failures,
  };
  fs.writeFileSync(
    path.join(evidence, "browser-verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  socket?.close();
  chrome.kill("SIGTERM");
  server?.kill("SIGTERM");
  await delay(400);
  fs.rmSync(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 150,
  });
}

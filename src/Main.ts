import { ZhudaEngine } from "zhuda-laya-engine";
import { Renderer } from "./Renderer";
import { Race, type Input } from "./Model";
import { TRACKS, mapPath, at, angleDelta, nearest } from "./Tracks";
import {
  SAVE_KEY,
  parseSave,
  freshSave,
  unlocked,
  totalStars,
  upgradeCost,
  buyUpgrade,
  type Save,
} from "./Save";
import { carArt } from "./Art";
import { Sound } from "./Audio";
declare const Laya: any;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const time = (t: number) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(2).padStart(5, "0")}`;
const map = (id: number, w = 260, h = 125) =>
  `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${mapPath(TRACKS[id], w, h)}" fill="none" stroke="${TRACKS[id].color}22" stroke-width="14"/><path d="${mapPath(TRACKS[id], w, h)}" fill="none" stroke="${TRACKS[id].color}" stroke-width="3.5" stroke-linejoin="round"/></svg>`;
const stars = (n: number) => "★".repeat(n) + "☆".repeat(3 - n);
class Game {
  save: Save = freshSave();
  renderer!: Renderer;
  sound = new Sound();
  race: Race | null = null;
  selected = 0;
  inGame = false;
  paused = false;
  ready = false;
  keys = new Set<string>();
  touch = new Map<number, string>();
  modalKind = "";
  private accumulator = 0;
  private resultShown = false;
  private hudTimer = 0;
  private toastTimer = 0;
  private msgTimer = 0;
  private lastCount = 4;
  private storage = true;
  private starting = false;
  async init() {
    try {
      this.save = parseSave(localStorage.getItem(SAVE_KEY));
    } catch {
      this.storage = false;
    }
    if (matchMedia("(prefers-reduced-motion:reduce)").matches)
      this.save.reduced = true;
    await ZhudaEngine.boot({
      width: innerWidth,
      height: innerHeight,
      bgColor: "#0b1723",
      features: ["core", "2d"],
      scaleMode: "noscale",
    });
    this.resize();
    addEventListener("resize", () => this.resize());
    this.renderer = new Renderer();
    await this.renderer.init();
    this.bind();
    this.refreshLobby();
    this.applySettings();
    $("loading").hidden = true;
    $("app").hidden = false;
    this.ready = true;
    document.body.dataset.ready = "true";
    let previous = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.08, Math.max(0, (now - previous) / 1000));
      previous = now;
      if (this.inGame && this.race && !this.paused) {
        this.accumulator += dt;
        while (this.accumulator >= 1 / 120) {
          const prevPhase = this.race.phase;
          this.race.step(1 / 120, this.input());
          this.renderer.update(this.race, 1 / 120, this.save.reduced);
          this.accumulator -= 1 / 120;
          for (const e of this.race.events) {
            if (e.type === "wall") this.sound.beep(95, 0.06, 0.1, "triangle");
            if (e.type === "pad") {
              this.message("充能帶 +22 氮氣");
              this.sound.beep(880, 0.12, 0.1);
            }
            if (e.type === "lap" && this.race.phase !== "finished") {
              this.message(
                `第 ${this.race.lap} 圈 / ${this.race.track.laps} 圈`,
              );
              this.sound.beep(990, 0.15, 0.13);
            }
          }
          if (prevPhase !== "finished" && this.race.phase === "finished") {
            this.persist();
            this.sound.finish(this.race.result!.won);
            this.showResult();
          }
        }
      } else this.accumulator = 0;
      this.renderer.draw(this.race, this.selected, dt, this.inGame);
      const p = this.race?.player;
      this.sound.tick(
        p?.speed || 0,
        p?.boosting || false,
        this.inGame && !this.paused && this.race?.phase === "racing",
      );
      this.hudTimer += dt;
      if (this.hudTimer >= 0.065) {
        this.hudTimer = 0;
        this.updateHUD();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  private resize() {
    if (typeof Laya !== "undefined" && Laya.stage) {
      Laya.stage.size(innerWidth, innerHeight);
      Laya.stage.setScreenSize(innerWidth, innerHeight);
    }
  }
  private input(): Input {
    const controls = new Set(this.touch.values()),
      pressed = (...keys: string[]) => keys.some((k) => this.keys.has(k));
    return {
      steer:
        (pressed("ArrowRight", "KeyD") || controls.has("right") ? 1 : 0) -
        (pressed("ArrowLeft", "KeyA") || controls.has("left") ? 1 : 0),
      throttle:
        this.save.auto ||
        pressed("ArrowUp", "KeyW") ||
        controls.has("throttle"),
      brake: pressed("ArrowDown", "KeyS") || controls.has("brake"),
      nitro:
        pressed("Space", "ShiftLeft", "ShiftRight") || controls.has("nitro"),
    };
  }
  private clearInput() {
    this.keys.clear();
    this.touch.clear();
    document
      .querySelectorAll(".held")
      .forEach((e) => e.classList.remove("held"));
  }
  private bind() {
    $("start").onclick = () => {
      if (this.save.races === 0) this.showHelp(true);
      else this.startRace();
    };
    $("help-open").onclick = () => this.showHelp(false);
    $("garage-open").onclick = () => this.showGarage();
    $("settings-open").onclick = () => this.showSettings();
    $("pause").onclick = () => this.pause();
    const modal = $<HTMLDialogElement>("modal");
    modal.addEventListener("cancel", (e) => {
      e.preventDefault();
      if (this.modalKind === "pause") this.resume();
      else if (this.modalKind !== "result") this.closeModal();
    });
    addEventListener("keydown", (e) => {
      if (
        [
          "Space",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
        ].includes(e.code) &&
        this.inGame
      )
        e.preventDefault();
      if (
        (e.code === "Escape" || e.code === "KeyP") &&
        !e.repeat &&
        this.inGame
      ) {
        if (this.modalKind === "pause") this.resume();
        else if (!modal.open) this.pause();
        return;
      }
      if (e.code === "KeyR" && !e.repeat && this.modalKind === "pause") {
        this.startRace();
        return;
      }
      if (!modal.open) this.keys.add(e.code);
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => {
      this.clearInput();
      if (this.inGame && !this.paused && this.race?.phase !== "finished")
        this.pause();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.clearInput();
        if (this.inGame && this.race?.phase !== "finished") this.pause();
      }
    });
    for (const el of document.querySelectorAll<HTMLButtonElement>(
      "[data-control]",
    )) {
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (!this.inGame || this.paused) return;
        el.setPointerCapture(e.pointerId);
        this.touch.set(e.pointerId, el.dataset.control!);
        el.classList.add("held");
        this.sound.unlock();
      });
      const release = (e: PointerEvent) => {
        this.touch.delete(e.pointerId);
        if (![...this.touch.values()].includes(el.dataset.control!))
          el.classList.remove("held");
      };
      el.addEventListener("pointerup", release);
      el.addEventListener("pointercancel", release);
      el.addEventListener("lostpointercapture", release);
    }
    document.addEventListener("contextmenu", (e) => {
      if (this.inGame) e.preventDefault();
    });
    document
      .querySelector("canvas")
      ?.addEventListener("webglcontextlost", () => {
        if (this.inGame) this.pause();
        this.toast("圖形連線中斷，請重新整理頁面。");
      });
  }
  private persist() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.save));
      this.storage = true;
    } catch {
      this.storage = false;
    }
    $("save-status").innerHTML = this.storage
      ? "<i></i> 進度自動保存在此瀏覽器"
      : "進度暫存在記憶體 · 請至設定匯出備份";
  }
  private applySettings() {
    this.sound.muted = this.save.muted;
    document.body.classList.toggle("manual-throttle", !this.save.auto);
    $("drive-hint").textContent = this.save.auto
      ? "← → 轉向 · ↓ 煞車 · SPACE 氮氣"
      : "WASD / 方向鍵 · SPACE 氮氣";
  }
  refreshLobby() {
    $("wallet").textContent = this.save.credits.toLocaleString();
    $("star-total").textContent = `★ ${totalStars(this.save)} / 12`;
    $("track-list").innerHTML = TRACKS.map(
      (t, i) =>
        `<button class="track-option ${i === this.selected ? "selected" : ""} ${unlocked(this.save, i) ? "" : "locked"}" data-track="${i}" aria-label="${t.name}${unlocked(this.save, i) ? "" : "，尚未解鎖"}" aria-pressed="${i === this.selected}">${map(i, 100, 65)}<span><span class="track-option-name">${t.name}</span><small>${t.subtitle}</small><span class="stars">${unlocked(this.save, i) ? stars(this.save.stars[i]) : "前三名解鎖"}</span></span>${!unlocked(this.save, i) ? '<span class="lock">⌑</span>' : ""}</button>`,
    ).join("");
    document.querySelectorAll<HTMLButtonElement>("[data-track]").forEach(
      (el) =>
        (el.onclick = () => {
          const i = Number(el.dataset.track);
          if (!unlocked(this.save, i)) {
            this.toast(`先在「${TRACKS[i - 1].name}」跑進前三名`);
            return;
          }
          this.select(i);
        }),
    );
    const t = TRACKS[this.selected];
    $("track-district").textContent = t.district;
    $("track-number").textContent = String(this.selected + 1).padStart(2, "0");
    $("track-name").textContent = t.name;
    $("track-en").textContent = t.subtitle;
    $("track-map").innerHTML = map(t.id);
    $("track-laps").textContent = `${t.laps} LAP${t.laps > 1 ? "S" : ""}`;
    $("track-gold").textContent = time(t.gold);
    $("track-best").textContent =
      this.save.best[t.id] === null ? "—" : time(this.save.best[t.id]!);
    $("save-status").innerHTML = this.storage
      ? "<i></i> 進度自動保存在此瀏覽器"
      : "進度暫存在記憶體 · 請至設定匯出備份";
  }
  private select(id: number) {
    this.selected = id;
    this.renderer.selectTrack(id);
    this.refreshLobby();
  }
  async startRace(id = this.selected) {
    if (this.starting || !unlocked(this.save, id)) return;
    this.starting = true;
    $<HTMLButtonElement>("start").disabled = true;
    try {
      this.sound.unlock();
      this.closeModal();
      this.selected = id;
      await this.renderer.selectTrack(id);
      this.race = new Race(id, this.save);
      this.renderer.reset();
      this.resultShown = false;
      this.paused = false;
      this.inGame = true;
      this.lastCount = 4;
      this.accumulator = 0;
      this.clearInput();
      $("lobby").hidden = true;
      $("race-ui").hidden = false;
      $("hud-track").textContent = TRACKS[id].name;
      $("race-message").textContent = "";
      document.body.classList.add("racing");
      this.updateHUD();
    } finally {
      this.starting = false;
      $<HTMLButtonElement>("start").disabled = false;
    }
  }
  private message(text: string) {
    clearTimeout(this.msgTimer);
    $("race-message").textContent = text;
    this.msgTimer = window.setTimeout(
      () => ($("race-message").textContent = ""),
      1600,
    );
  }
  private updateHUD() {
    if (!this.inGame || !this.race) return;
    const r = this.race,
      p = r.player;
    $("position").innerHTML = `${r.position}<span>/4</span>`;
    $("lap").textContent = `${r.lap} / ${r.track.laps}`;
    $("race-time").textContent = time(r.time);
    $("remaining").textContent =
      `${Math.max(0, Math.ceil(r.track.limit - r.time))}s`;
    $("speed").textContent = String(Math.round(p.speed * 0.65));
    $("boost-number").textContent = `${Math.floor(p.nitro)}%`;
    $("boost-fill").style.width = p.nitro + "%";
    $("boost-label").textContent = p.boosting
      ? "NITRO ACTIVE ↗︎"
      : p.drifting
        ? "漂移充能 +"
        : "氮氣 / NITRO";
    const n = nearest(r.track, p.x, p.y),
      bend = angleDelta(at(r.track, n.s + 210).angle, n.angle);
    $("turn-hint").textContent =
      r.phase === "racing" && Math.abs(bend) > 0.28
        ? `${bend > 0 ? "↱ 右彎" : "↰ 左彎"}${Math.abs(bend) > 0.65 ? " · 提前煞車" : ""}`
        : "";
    if (r.phase === "countdown") {
      const n = Math.ceil(r.countdown);
      $("countdown").innerHTML =
        `${n}<em>前三名晉級 · ${r.track.laps} 圈 · ${r.track.limit} 秒時限</em>`;
      if (n !== this.lastCount) {
        this.lastCount = n;
        this.sound.beep(440, 0.1, 0.13);
      }
    } else if (r.time < 0.7) {
      $("countdown").innerHTML = "GO!";
      if (this.lastCount !== 0) {
        this.lastCount = 0;
        this.sound.beep(880, 0.3, 0.15);
      }
    } else $("countdown").innerHTML = "";
    this.drawMinimap();
  }
  private drawMinimap() {
    const r = this.race;
    if (!r) return;
    const c = $<HTMLCanvasElement>("minimap"),
      g = c.getContext("2d")!;
    g.clearRect(0, 0, 200, 160);
    const xs = r.track.points.map((p) => p.x),
      ys = r.track.points.map((p) => p.y),
      minX = Math.min(...xs),
      minY = Math.min(...ys),
      scale = Math.min(
        168 / (Math.max(...xs) - minX),
        128 / (Math.max(...ys) - minY),
      );
    const ox = (200 - (Math.max(...xs) - minX) * scale) / 2,
      oy = (160 - (Math.max(...ys) - minY) * scale) / 2;
    const project = (x: number, y: number) => [
      ox + (x - minX) * scale,
      oy + (y - minY) * scale,
    ];
    g.lineWidth = 7;
    g.strokeStyle = "#97b3be33";
    g.lineJoin = "round";
    g.beginPath();
    r.track.points.forEach((p, i) => {
      const [x, y] = project(p.x, p.y);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.closePath();
    g.stroke();
    const p0 = at(r.track, 0),
      [fx, fy] = project(p0.x, p0.y);
    g.fillStyle = "#edf3ea";
    g.fillRect(fx - 2, fy - 4, 4, 8);
    [...r.cars].reverse().forEach((car) => {
      const [x, y] = project(car.x, car.y);
      g.fillStyle = car.color;
      g.beginPath();
      g.arc(x, y, car === r.player ? 4 : 3, 0, 7);
      g.fill();
    });
  }
  private modal(kind: string, html: string) {
    this.clearInput();
    this.modalKind = kind;
    $("modal-content").innerHTML = `<div class="modal-inner">${html}</div>`;
    const d = $<HTMLDialogElement>("modal");
    if (!d.open) d.showModal();
  }
  private closeModal() {
    const d = $<HTMLDialogElement>("modal");
    if (d.open) d.close();
    this.modalKind = "";
  }
  private heading(label: string, title: string, close = true) {
    return `<p class="modal-overline">${label}</p><div class="modal-heading"><h2>${title}</h2>${close ? '<button class="close" id="modal-close" aria-label="關閉">×</button>' : ""}</div>`;
  }
  private wireClose() {
    const el = $("modal-close");
    if (el) el.onclick = () => this.closeModal();
  }
  showHelp(start: boolean) {
    this.modal(
      "help",
      this.heading("DRIVER BRIEFING", "先抓住節奏。") +
        `<p class="modal-copy">預設自動踩油門，專心轉向與超車。想自己控制油門，可在設定切換。</p><div class="key-guide"><div><kbd>← → / A D</kbd>左右轉向</div><div><kbd>↓ / S</kbd>煞車過彎</div><div><kbd>SPACE</kbd>按住氮氣</div><div><kbd>ESC / P</kbd>暫停比賽</div></div><div class="help-tips"><p><span class="tip-number">01</span><b>先慢、再快。</b> 入彎前煞車，出彎後按氮氣；煞車時轉向可漂移充能。</p><p><span class="tip-number">02</span><b>壓過發光箭頭。</b> 充能帶補充氮氣，善用每一段直線。</p><p><span class="tip-number">03</span><b>前三名晉級。</b> 冠軍與金牌時間各多得一顆星；獎金能在車庫升級。</p><p>手機使用下方轉向、煞車與氮氣按鈕，支援同時按住多個按鈕。橫向握持視野更寬。</p></div><button id="help-go" class="primary">${start ? "明白，開始比賽" : "準備上路"} <span>↗︎</span></button>`,
    );
    this.wireClose();
    $("help-go").onclick = () => this.startRace();
  }
  pause() {
    if (!this.inGame || this.race?.phase === "finished") return;
    this.paused = true;
    this.clearInput();
    this.modal(
      "pause",
      this.heading("PIT STOP", "休息一下，再出發。", false) +
        `<p class="modal-copy">比賽與計時已暫停。<br>按 ESC / P 返回；按 R 重新開始。</p><button class="primary" id="resume">繼續比賽 <span>→</span></button><button class="secondary" id="restart">重新發車</button><button class="secondary" id="leave">返回賽道選單</button>`,
    );
    $("resume").onclick = () => this.resume();
    $("restart").onclick = () => this.startRace();
    $("leave").onclick = () => this.lobby();
  }
  resume() {
    if (!this.inGame) return;
    this.closeModal();
    this.paused = false;
    this.clearInput();
    this.sound.unlock();
  }
  private lobby() {
    this.closeModal();
    this.inGame = false;
    this.paused = false;
    this.clearInput();
    this.race = null;
    $("race-ui").hidden = true;
    $("lobby").hidden = false;
    document.body.classList.remove("racing");
    this.refreshLobby();
  }
  private showResult() {
    if (this.resultShown || !this.race?.result) return;
    this.resultShown = true;
    const r = this.race,
      result = r.result!,
      won = result.won,
      next = this.selected + 1;
    this.modal(
      "result",
      `<p class="modal-overline">${r.track.subtitle} / RACE COMPLETE</p><div class="result-top"><div class="place-large">${won ? String(result.place).padStart(2, "0") : "—"}<small>${won ? " / 04" : ""}</small></div><h2>${won ? (result.place === 1 ? "今晚，由你領跑。" : "漂亮，拿下晉級。") : "這一彎，下次拿下。"}</h2><p>${won ? (result.newBest ? "刷新此賽道最佳成績。" : "已完成賽道，獎金已入帳。") : result.reason === "timeout" ? "時間到了。入彎前煞車，直線再用氮氣。" : "差一點就進前三！累積氮氣，留給出彎的直線。"}</p><div class="earned-stars">${"<span>★</span>".repeat(result.stars)}<span class="empty">${"★".repeat(3 - result.stars)}</span></div></div><div class="result-stats"><div><small>比賽用時</small><strong>${time(result.time)}</strong></div><div><small>本場獎金</small><strong>◈ ${result.reward}</strong></div><div><small>氮氣時間</small><strong>${r.boostTime.toFixed(1)}s</strong></div></div><div class="objectives"><span class="${won ? "achieved" : ""}">${won ? "✓" : "○"} 前三名完賽</span><span class="${won && result.place === 1 ? "achieved" : ""}">${won && result.place === 1 ? "✓" : "○"} 奪得冠軍</span><span class="${won && result.time <= r.track.gold ? "achieved" : ""}">${won && result.time <= r.track.gold ? "✓" : "○"} ${time(r.track.gold)} 金牌</span></div><div class="result-actions"><button class="secondary" id="result-menu">返回選單</button><button class="primary" id="result-next">${won && next < 4 ? "下一條賽道" : "再跑一場"} <span>↗︎</span></button></div>${won && next < 4 ? `<p class="unlocked-note">↗︎ 已解鎖「${TRACKS[next].name}」</p>` : won && next === 4 ? '<p class="unlocked-note">四條賽道全數完成！繼續挑戰 12 星全收集。</p>' : ""}`,
    );
    $("result-menu").onclick = () => this.lobby();
    $("result-next").onclick = () =>
      this.startRace(won && next < 4 ? next : this.selected);
  }
  showGarage() {
    const names = ["PULSE / 脈衝", "COMET / 彗星", "GHOST / 幽影"],
      desc = [
        "均衡起跑，穩定過彎",
        "極速 +15 · 需 4 顆星",
        "抓地更強 · 需 8 顆星",
      ],
      requirements = [0, 4, 8];
    this.modal(
      "garage",
      this.heading("YOUR NIGHT MACHINE", "車庫與升級") +
        `<p class="modal-copy">跑進前三拿獎金，升級會套用到每台車。<span class="garage-wallet">◈ ${this.save.credits.toLocaleString()}</span></p><div class="cars">${names.map((name, i) => `<button class="car-choice ${this.save.car === i ? "selected" : ""}" data-car="${i}" aria-pressed="${this.save.car === i}" ${totalStars(this.save) < requirements[i] ? "disabled" : ""}><span id="car-art-${i}"></span><strong>${name}</strong><small>${desc[i]}${this.save.car === i ? " · 使用中" : ""}</small></button>`).join("")}</div>${["動力單元", "輪胎抓地", "氮氣效率"].map((name, i) => `<div class="upgrade-row"><div><strong>${name}</strong><small>${["每級極速 +12、加速 +7", "每級提高轉向後的回正抓地", "每級降低氮氣消耗 2 / 秒"][i]}</small><div class="upgrade-dots">${[0, 1, 2].map((k) => `<i class="${this.save.upgrades[i] > k ? "on" : ""}"></i>`).join("")}</div></div><button data-upgrade="${i}" ${this.save.upgrades[i] >= 3 || this.save.credits < upgradeCost(this.save.upgrades[i]) ? "disabled" : ""}>${this.save.upgrades[i] >= 3 ? "已滿級" : "◈ " + upgradeCost(this.save.upgrades[i]) + " ↗︎"}</button></div>`).join("")}<button id="garage-done" class="secondary">回到賽道</button>`,
    );
    this.wireClose();
    for (let i = 0; i < 3; i++) {
      $("car-art-" + i).appendChild(
        carArt(["#d9fc74", "#ff8b77", "#ba9cff"][i]),
      );
    }
    document.querySelectorAll<HTMLButtonElement>("[data-car]").forEach(
      (el) =>
        (el.onclick = () => {
          const i = Number(el.dataset.car);
          if (totalStars(this.save) < requirements[i]) return;
          this.save.car = i;
          this.persist();
          this.showGarage();
        }),
    );
    document.querySelectorAll<HTMLButtonElement>("[data-upgrade]").forEach(
      (el) =>
        (el.onclick = () => {
          if (buyUpgrade(this.save, Number(el.dataset.upgrade))) {
            this.persist();
            this.refreshLobby();
            this.showGarage();
            this.sound.unlock();
            this.sound.beep(880, 0.13);
          }
        }),
    );
    $("garage-done").onclick = () => this.closeModal();
  }
  showSettings() {
    this.modal(
      "settings",
      this.heading("MAKE IT YOURS", "駕駛設定") +
        `<div class="setting-row"><div><strong>自動油門</strong><small>自動加速，只需轉向、煞車與氮氣。</small></div><input type="checkbox" id="auto-setting" aria-label="自動油門" ${this.save.auto ? "checked" : ""}></div><div class="setting-row"><div><strong>音效</strong><small>引擎聲、充能與比賽提示音。</small></div><input type="checkbox" id="sound-setting" aria-label="音效" ${!this.save.muted ? "checked" : ""}></div><div class="setting-row"><div><strong>精簡特效</strong><small>關閉車身氣流與漂移煙霧，保留賽道與操作。</small></div><input type="checkbox" id="reduced-setting" aria-label="精簡特效" ${this.save.reduced ? "checked" : ""}></div><p class="modal-copy">進度儲存在這個瀏覽器；清除網站資料會移除存檔。可以匯出備份，在另一個瀏覽器匯入。</p><div class="setting-actions"><button id="backup">↓ 匯出存檔</button><button id="restore">↑ 匯入存檔</button><button id="reset-save" class="danger">重置進度</button></div><input id="save-file" type="file" accept="application/json" hidden><button id="settings-done" class="secondary">完成</button>`,
    );
    this.wireClose();
    $("auto-setting").onchange = () => {
      this.save.auto = $<HTMLInputElement>("auto-setting").checked;
      this.applySettings();
      this.persist();
    };
    $("sound-setting").onchange = () => {
      this.save.muted = !$<HTMLInputElement>("sound-setting").checked;
      this.applySettings();
      this.sound.unlock();
      this.persist();
    };
    $("reduced-setting").onchange = () => {
      this.save.reduced = $<HTMLInputElement>("reduced-setting").checked;
      this.persist();
    };
    $("settings-done").onclick = () => this.closeModal();
    $("backup").onclick = () => {
      const blob = new Blob([JSON.stringify(this.save, null, 2)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = "neon-apex-save.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.toast("存檔已匯出");
    };
    $("restore").onclick = () => $<HTMLInputElement>("save-file").click();
    $("save-file").onchange = async () => {
      const file = $<HTMLInputElement>("save-file").files?.[0];
      if (!file) return;
      try {
        if (file.size > 50000) throw new Error();
        const raw = await file.text(),
          v = JSON.parse(raw);
        if (
          v?.version !== 1 ||
          !Array.isArray(v.stars) ||
          !Array.isArray(v.upgrades)
        )
          throw new Error();
        if (!confirm("匯入會覆蓋目前進度，確定匯入這份存檔？")) return;
        this.save = parseSave(raw);
        this.selected = 0;
        this.persist();
        this.applySettings();
        this.select(0);
        this.showSettings();
        this.toast("存檔已匯入");
      } catch {
        this.toast("無法讀取這份存檔，請選擇匯出的 JSON 檔案");
      }
    };
    $("reset-save").onclick = () => {
      if (!confirm("確定重置所有賽道、車輛與獎金？建議先匯出備份。")) return;
      this.save = freshSave();
      this.persist();
      this.applySettings();
      this.select(0);
      this.showSettings();
      this.toast("已重置進度");
    };
  }
  private toast(text: string) {
    clearTimeout(this.toastTimer);
    $("toast").textContent = text;
    $("toast").classList.add("show");
    this.toastTimer = window.setTimeout(
      () => $("toast").classList.remove("show"),
      3500,
    );
  }
  snapshot() {
    return {
      ready: this.ready,
      inGame: this.inGame,
      paused: this.paused,
      selected: this.selected,
      modal: this.modalKind,
      phase: this.race?.phase,
      time: this.race?.time,
      position: this.race?.position,
      lap: this.race?.lap,
      result: this.race?.result,
      car: this.race
        ? {
            x: this.race.player.x,
            y: this.race.player.y,
            angle: this.race.player.angle,
            speed: this.race.player.speed,
            nitro: this.race.player.nitro,
            progress: this.race.player.progress,
            gates: this.race.player.gates,
            boosting: this.race.player.boosting,
          }
        : null,
      save: JSON.parse(JSON.stringify(this.save)),
      render: this.renderer.stats(),
    };
  }
}
const game = new Game();
(window as any).neonGame = game;
game.init().catch((error) => {
  document.body.dataset.error = error.message;
  $("loading-label").textContent =
    "載入失敗。請確認瀏覽器支援 WebGL，並重新整理。";
  console.error(error);
});

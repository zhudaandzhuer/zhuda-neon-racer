import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Race,
  TRACKS,
  at,
  nearest,
  freshSave,
  parseSave,
  buyUpgrade,
  unlocked,
  vehicleContact,
} from "../.test-build.mjs";
const idle = { steer: 0, throttle: false, brake: false, nitro: false };
test("sedan footprint detects bumper contact, permits side-by-side passes and resolves crossed/coincident bodies", () => {
  const a = { x: 0, y: 0, angle: 0 };
  assert.equal(vehicleContact(a, { x: 55, y: 0, angle: 0 }), null);
  assert.ok(Math.abs(vehicleContact(a, { x: 50, y: 0, angle: 0 }).penetration - 4.8) < 1e-5);
  assert.equal(vehicleContact(a, { x: 0, y: 25, angle: 0 }), null);
  assert.ok(vehicleContact(a, { x: 0, y: 23, angle: 0 }).penetration > 0);
  for (const angle of [0, Math.PI / 2, Math.PI]) {
    const b = { x: 0, y: 0, angle };
    for (let i = 0; i < 8; i++) {
      const hit = vehicleContact(a, b);
      if (!hit) break;
      b.x += hit.x * (hit.penetration + 0.01);
      b.y += hit.y * (hit.penetration + 0.01);
    }
    assert.equal(vehicleContact(a, b), null);
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
  }
});
function run(r, controller, max = 300) {
  for (let i = 0; i < max * 120 && !r.result; i++)
    r.step(1 / 120, controller(r));
  return r.result;
}
test("all four circuits can be completed by driving, award credits and unlock the next circuit", () => {
  const save = freshSave();
  for (let i = 0; i < 4; i++) {
    assert.ok(unlocked(save, i));
    const r = new Race(i, save),
      result = run(r, (r) => r.aiInput(0));
    console.log(
      TRACKS[i].name,
      result,
      "hits",
      r.collisions,
      "gates",
      r.player.gates,
    );
    assert.ok(result?.won, TRACKS[i].name + " is winnable");
    assert.equal(r.player.gates, 8 * TRACKS[i].laps);
    assert.ok(result.reward > 0);
    assert.ok(save.best[i] > 0);
    const credits = save.credits;
    r.step(1 / 120, idle);
    assert.equal(save.credits, credits, "result paid once");
  }
  assert.ok(save.stars.every((v) => v >= 1));
  assert.equal(save.races, 4);
});
test("no input loses; pause is owned by the caller; reverse driving cannot finish", () => {
  const save = freshSave(),
    r = new Race(0, save);
  const out = run(r, () => idle);
  assert.equal(out.won, false);
  assert.equal(out.reason, "timeout");
  assert.equal(save.credits, 0);
  assert.equal(save.stars[0], 0);
  const backward = new Race(0, freshSave());
  backward.countdown = 0;
  backward.phase = "racing";
  backward.player.angle += Math.PI;
  for (let i = 0; i < 120 * 12; i++)
    backward.step(1 / 120, { ...idle, throttle: true });
  assert.equal(backward.player.gates, 0);
});
test("nitro consumes a bounded reservoir, brake slows down, and barriers contain the car", () => {
  const r = new Race(0, freshSave());
  r.phase = "racing";
  for (let i = 0; i < 120; i++) r.step(1 / 120, { ...idle, throttle: true });
  const before = r.player.speed,
    nitro = r.player.nitro;
  for (let i = 0; i < 60; i++)
    r.step(1 / 120, { ...idle, throttle: true, nitro: true });
  assert.ok(r.player.speed > before);
  assert.ok(r.player.nitro < nitro);
  const boosted = r.player.speed;
  for (let i = 0; i < 60; i++) r.step(1 / 120, { ...idle, brake: true });
  assert.ok(r.player.speed < boosted - 50);
  for (let i = 0; i < 120 * 20; i++)
    r.step(1 / 120, { ...idle, throttle: true });
  assert.ok(
    nearest(r.track, r.player.x, r.player.y).distance <= r.track.width / 2,
  );
  assert.ok(r.collisions > 0);
});
test("sectors reject a teleport to the finish, and locked tracks reject entry", () => {
  const r = new Race(0, freshSave());
  r.phase = "racing";
  const p = at(r.track, r.track.length - 10);
  Object.assign(r.player, { x: p.x, y: p.y, lastS: p.s });
  r.step(1 / 120, idle);
  assert.equal(r.player.gates, 0);
  assert.equal(r.player.finished, false);
  assert.throws(() => new Race(3, freshSave()));
});
test("save survives round trip, corrupted saves recover, purchases are atomic and capped", () => {
  const s = freshSave();
  s.credits = 2000;
  s.stars = [3, 2, 0, 0];
  s.best[0] = 32.5;
  assert.ok(buyUpgrade(s, 0));
  assert.equal(s.credits, 1700);
  assert.equal(s.upgrades[0], 1);
  assert.ok(buyUpgrade(s, 0));
  assert.ok(buyUpgrade(s, 0));
  const before = s.credits;
  assert.equal(buyUpgrade(s, 0), false);
  assert.equal(s.credits, before);
  assert.equal(buyUpgrade(s, -1), false);
  assert.deepEqual(parseSave(JSON.stringify(s)), s);
  assert.deepEqual(parseSave("{broken"), freshSave());
  const damaged = parseSave(
    '{"version":1,"credits":-300,"stars":[0,3,3,3],"upgrades":[999,-2,null],"car":2}',
  );
  assert.deepEqual(damaged.stars, [0, 0, 0, 0]);
  assert.deepEqual(damaged.upgrades, [3, 0, 0]);
  assert.equal(damaged.car, 0);
  assert.equal(damaged.credits, 0);
});

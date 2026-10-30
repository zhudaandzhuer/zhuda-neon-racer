import { at, nearest, type Track } from "./Tracks";
export const canvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};
export function carArt(color: string) {
  const c = canvas(90, 140),
    g = c.getContext("2d")!;
  g.translate(45, 70);
  g.shadowColor = "#000";
  g.shadowBlur = 12;
  g.shadowOffsetY = 7;
  g.fillStyle = "#02070e";
  g.beginPath();
  g.roundRect(-27, -43, 54, 92, 12);
  g.fill();
  g.shadowBlur = 0;
  g.shadowOffsetY = 0;
  for (const x of [-31, 21])
    for (const y of [-35, 24]) {
      g.fillStyle = "#03080e";
      g.fillRect(x, y, 10, 25);
      g.fillStyle = "#42505a";
      g.fillRect(x + 2, y + 2, 6, 2);
    }
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(-22, 48);
  g.lineTo(-27, -15);
  g.quadraticCurveTo(-22, -55, 0, -58);
  g.quadraticCurveTo(22, -55, 27, -15);
  g.lineTo(22, 48);
  g.closePath();
  g.fill();
  g.fillStyle = "#f4ffd855";
  g.beginPath();
  g.moveTo(-20, -18);
  g.lineTo(-15, -44);
  g.lineTo(15, -44);
  g.lineTo(20, -18);
  g.closePath();
  g.fill();
  g.fillStyle = "#0c2630";
  g.beginPath();
  g.moveTo(-19, -14);
  g.lineTo(19, -14);
  g.lineTo(14, 9);
  g.lineTo(-14, 9);
  g.closePath();
  g.fill();
  g.strokeStyle = "#eaffff88";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-17, -12);
  g.lineTo(17, -12);
  g.stroke();
  g.fillStyle = "#11282c";
  g.fillRect(-13, 14, 26, 17);
  g.fillStyle = "#ffffff66";
  g.fillRect(-2, -49, 4, 27);
  g.fillRect(-2, 33, 4, 11);
  g.shadowBlur = 8;
  g.shadowColor = "#fff";
  g.fillStyle = "#f5ffed";
  g.fillRect(-21, -43, 10, 5);
  g.fillRect(11, -43, 10, 5);
  g.shadowColor = "#ff534b";
  g.fillStyle = "#ff665b";
  g.fillRect(-20, 40, 10, 4);
  g.fillRect(10, 40, 10, 4);
  g.shadowBlur = 0;
  g.fillStyle = "#17262c";
  g.fillRect(-30, 44, 60, 6);
  g.fillStyle = color;
  g.fillRect(-29, 44, 58, 2);
  return c;
}
export function textureArt(kind: string) {
  const c = canvas(128, 128),
    g = c.getContext("2d")!;
  if (kind === "ribbon") {
    const image = g.createImageData(128, 128);
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        const i = (y * 128 + x) * 4;
        image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
        image.data[i + 3] =
          255 *
          Math.pow(Math.sin((y / 127) * Math.PI), 2) *
          Math.pow(1 - x / 127, 1.4);
      }
    g.putImageData(image, 0, 0);
  } else {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "#ffffffff");
    grad.addColorStop(kind === "smoke" ? 0.5 : 0.14, "#ffffff88");
    grad.addColorStop(1, "#ffffff00");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  return c;
}
export function trackArt(t: Track) {
  const c = canvas(2150, 2100),
    g = c.getContext("2d")!;
  g.fillStyle = t.id === 2 ? "#0b1b20" : "#0b1723";
  g.fillRect(0, 0, c.width, c.height);
  let seed = 419 + t.id * 35;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  g.strokeStyle = "#36576b18";
  g.lineWidth = 1;
  for (let x = 0; x < 2150; x += 80) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 2100);
    g.stroke();
  }
  for (let y = 0; y < 2100; y += 80) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(2150, y);
    g.stroke();
  }
  if (t.id === 0) {
    g.fillStyle = "#102d3b";
    g.fillRect(0, 1660, 2150, 440);
    for (let y = 1680; y < 2100; y += 28) {
      g.strokeStyle = "#4fd8d51a";
      g.beginPath();
      for (let x = 0; x < 2150; x += 20) {
        const yy = y + Math.sin(x * 0.015 + y) * 4;
        x === 0 ? g.moveTo(x, yy) : g.lineTo(x, yy);
      }
      g.stroke();
    }
  }
  for (let i = 0; i < 330; i++) {
    const x = rand() * 2150,
      y = rand() * 2100;
    if (nearest(t, x, y).distance < t.width / 2 + 65) continue;
    if (t.id === 2 || rand() < 0.18) {
      const r = 10 + rand() * 23;
      g.fillStyle = "#061319";
      g.beginPath();
      g.arc(x + 5, y + 8, r + 4, 0, 7);
      g.fill();
      g.fillStyle = ["#17362f", "#16312d", "#214438"][i % 3];
      g.beginPath();
      g.arc(x, y, r, 0, 7);
      g.fill();
      g.fillStyle = "#58887628";
      g.beginPath();
      g.arc(x - 4, y - 5, r * 0.6, 0, 7);
      g.fill();
      continue;
    }
    if (t.id === 0 && y > 1640) continue;
    const w = 35 + rand() * 86,
      h = 28 + rand() * 90;
    g.fillStyle = "#030b1488";
    g.fillRect(x + 10, y + 12, w, h);
    g.fillStyle = ["#132534", "#152e3a", "#142734"][i % 3];
    g.fillRect(x, y, w, h);
    g.strokeStyle = "#345265";
    g.lineWidth = 2;
    g.strokeRect(x, y, w, h);
    g.fillStyle = "#ffffff08";
    g.fillRect(x + 4, y + 4, w - 8, 6);
    const lit = i % 4 === 0 ? t.color : "#4d899c";
    g.fillStyle = lit + "66";
    for (let k = 8; k < w - 4; k += 14) g.fillRect(x + k, y + h - 6, 6, 2);
    if (i % 8 === 0) {
      g.fillStyle = lit;
      g.font = "bold 11px monospace";
      g.fillText(["APEX", "24H", "Z /", "NEON"][i % 4], x + 5, y + 20);
    }
  }
  // The road is authored once into a static texture; only cars/effects move per frame.
  const line = () => {
    g.beginPath();
    t.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
  };
  g.lineJoin = "round";
  g.lineCap = "round";
  line();
  g.strokeStyle = "#030b14aa";
  g.lineWidth = t.width + 38;
  g.stroke();
  line();
  g.strokeStyle = t.color + "28";
  g.lineWidth = t.width + 20;
  g.stroke();
  line();
  g.strokeStyle = "#677d87";
  g.lineWidth = t.width + 4;
  g.stroke();
  line();
  g.strokeStyle = "#233542";
  g.lineWidth = t.width;
  g.stroke();
  line();
  g.strokeStyle = "#263a48";
  g.lineWidth = t.width - 28;
  g.stroke();
  g.lineCap = "butt";
  for (let s = 0; s < t.length; s += 18) {
    const p = at(t, s),
      q = at(t, s + 18);
    for (const side of [-1, 1]) {
      const off = (t.width / 2 - 5) * side;
      g.strokeStyle = Math.floor(s / 36) % 2 === 0 ? "#c9dbcf" : "#f28177";
      g.lineWidth = 9;
      g.beginPath();
      g.moveTo(p.x - Math.sin(p.angle) * off, p.y + Math.cos(p.angle) * off);
      g.lineTo(q.x - Math.sin(q.angle) * off, q.y + Math.cos(q.angle) * off);
      g.stroke();
    }
  }
  line();
  g.lineWidth = 2;
  g.setLineDash([14, 28]);
  g.strokeStyle = "#d8ebe13b";
  g.stroke();
  g.setLineDash([]);
  for (let s = 180; s < t.length; s += 250) {
    const p = at(t, s);
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.angle);
    g.strokeStyle = "#b8e6d21f";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-8, -12);
    g.lineTo(7, 0);
    g.lineTo(-8, 12);
    g.stroke();
    g.restore();
  }
  for (const ratio of t.pads) {
    const p = at(t, ratio * t.length);
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.angle);
    g.fillStyle = t.color + "24";
    g.fillRect(-32, -57, 64, 114);
    g.strokeStyle = t.color;
    g.lineWidth = 5;
    g.shadowColor = t.color;
    g.shadowBlur = 15;
    for (const x of [-22, -3, 16]) {
      g.beginPath();
      g.moveTo(x, -43);
      g.lineTo(x + 16, 0);
      g.lineTo(x, 43);
      g.stroke();
    }
    g.restore();
  }
  const start = at(t, 0);
  g.save();
  g.translate(start.x, start.y);
  g.rotate(start.angle);
  for (let r = 0; r < 2; r++)
    for (let j = 0; j < 12; j++) {
      g.fillStyle = (r + j) % 2 ? "#17262f" : "#f0f7df";
      g.fillRect(
        r * 11 - 11,
        -t.width / 2 + (j * t.width) / 12,
        11,
        t.width / 12,
      );
    }
  g.font = "bold 21px monospace";
  g.fillStyle = "#d9fc74";
  g.rotate(-Math.PI / 2);
  g.fillText("START / FINISH", -95, -34);
  g.restore();
  // District paint is part of the environment, not a diagnostic label.
  g.save();
  g.translate(900, 1030);
  g.fillStyle = t.color + "15";
  g.textAlign = "center";
  g.font = "900 90px sans-serif";
  g.fillText("NEON", 0, 0);
  g.font = "20px monospace";
  g.fillStyle = t.color + "55";
  g.fillText(t.subtitle, 0, 46);
  g.restore();
  return c;
}

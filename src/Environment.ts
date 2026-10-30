declare const Laya: any;

/** A small static lighting cube matching the procedural sunset, not an extra render pass. */
export function createSkylineIBL() {
  const size = 128;
  const faces = Array.from({ length: 6 }, (_, face) => {
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (2 * (x + 0.5)) / size - 1;
        const v = (2 * (y + 0.5)) / size - 1;
        const d = [
          [1, -v, -u], [-1, -v, u], [u, 1, v],
          [u, -1, -v], [u, -v, 1], [-u, -v, -1],
        ][face];
        const length = Math.hypot(...d);
        const height = d[1] / length;
        const angle = Math.atan2(d[2], d[0]);
        const horizon = Math.exp(-Math.abs(height) * 4);
        const sun = Math.pow(Math.max(0, d[0] / length * 0.9 + height * 0.2 + d[2] / length * 0.3), 28);
        const window = Math.pow(Math.max(0, Math.cos(angle * 16)), 18) * Math.exp(-Math.abs(height - 0.2) * 7);
        const top = [0.32, 0.4, 0.6];
        const ground = [0.08, 0.1, 0.16];
        const warm = [0.7, 0.38, 0.24];
        const offset = (y * size + x) * 4;
        for (let c = 0; c < 3; c++) {
          const base = height > 0 ? top[c] : ground[c];
          pixels[offset + c] = Math.round(Math.min(1, base * (1 - horizon) + warm[c] * horizon + sun * [0.8, 0.6, 0.3][c] + window * 0.35) * 255);
        }
        pixels[offset + 3] = 255;
      }
    }
    return pixels;
  });
  const texture = new Laya.TextureCube(size, Laya.TextureFormat.R8G8B8A8, true, true);
  texture.setPixelsData(faces, false, false);
  return texture;
}

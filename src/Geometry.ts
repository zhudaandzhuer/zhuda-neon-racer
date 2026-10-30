import { ZhudaDynamicMesh } from "zhuda-laya-engine";
export type V = [number, number, number];
/** Static scenery is combined by material instead of hundreds of individual draw calls. */
export class Geometry {
  p: number[] = [];
  n: number[] = [];
  uv: number[] = [];
  ix: number[] = [];
  quad(
    a: V,
    b: V,
    c: V,
    d: V,
    normal: V,
    uv: number[] = [0, 0, 1, 0, 1, 1, 0, 1],
  ) {
    const i = this.p.length / 3;
    this.p.push(...a, ...b, ...c, ...d);
    for (let j = 0; j < 4; j++) this.n.push(...normal);
    this.uv.push(...uv);
    const ab = b.map((v, k) => v - a[k]),
      ac = c.map((v, k) => v - a[k]),
      dot =
        (ab[1] * ac[2] - ab[2] * ac[1]) * normal[0] +
        (ab[2] * ac[0] - ab[0] * ac[2]) * normal[1] +
        (ab[0] * ac[1] - ab[1] * ac[0]) * normal[2];
    this.ix.push(
      ...(dot > 0
        ? [i, i + 2, i + 1, i, i + 3, i + 2]
        : [i, i + 1, i + 2, i, i + 2, i + 3]),
    );
  }
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    yaw = 0,
  ) {
    const point = (a: number, b: number, c: number): V => [
        x + Math.cos(yaw) * a + Math.sin(yaw) * c,
        y + b,
        z - Math.sin(yaw) * a + Math.cos(yaw) * c,
      ],
      normal = (a: number, b: number, c: number): V => [
        Math.cos(yaw) * a + Math.sin(yaw) * c,
        b,
        -Math.sin(yaw) * a + Math.cos(yaw) * c,
      ];
    w /= 2;
    h /= 2;
    d /= 2;
    this.quad(
      point(-w, h, -d),
      point(w, h, -d),
      point(w, h, d),
      point(-w, h, d),
      [0, 1, 0],
    );
    this.quad(
      point(-w, -h, -d),
      point(-w, -h, d),
      point(w, -h, d),
      point(w, -h, -d),
      [0, -1, 0],
    );
    this.quad(
      point(-w, -h, d),
      point(w, -h, d),
      point(w, h, d),
      point(-w, h, d),
      normal(0, 0, 1),
    );
    this.quad(
      point(w, -h, -d),
      point(-w, -h, -d),
      point(-w, h, -d),
      point(w, h, -d),
      normal(0, 0, -1),
    );
    this.quad(
      point(w, -h, d),
      point(w, -h, -d),
      point(w, h, -d),
      point(w, h, d),
      normal(1, 0, 0),
    );
    this.quad(
      point(-w, -h, -d),
      point(-w, -h, d),
      point(-w, h, d),
      point(-w, h, -d),
      normal(-1, 0, 0),
    );
  }
  build(parent: any, material: any, name: string) {
    const mesh = new ZhudaDynamicMesh(
      {
        positions: new Float32Array(this.p),
        normals: new Float32Array(this.n),
        uvs: new Float32Array(this.uv),
        indices:
          this.p.length / 3 > 65535
            ? new Uint32Array(this.ix)
            : new Uint16Array(this.ix),
      },
      parent,
    );
    mesh.node.meshRenderer.sharedMaterial = material;
    mesh.node.name = name;
    return mesh;
  }
}

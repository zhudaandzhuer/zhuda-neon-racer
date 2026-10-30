import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

function imageSize(data, mime) {
  if (mime === "image/png") return [data.readUInt32BE(16), data.readUInt32BE(20)];
  assert.equal(mime, "image/jpeg");
  assert.equal(data.readUInt16BE(0), 0xffd8);
  const startsOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset < data.length) {
    assert.equal(data[offset++], 0xff);
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++];
    if (startsOfFrame.has(marker)) return [data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3)];
    assert.ok(marker !== 0xda && marker !== 0xd9);
    offset += data.readUInt16BE(offset);
  }
  throw new Error("Missing JPEG frame dimensions");
}

// Catch accidentally publishing the 90 MB authoring file, broken offsets,
// unsupported compression or the packed 4K textures silently surviving export.
for (const [name, triangleLimit, textureLimit] of [
  ["maextro-s800", 60000, 1024],
  ["maextro-s800-rival", 22000, 512],
]) {
  test(`${name}: bounded GLB payload with embedded PBR maps and finite geometry`, () => {
    const base = path.resolve(import.meta.dirname, "../public/models", name);
    const bytes = fs.readFileSync(base + ".glb");
    const report = JSON.parse(fs.readFileSync(base + ".json", "utf8"));
    assert.equal(bytes.subarray(0, 4).toString(), "glTF");
    assert.equal(bytes.readUInt32LE(4), 2);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    assert.ok(bytes.length < 6_000_000);
    assert.equal(bytes.length, report.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), report.sha256);
    const jsonLength = bytes.readUInt32LE(12);
    const model = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
    const bin = bytes.subarray(28 + jsonLength);
    assert.ok(!model.extensionsRequired?.length);
    for (const view of model.bufferViews) {
      assert.ok((view.byteOffset || 0) + view.byteLength <= bin.length);
    }
    let triangles = 0;
    for (const mesh of model.meshes) for (const primitive of mesh.primitives) {
      assert.equal(primitive.mode ?? 4, 4);
      const positions = model.accessors[primitive.attributes.POSITION];
      const indices = model.accessors[primitive.indices];
      triangles += indices.count / 3;
      assert.ok(positions.min.every(Number.isFinite) && positions.max.every(Number.isFinite));
      assert.ok(positions.max[1] - positions.min[1] > 1);
      assert.ok(positions.max[2] - positions.min[2] > 5);
      const view = model.bufferViews[primitive.attributes.POSITION];
      const offset = (view.byteOffset || 0) + (positions.byteOffset || 0);
      for (let i = 0; i < positions.count; i++) for (let k = 0; k < 3; k++)
        assert.ok(Number.isFinite(bin.readFloatLE(offset + i * (view.byteStride || 12) + k * 4)));
    }
    assert.ok(triangles > 10000 && triangles <= triangleLimit);
    assert.equal(triangles, report.triangles);
    for (const image of model.images) {
      assert.ok(!image.uri && image.bufferView !== undefined);
      const view = model.bufferViews[image.bufferView];
      const data = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
      const [width, height] = imageSize(data, image.mimeType);
      assert.ok(width > 0 && height > 0 && width <= textureLimit && height <= textureLimit);
    }
    const pbr = model.materials[0];
    assert.ok(pbr.normalTexture && pbr.pbrMetallicRoughness.baseColorTexture && pbr.pbrMetallicRoughness.metallicRoughnessTexture);
    assert.equal(pbr.doubleSided, true);
  });
}

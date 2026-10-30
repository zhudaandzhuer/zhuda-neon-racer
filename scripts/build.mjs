import fs from "node:fs";
import {createHash} from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine =
  process.env.ZHUDA_ENGINE_ROOT || path.resolve(root, "../Zhuda-LayaAir");
const { default: esbuild } = await import(
  pathToFileURL(path.join(engine, "node_modules/esbuild/lib/main.js"))
);
fs.mkdirSync(path.join(root, "dist/libs"), { recursive: true });
for (const file of ["laya.core.js", "laya.d3.js", "laya.webgl_2D.js", "laya.webgl_3D.js", "laya.gltf.js", "laya.postProcess.js"])
  fs.copyFileSync(
    path.join(engine, "vendor/laya-3.4.2/libs", file),
    path.join(root, "dist/libs", file),
  );
fs.cpSync(path.join(root, "public"), path.join(root, "dist"), {
  recursive: true,
});
for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
  if (fs.existsSync(path.join(root, name)))
    fs.copyFileSync(path.join(root, name), path.join(root, "dist", name));
fs.writeFileSync(path.join(root, "dist/.nojekyll"), "");
await esbuild.build({
  entryPoints: [path.join(root, "src/Main.ts")],
  bundle: true,
  format: "iife",
  target: "es2020",
  outfile: path.join(root, "dist/game.js"),
  sourcemap: true,
  minify: true,
  alias: {
    "zhuda-laya-engine": path.join(engine, "dist/sdk/zhuda-laya-engine.esm.js"),
  },
});
const htmlPath=path.join(root,"dist/index.html");
const gameHash=createHash('sha256').update(fs.readFileSync(path.join(root,'dist/game.js'))).digest('hex').slice(0,12);
fs.writeFileSync(htmlPath,fs.readFileSync(htmlPath,'utf8').replace('src="game.js"',`src="game.js?v=${gameHash}"`).replace('href="launch.css"',`href="launch.css?v=${gameHash}"`));
console.log("Neon Apex built with the public engine SDK.");

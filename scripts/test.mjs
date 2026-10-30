import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine =
  process.env.ZHUDA_ENGINE_ROOT || path.resolve(root, "../Zhuda-LayaAir");
const { default: esbuild } = await import(
  pathToFileURL(path.join(engine, "node_modules/esbuild/lib/main.js"))
);
await esbuild.build({
  stdin: {
    contents:
      "export * from './src/Model';export * from './src/Tracks';export * from './src/Save';",
    resolveDir: root,
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: path.join(root, ".test-build.mjs"),
});
const r = spawnSync(process.execPath, ["--test", "tests/model.test.mjs"], {
  cwd: root,
  stdio: "inherit",
});
process.exitCode = r.status;

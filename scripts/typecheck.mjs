import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  engine =
    process.env.ZHUDA_ENGINE_ROOT || path.resolve(root, "../Zhuda-LayaAir");
const { default: ts } = await import(
  pathToFileURL(path.join(engine, "node_modules/typescript/lib/typescript.js"))
);
const config = ts.readConfigFile(
    path.join(root, "tsconfig.json"),
    ts.sys.readFile,
  ),
  parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
parsed.options.paths = {
  "zhuda-laya-engine": [path.join(engine, "packages/types/index.d.ts")],
};
const program = ts.createProgram(parsed.fileNames, parsed.options),
  diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (f) => f,
      getNewLine: () => "\n",
    }),
  );
  process.exitCode = 1;
} else console.log("Strict TypeScript consumer passed.");

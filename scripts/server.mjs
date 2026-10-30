import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../dist",
  ),
  base = (process.env.BASE_PATH || "").replace(/\/$/, "");
http
  .createServer((req, res) => {
    let p;
    try {
      p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (base) {
      if (p !== base && !p.startsWith(base + "/")) {
        res.writeHead(404).end();
        return;
      }
      p = p.slice(base.length) || "/";
    }
    const file = path.resolve(root, "." + (p === "/" ? "/index.html" : p));
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (e, data) => {
      if (e) {
        res.writeHead(404).end();
        return;
      }
      res
        .writeHead(200, {
          "Content-Type":
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".css": "text/css",
              ".svg": "image/svg+xml",
              ".json": "application/json",
              ".png": "image/png",
            }[path.extname(file)] || "application/octet-stream",
          "Cache-Control": "no-store",
        })
        .end(data);
    });
  })
  .listen(Number(process.env.PORT || 8899), "0.0.0.0", () =>
    console.log(
      "Neon Apex http://localhost:" + (process.env.PORT || 8899) + base + "/",
    ),
  );

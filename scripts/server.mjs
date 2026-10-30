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
    fs.stat(file, (e, stat) => {
      if (e || !stat.isFile()) {
        res.writeHead(404).end();
        return;
      }
      const headers = {
          "Content-Type":
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".css": "text/css",
              ".svg": "image/svg+xml",
              ".json": "application/json",
              ".png": "image/png",
              ".jpg": "image/jpeg",
              ".gif": "image/gif",
              ".webp": "image/webp",
              ".mp4": "video/mp4",
            }[path.extname(file)] || "application/octet-stream",
          "Cache-Control": "no-store",
          "Accept-Ranges": "bytes",
      };
      let start = 0, end = stat.size - 1, status = 200;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (match && (match[1] || match[2])) {
          if (match[1]) {
            start = Number(match[1]);
            if (match[2]) end = Math.min(Number(match[2]), end);
          } else start = Math.max(0, stat.size - Number(match[2]));
        } else start = stat.size;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
          res.writeHead(416, { ...headers, "Content-Range": `bytes */${stat.size}` }).end();
          return;
        }
        status = 206;
        headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
      }
      headers["Content-Length"] = Math.max(0, end - start + 1);
      res.writeHead(status, headers);
      if (req.method === "HEAD" || !stat.size) res.end();
      else fs.createReadStream(file, { start, end }).on("error", () => res.destroy()).pipe(res);
    });
  })
  .listen(Number(process.env.PORT || 8899), "0.0.0.0", () =>
    console.log(
      "Neon Apex http://localhost:" + (process.env.PORT || 8899) + base + "/",
    ),
  );

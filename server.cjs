const http = require("http"),
  fs = require("fs"),
  path = require("path");
const base = __dirname;
const port = Number(process.env.PORT || 4173);
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    const file = pathname.endsWith("/")
      ? pathname.replace(/^\/+/, "") + "index.html"
      : pathname.replace(/^\/+/, "");
    const full = path.resolve(base, file);
    if (!full.startsWith(base + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    fs.readFile(full, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end("Not found");
      }
      res.setHeader(
        "Content-Type",
        contentTypes[path.extname(full)] || "text/plain",
      );
      res.end(data);
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`Local: http://127.0.0.1:${port}`));

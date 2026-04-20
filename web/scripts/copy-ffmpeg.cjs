// Copy @ffmpeg/core (umd) + @ffmpeg/ffmpeg wrapper worker into web/public/ffmpeg/
// so they're served same-origin from Netlify. Runs on every build (prebuild hook).
const fs = require("fs");
const path = require("path");

function findUp(startDir, rel) {
  let cur = startDir;
  for (let i = 0; i < 5; i++) {
    const p = path.join(cur, rel);
    if (fs.existsSync(p)) return p;
    cur = path.dirname(cur);
  }
  throw new Error("Could not find: " + rel);
}

const webRoot = path.resolve(__dirname, "..");
const destDir = path.join(webRoot, "public", "ffmpeg");
fs.mkdirSync(destDir, { recursive: true });

const sources = [
  ["node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js", "ffmpeg-core.js"],
  ["node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm", "ffmpeg-core.wasm"],
  ["node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js", "worker.js"],
];

for (const [rel, name] of sources) {
  const src = findUp(webRoot, rel);
  const dst = path.join(destDir, name);
  fs.copyFileSync(src, dst);
  const size = fs.statSync(dst).size;
  console.log(`[copy-ffmpeg] ${name} (${(size / 1024).toFixed(0)} KB)`);
}

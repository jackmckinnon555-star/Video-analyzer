// Rasterize the TRA icon SVG to a 1024x1024 PNG.
// electron-builder picks up build/icon.png and auto-generates .ico/.icns.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const here = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")));
const buildDir = path.resolve(here, "..", "build");
const src = path.join(buildDir, "icon.svg");
const out = path.join(buildDir, "icon.png");

if (!fs.existsSync(src)) {
  console.error("Missing source SVG:", src);
  process.exit(1);
}

const svg = fs.readFileSync(src);
await sharp(svg, { density: 384 })
  .resize(1024, 1024)
  .png({ compressionLevel: 9 })
  .toFile(out);
console.log(`Wrote ${out}`);

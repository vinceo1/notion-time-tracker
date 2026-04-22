#!/usr/bin/env node
/**
 * Build-icons — rasterise build/icon.svg into the platform-specific
 * formats electron-builder expects:
 *
 *   build/icon.icns     (macOS, via `iconutil`)
 *   build/icon.ico      (Windows, via `png-to-ico`)
 *   build/icon.png      (Linux / fallback, 1024×1024)
 *
 * Run via `npm run icons`. Safe to commit the generated files; they
 * rebuild from the SVG any time it changes.
 */
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BUILD = join(ROOT, "build");
const SVG_PATH = join(BUILD, "icon.svg");
const ICONSET_DIR = join(BUILD, "icon.iconset");

const MAC_ICONSET = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  const svg = await readFile(SVG_PATH);

  // Fresh iconset folder
  await rm(ICONSET_DIR, { recursive: true, force: true });
  await mkdir(ICONSET_DIR, { recursive: true });

  console.log("→ Rendering macOS iconset PNGs");
  await Promise.all(
    MAC_ICONSET.map(([name, size]) =>
      sharp(svg, { density: 384 })
        .resize(size, size)
        .png({ compressionLevel: 9 })
        .toFile(join(ICONSET_DIR, name)),
    ),
  );

  // .icns (only on macOS — iconutil is Apple-only)
  if (process.platform === "darwin") {
    console.log("→ Generating build/icon.icns via iconutil");
    execFileSync("iconutil", [
      "-c",
      "icns",
      ICONSET_DIR,
      "-o",
      join(BUILD, "icon.icns"),
    ]);
  } else {
    console.log(
      "→ Skipping .icns (iconutil is only available on macOS); " +
        "run `npm run icons` on a Mac to regenerate icon.icns.",
    );
  }

  console.log("→ Generating build/icon.png (1024 fallback)");
  await sharp(svg, { density: 384 })
    .resize(1024, 1024)
    .png({ compressionLevel: 9 })
    .toFile(join(BUILD, "icon.png"));

  console.log("→ Generating build/icon.ico");
  const icoBuffers = await Promise.all(
    ICO_SIZES.map((size) =>
      sharp(svg, { density: 384 })
        .resize(size, size)
        .png({ compressionLevel: 9 })
        .toBuffer(),
    ),
  );
  const ico = await pngToIco(icoBuffers);
  await writeFile(join(BUILD, "icon.ico"), ico);

  console.log("✓ Icons built.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

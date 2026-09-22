// Deterministic format conversion of the approved artwork; no image redesign.
// Run: node node_modules/electron/cli.js scripts/build-icon.cjs
const { app, nativeImage } = require("electron");
const { writeFileSync, mkdirSync } = require("node:fs");
const { resolve } = require("node:path");
app
  .whenReady()
  .then(() => {
    const image = nativeImage.createFromPath(resolve("assets/icon-source.png"));
    if (image.isEmpty()) throw new Error("Missing approved icon source");
    const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
    const images = sizes.map((size) =>
      image.resize({ width: size, height: size, quality: "best" }).toPNG(),
    );
    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    sizes.forEach((size, i) => {
      const entry = 6 + i * 16;
      header[entry] = header[entry + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, entry + 4);
      header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(images[i].length, entry + 8);
      header.writeUInt32LE(offset, entry + 12);
      offset += images[i].length;
    });
    writeFileSync("assets/app.ico", Buffer.concat([header, ...images]));
    mkdirSync("apps/web/public", { recursive: true });
    writeFileSync("apps/web/public/favicon.png", images[sizes.indexOf(32)]);
    console.log("Generated Windows ICO: " + sizes.join(", "));
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

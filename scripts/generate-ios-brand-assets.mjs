import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = new URL("../", import.meta.url);
const logo = await readFile(new URL("public/kordyn-logo.svg", root));
const background = "#f7f0e7";

async function logoPng(size) {
  return sharp(logo).resize(size, size, { fit: "contain" }).png().toBuffer();
}

const iconSize = 1024;
const iconLogoSize = 650;
await sharp({ create: { width: iconSize, height: iconSize, channels: 3, background } })
  .composite([{ input: await logoPng(iconLogoSize), left: (iconSize - iconLogoSize) / 2, top: (iconSize - iconLogoSize) / 2 }])
  .flatten({ background })
  .removeAlpha()
  .png()
  .toFile(fileURLToPath(new URL("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", root)));

const splashSize = 2732;
const splashLogoSize = 660;
const splashLogo = await logoPng(splashLogoSize);
const wordmark = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="180"><text x="450" y="98" text-anchor="middle" fill="#201c17" font-family="Arial, sans-serif" font-size="96" font-weight="600" letter-spacing="24">KORDYN</text><text x="450" y="154" text-anchor="middle" fill="#8a8175" font-family="Arial, sans-serif" font-size="27" font-weight="500" letter-spacing="7">AI DIGITAL ASSET TRADER</text></svg>`);
const splash = await sharp({ create: { width: splashSize, height: splashSize, channels: 3, background } })
  .composite([
    { input: splashLogo, left: (splashSize - splashLogoSize) / 2, top: 790 },
    { input: wordmark, left: (splashSize - 900) / 2, top: 1510 }
  ])
  .flatten({ background })
  .removeAlpha()
  .png()
  .toBuffer();

for (const file of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  await sharp(splash).toFile(fileURLToPath(new URL(`ios/App/App/Assets.xcassets/Splash.imageset/${file}`, root)));
}

console.log("Generated iOS app icon and splash assets from public/kordyn-logo.svg");

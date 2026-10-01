// Draws extension/icons/*.png from the SVGs in scripts/art, in headless Chromium.
//   node scripts/icons.mjs
import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';

const art = (name) => readFile(new URL(`./art/${name}`, import.meta.url), 'utf8');
const sizes = [[128, 'icon.svg'], [48, 'icon.svg'], [32, 'icon-small.svg'], [16, 'icon-small.svg']];
const browser = await chromium.launch({ channel: 'chromium', headless: true });
for (const [size, file] of sizes) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${await art(file)}`);
  await page.screenshot({ path: new URL(`../extension/icons/icon-${size}.png`, import.meta.url).pathname, omitBackground: true });
  await page.close();
}
await browser.close();

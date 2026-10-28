// scripts/capture-studio-screenshots.mjs
// Automated high-DPI screenshot capture for AFWE Studio (Core)
import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outDir = path.resolve(__dirname, '../docs/screenshots');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function captureStudio() {
  console.log('Launching Chrome to capture live AFWE Studio from http://127.0.0.1:4173/');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#root', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 2000));

  // Helper to click sidebar button by label
  async function clickNav(label) {
    await page.evaluate((btnLabel) => {
      const buttons = Array.from(document.querySelectorAll('aside nav button'));
      const target = buttons.find((b) => b.textContent && b.textContent.includes(btnLabel));
      if (target) {
        target.click();
      }
    }, label);
    await new Promise((r) => setTimeout(r, 1500));
  }

  // 1. Overview
  console.log('Capturing studio-overview.png...');
  await clickNav('Overview');
  await page.screenshot({ path: path.join(outDir, 'studio-overview.png') });
  console.log('Saved studio-overview.png');

  // 2. Blueprint
  console.log('Capturing studio-blueprint.png...');
  await clickNav('Blueprint');
  await page.screenshot({ path: path.join(outDir, 'studio-blueprint.png') });
  console.log('Saved studio-blueprint.png');

  // 3. Timeline & Turns
  console.log('Capturing studio-timeline.png...');
  await clickNav('Timeline');
  await page.screenshot({ path: path.join(outDir, 'studio-timeline.png') });
  console.log('Saved studio-timeline.png');

  // 4. Checks & Tripwires
  console.log('Capturing studio-checks.png...');
  await clickNav('Checks');
  await page.screenshot({ path: path.join(outDir, 'studio-checks.png') });
  console.log('Saved studio-checks.png');

  // 5. Decisions & Memory
  console.log('Capturing studio-decisions.png...');
  await clickNav('Decisions');
  await page.screenshot({ path: path.join(outDir, 'studio-decisions.png') });
  console.log('Saved studio-decisions.png');

  await browser.close();
  console.log('All 5 live AFWE Studio screenshots captured successfully!');
}

captureStudio().catch((err) => {
  console.error('Failed to capture Studio screenshots:', err);
  process.exit(1);
});

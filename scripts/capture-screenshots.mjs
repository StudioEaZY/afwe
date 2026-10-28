// scripts/capture-screenshots.mjs
// Automated high-DPI screenshot capture for AFWE ReBorn documentation
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

async function capture() {
  console.log('Launching Chrome from:', chromePath);
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  // 1. Capture Turn Rejection Ledger from /stage
  console.log('Capturing turn rejection ledger...');
  await page.goto('http://localhost:4321/stage', { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 600));
  const ledgerEl = await page.$('figure.code-panel');
  if (ledgerEl) {
    await ledgerEl.screenshot({
      path: path.join(outDir, 'turn-rejection-ledger.png')
    });
    console.log('Saved turn-rejection-ledger.png');
  }

  // 2. Capture Codebase Blueprint Radar from /
  console.log('Capturing codebase radar...');
  await page.goto('http://localhost:4321/', { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 800)); // wait for radar animation
  const radarEl = await page.$('div.w-full.rounded-2xl.border-2');
  if (radarEl) {
    await radarEl.screenshot({
      path: path.join(outDir, 'blueprint-radar.png')
    });
    console.log('Saved blueprint-radar.png');
  }

  // 3. Capture 3-Step Turn Loop from /
  console.log('Capturing 3-step turn loop...');
  const stepsEl = await page.$('ol.divide-y');
  if (stepsEl) {
    await stepsEl.screenshot({
      path: path.join(outDir, 'turn-protocol-steps.png')
    });
    console.log('Saved turn-protocol-steps.png');
  }

  // 4. Capture Seat Pool Allocation Grid from /pricing
  console.log('Capturing seat pool allocation grid...');
  await page.goto('http://localhost:4321/pricing', { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 600));
  const seatPoolBox = await page.$('div.lg\\:col-span-7');
  if (seatPoolBox) {
    await seatPoolBox.screenshot({
      path: path.join(outDir, 'seat-pool-grid.png')
    });
    console.log('Saved seat-pool-grid.png');
  }

  // 5. Capture Roadmap Trajectory Track from /roadmap
  console.log('Capturing roadmap trajectory track...');
  await page.goto('http://localhost:4321/roadmap', { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 600));
  const roadmapEl = await page.$('section.space-y-12 > div.rounded-2xl');
  if (roadmapEl) {
    await roadmapEl.screenshot({
      path: path.join(outDir, 'roadmap-trajectory.png')
    });
    console.log('Saved roadmap-trajectory.png');
  }

  await browser.close();
  console.log('All screenshots captured successfully into docs/screenshots/');
}

capture().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});

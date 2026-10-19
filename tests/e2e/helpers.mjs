import { chromium } from 'playwright';

export const URL = process.env.SIM_URL ?? 'http://localhost:4173/';

export async function launch() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  return { browser, page, errors };
}

/** Max live peak (dBFS) at a meter tap over a window, read from the real analysers. */
export async function peak(page, tap, ms = 500) {
  await page.waitForTimeout(200); // let parameter ramps settle and flush the analyser window
  return page.evaluate(async ([t, w]) => window.__dm3.engine.measure(t, w), [tap, ms]);
}

export async function powerAndPlay(page) {
  await page.getByTestId('power').click();
  await page.waitForFunction(() => window.__dm3 && window.__dm3.runtime.getState().stemsReady, null, { timeout: 20000 });
  await page.getByTestId('tab-sources').click();
  await page.getByTestId('play-all').click();
  await page.waitForTimeout(300);
}

export const st = (page) => page.evaluate(() => window.__dm3.store.getState().console);

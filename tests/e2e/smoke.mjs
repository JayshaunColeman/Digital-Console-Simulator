import { launch, peak, powerAndPlay } from './helpers.mjs';
const { browser, page, errors } = await launch();
await page.screenshot({ path: process.argv[2] + '/off.png' });
await powerAndPlay(page);
for (const t of ['dev.p1', 'port.in1', 'ch.ch1.in', 'ch.ch1.post', 'bus.st.in', 'bus.st.out', 'out.omni7', 'listen', 'bus.mix1.in', 'out.omni1'])
  console.log(t, (await peak(page, t)).toFixed(1));
await page.getByTestId('tab-overview').click();
await page.waitForTimeout(500);
await page.screenshot({ path: process.argv[2] + '/on.png' });
console.log('errors', errors);
await browser.close();

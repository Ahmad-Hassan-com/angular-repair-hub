// End-to-end lifecycle: customer request -> vendor accepts -> OTP pickup -> quotation ->
// approval -> repair -> OTP delivery -> payment -> review -> admin pages.
// Usage: npm run build, serve dist/repair-hub/browser, then
//   E2E_URL=http://localhost:4200 CHROME_PATH=/path/to/chrome npm run e2e
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
const OUT = process.argv[2] ?? 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
const URL = process.env.E2E_URL ?? 'http://localhost:4200';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
let failed = false;
const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const settle = (ms = 700) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
const step = (s) => console.log('STEP', s);
const status = () => page.locator('app-status').first().innerText();
async function login(email) {
  await page.evaluate(() => localStorage.removeItem('repairhub.token')).catch(() => {});
  await page.goto(URL + '/login');
  await settle(1200);
  await page.fill('input[formcontrolname=email]', email);
  await page.fill('input[formcontrolname=password]', 'Demo@1234');
  await page.click('button[type=submit]');
  await settle(2500);
}
async function confirmDialog(text) {
  if (text) await page.locator('mat-dialog-container textarea').fill(text);
  await page.locator('mat-dialog-actions button').last().click();
  await settle(1200);
}
async function code(jobId) {
  await login('sara@example.pk');
  await page.goto(URL + '/customer/jobs/' + jobId);
  await settle(1500);
  await page.getByRole('button', { name: /Show handover code/ }).click();
  await settle(1200);
  return (await page.locator('.code .mono').innerText()).trim();
}

try {
  step('landing');
  await page.goto(URL);
  await settle(2500);
  await shot('01-landing');

  step('customer approves seeded quote');
  await login('sara@example.pk');
  await shot('02-customer-home');
  await page.getByText('Review quotation').first().click();
  await settle(1500);
  await shot('03-quote');
  await page.getByRole('button', { name: /Approve Rs/ }).click();
  await settle(600);
  await confirmDialog();
  console.log('after approve:', await status());

  step('customer new request');
  await page.goto(URL + '/customer/new');
  await settle(1500);
  await page.locator('mat-select[formcontrolname=brandId]').click();
  await page.getByRole('option', { name: 'Samsung' }).click();
  await settle(300);
  await page.locator('mat-select[formcontrolname=modelId]').click();
  await page.getByRole('option').first().click();
  await settle(300);
  await page.locator('label.cat').first().click();
  await page.fill('textarea[formcontrolname=description]', 'Screen cracked badly after dropping it on the road.');
  await page.locator('button:visible', { hasText: /^\s*Next\s*$/ }).first().click();
  await settle(600);
  await page.locator('button:visible', { hasText: /^\s*Next\s*$/ }).first().click();
  await settle(600);
  await shot('04-new-review');
  await page.getByRole('button', { name: /Submit request/ }).click();
  await settle(2200);
  const newRef = (await page.locator('h1.mono').innerText()).trim();
  const jobId = page.url().split('/').pop();
  console.log('created', newRef, jobId, await status());

  step('vendor accepts');
  await login('fixit@repairhub.pk');
  await shot('05-vendor-dash');
  await page.goto(URL + '/vendor/marketplace');
  await settle(1500);
  await shot('06-marketplace');
  await page.locator('article.job', { hasText: newRef }).getByRole('button', { name: /Accept/ }).click();
  await settle(2200);
  console.log('vendor job page:', page.url(), await status());
  await page.getByRole('button', { name: 'Schedule pickup' }).click();
  await settle(1500);
  await page.getByRole('button', { name: 'Start pickup' }).click();
  await settle(1500);
  console.log('after start:', await status());

  step('collection with OTP');
  const c1 = await code(jobId);
  await shot('07-handover-code');
  await login('fixit@repairhub.pk');
  await page.goto(URL + '/vendor/jobs/' + jobId);
  await settle(1500);
  await page.fill('input[formcontrolname=otp]', c1 === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: /confirm collection/ }).click();
  await settle(1200);
  console.log('wrong code:', await page.locator('mat-snack-bar-container').innerText().catch(() => 'none'));
  await page.fill('input[formcontrolname=otp]', c1);
  await page.fill('input[formcontrolname=imei]', '356789012345678');
  await page.getByRole('button', { name: /confirm collection/ }).click();
  await settle(1800);
  console.log('after collect:', await status());
  await page.getByRole('button', { name: 'Received at shop' }).click();
  await settle(1500);
  await page.getByRole('button', { name: 'Start inspection' }).click();
  await settle(1500);
  await page.fill('textarea[formcontrolname=findings]', 'Display and digitizer cracked.');
  await page.fill('input[formcontrolname=proposedRepair]', 'Replace display assembly.');
  await page.locator('app-quotation-form input[formcontrolname=description]').nth(0).fill('Display assembly');
  const prices = page.locator('app-quotation-form input[formcontrolname=unitPrice]');
  await prices.nth(0).fill('9000');
  await prices.nth(1).fill('1500');
  await settle(300);
  await shot('08-quote-form');
  await page.getByRole('button', { name: /Send quotation/ }).click();
  await settle(1800);
  console.log('after quote:', await status());

  step('customer approves');
  await login('sara@example.pk');
  await page.goto(URL + '/customer/jobs/' + jobId);
  await settle(1500);
  await page.getByRole('button', { name: /Approve Rs/ }).click();
  await settle(600);
  await confirmDialog();

  step('vendor repairs and delivers');
  await login('fixit@repairhub.pk');
  await page.goto(URL + '/vendor/jobs/' + jobId);
  await settle(1500);
  for (const b of ['Start repair', 'Repair completed', 'Quality check passed']) {
    await page.getByRole('button', { name: b }).click();
    await settle(1500);
  }
  await page.getByRole('button', { name: 'Schedule delivery' }).click();
  await settle(1500);
  await page.getByRole('button', { name: 'Out for delivery' }).click();
  await settle(1500);
  const c2 = await code(jobId);
  await login('fixit@repairhub.pk');
  await page.goto(URL + '/vendor/jobs/' + jobId);
  await settle(1500);
  await page.fill('input[formcontrolname=otp]', c2);
  await page.getByRole('button', { name: /confirm delivery/ }).click();
  await settle(1800);
  console.log('after delivery:', await status());
  await page.getByRole('button', { name: 'Record payment' }).click();
  await settle(1800);
  console.log('after payment:', await status());
  await shot('09-vendor-paid');

  step('customer review and receipt');
  await login('sara@example.pk');
  await page.goto(URL + '/customer/jobs/' + jobId);
  await settle(1500);
  await page.locator('.stars button').nth(4).click();
  await page.getByRole('button', { name: 'Submit review' }).click();
  await settle(1500);
  await shot('10-customer-done');
  await page.goto(URL + '/receipt/' + jobId);
  await settle(1500);
  await shot('11-receipt');

  step('admin');
  await login('admin@repairhub.pk');
  await settle(1000);
  await shot('12-admin-overview');
  for (const [p, n] of [['jobs', '13-admin-jobs'], ['reports', '14-reports'], ['finance', '15-finance'], ['vendors', '16-vendors'], ['settings', '17-settings'], ['audit', '18-audit'], ['deliveries', '19-deliveries'], ['support', '20-support'], ['catalog', '21-catalog'], ['staff', '22-staff'], ['customers', '23-customers'], ['jobs/' + jobId, '24-admin-job']]) {
    await page.goto(URL + '/admin/' + p);
    await settle(1800);
    await shot(n);
  }
  await page.goto(URL + '/admin/reports');
  await settle(1500);
  await page.getByRole('tab', { name: 'Finance' }).click();
  await settle(1200);
  await shot('25-reports-fin');

  step('agent');
  await login('rider@repairhub.pk');
  await shot('26-agent');
  step('ops staff');
  await login('ops@repairhub.pk');
  await shot('27-ops');

  step('access control');
  await login('techcare@repairhub.pk');
  await page.goto(URL + '/vendor/jobs/' + jobId);
  await settle(1500);
  console.log('other vendor sees:', await page.locator('.state h2').first().innerText().catch(() => 'NO EMPTY STATE'));

  step('mobile');
  await page.setViewportSize({ width: 390, height: 844 });
  await login('sara@example.pk');
  await shot('28-mobile-home');
  await page.goto(URL + '/customer/jobs/' + jobId);
  await settle(1500);
  await shot('29-mobile-job');
  await page.goto(URL);
  await settle(1500);
  await shot('30-mobile-landing');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log('mobile horizontal overflow:', overflow);
} catch (e) {
  console.log('FAILED', e.message.split('\n')[0]);
  await shot('zz-failure');
}
console.log('ERRORS', JSON.stringify(errors.slice(0, 10)));
await browser.close();
if (failed || errors.length) process.exit(1);

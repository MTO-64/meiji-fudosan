#!/usr/bin/env node
// 問い合わせフォームの床。Web3Formsへの通信は横取りし、実際には送信しない。
// 実行: PREVIEW=1 OUT=<dir> node src-site/build.mjs の後、OUT=<dir> node src-site/form.test.mjs
// 見ていないもの: Web3Formsの実到達と受信メール(ownerの承認後に1回だけ実送信で確かめる)。
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { homedir } from 'node:os';

const OUT = process.env.OUT;
if (!OUT) { console.error('OUT を指定してください'); process.exit(2); }
const require = createRequire(join(homedir(), 'meiji-fudosan/package.json'));
const { chromium } = require('playwright');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp' };
const server = createServer((q, r) => {
  const p = decodeURIComponent(q.url.split('?')[0]);
  const file = join(OUT, p.endsWith('/') ? `${p}index.html` : p);
  if (!existsSync(file)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  r.end(readFileSync(file));
}).listen(0, '127.0.0.1');
await new Promise((res) => server.once('listening', res));
const base = `http://127.0.0.1:${server.address().port}`;

const fails = [];
const check = (name, ok, got) => { console.log(`${ok ? 'ok' : 'NG'}: ${name}${ok ? '' : ` → ${got}`}`); if (!ok) fails.push(name); };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
let body = null;
let mode = 'ok';
await page.route(/api\.web3forms\.com/, async (route) => {
  body = route.request().postData();
  if (mode === 'ok') await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"success":true}' });
  else if (mode === 'error') await route.abort();
  // 'hang' は応答を返さない
});
await page.route(/google|gstatic/, (route) => route.abort());
await page.goto(`${base}/contact/?type=sell`);
await page.waitForTimeout(800);
const status = () => page.textContent('#status');

await page.click('.submit');
check('名前が空なら送らない', body === null && /お名前/.test(await status()), await status());
await page.fill('[name=name]', '試験');
await page.click('.submit');
check('連絡先が空なら送らない', body === null && /どちらか/.test(await status()), await status());
await page.fill('[name=email]', 'abc');
await page.click('.submit');
check('メール形式の誤りは送らない', body === null && /形式/.test(await status()), await status());
await page.fill('[name=email]', 'a@example.com');
await page.fill('[name=message]', '本文');

mode = 'error';
await page.click('.submit');
await page.waitForTimeout(500);
check('通信失敗で電話を案内し入力を残す', /0299-35-2123/.test(await status()) && (await page.inputValue('[name=name]')) === '試験', await status());

mode = 'hang';
await page.click('.submit');
await page.waitForTimeout(16000);
check('応答なしでも15秒で電話を案内する', /0299-35-2123/.test(await status()) && !(await page.isDisabled('.submit')), await status());

mode = 'ok';
body = null;
await page.click('.submit');
await page.waitForTimeout(500);
check('成功を知らせて入力を消す', /受け付けました/.test(await status()) && (await page.inputValue('[name=name]')) === '', await status());
const sent = [...(body || '').matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)/g)];
const has = (n) => sent.find((m) => m[1] === n)?.[2];
check('公開キーと種別と本文が届く', (has('access_key') || '').length > 8 && has('type') === 'sell' && has('message') === '本文', sent.map((m) => m[1]).join(','));
check('ボット対策の欄が空で送られる', !has('botcheck'), has('botcheck'));

await browser.close();
server.close();
if (fails.length) { console.error(`NG ${fails.length}件`); process.exit(1); }
console.log('全PASS');

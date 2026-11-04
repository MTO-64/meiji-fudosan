#!/usr/bin/env node
// 公開後の更新経路の床。物件データ→content→新デザインの一方向を、別の場所へ作って確かめる。
// 正の証人: 価格変更が新デザインの詳細と一覧の両方に載る。負: 消した物件の個別ページが残らない。
// 見ていないもの: athomeからの取得、sitemapのlastmod、見た目。
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const box = mkdtempSync(join(tmpdir(), 'meiji-rebuild-'));
for (const d of ['content', 'scripts', 'src-site', 'a']) cpSync(join(REPO, d), join(box, d), { recursive: true });
const run = (file) => execFileSync('node', [file], { cwd: box, encoding: 'utf8' });
const fail = (m) => { console.error(`NG: ${m}`); process.exit(1); };
const listAll = (d, b = '') => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listAll(join(d, e.name), `${b}${e.name}/`) : [`${b}${e.name}`]));
const snap = () => Object.fromEntries(listAll(box).filter((p) => p.endsWith('.html') && !/^(content|src-site|scripts)\//.test(p)).map((p) => [p, readFileSync(join(box, p), 'utf8')]));

run('src-site/build.mjs');
const first = snap();
run('src-site/build.mjs');
const second = snap();
const diff = Object.keys({ ...first, ...second }).filter((k) => first[k] !== second[k]);
if (diff.length) fail(`2回ビルドで差分 ${diff.slice(0, 3)}`);
if (Object.keys(first).length < 30) fail(`ページ数が少ない ${Object.keys(first).length}`);
console.log(`ok: 2回ビルドで差分0 (${Object.keys(first).length}ページ)`);

const dataFile = join(box, 'scripts/athome-details.json');
const data = JSON.parse(readFileSync(dataFile, 'utf8'));
const usable = data.filter((d) => d.ok !== false);
const idOf = (d) => d.url.match(/\/(\d+)\/?$/)[1];
const target = idOf(usable[0]);
const goneId = idOf(usable[1]);
usable[0].spec['価格'] = '7,777万円';
writeFileSync(dataFile, JSON.stringify(data.filter((d) => idOf(d) !== goneId), null, 2));
const listFile = join(box, 'scripts/athome-listings.json');
const list = JSON.parse(readFileSync(listFile, 'utf8'));
list.listings = list.listings.filter((l) => String(l.athome_id) !== goneId);
writeFileSync(listFile, JSON.stringify(list, null, 2));
run('scripts/build-bukken.js');
// 成約は生成器が消さない(CLAUDE.md の手順どおり手で消す)
rmSync(join(box, 'content/bukken', goneId), { recursive: true });
run('src-site/build.mjs');
const detail = readFileSync(join(box, 'bukken', target, 'index.html'), 'utf8');
const listing = readFileSync(join(box, 'bukken/index.html'), 'utf8');
if (!detail.includes('7,777万円')) fail('価格変更が新デザインの詳細に載らない');
if (!listing.includes('7,777万円')) fail('価格変更が新デザインの一覧に載らない');
if (!detail.includes('/a/inner.css')) fail('詳細が新デザインでない');
if (existsSync(join(box, 'bukken', goneId))) fail('消した物件の個別ページが残っている');
if (listing.includes(`/bukken/${goneId}/`)) fail('消した物件が一覧に残っている');
console.log(`ok: 価格変更(${target})と物件削除(${goneId})が新デザインへ反映された`);
rmSync(box, { recursive: true, force: true });

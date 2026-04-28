// 明治不動産 properties-data.js のスキーマ検証スクリプト。
// 直接 admin.html を経由せずに repo へ push された場合の最後の砦。
//
// 使い方:
//   node scripts/validate-properties.mjs            # repo ルートから
//   node scripts/validate-properties.mjs path/to/properties-data.js
// 失敗時 exit 1。

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const target = path.resolve(
  process.cwd(),
  process.argv[2] || "properties-data.js",
);

if (!fs.existsSync(target)) {
  console.error(`ERROR: ${target} が見つかりません`);
  process.exit(1);
}

const src = fs.readFileSync(target, "utf8");

// window グローバルだけ shim して script を sandbox 内で実行。
const sandbox = { window: {} };
vm.createContext(sandbox);
try {
  vm.runInContext(src, sandbox, { filename: path.basename(target) });
} catch (e) {
  console.error(`ERROR: ${target} の評価に失敗: ${e.message}`);
  process.exit(1);
}

const cfg = sandbox.window.propConfig;
if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
  console.error("ERROR: window.propConfig が object map ではありません");
  process.exit(1);
}

const errors = [];
const warn = [];

const REQUIRED_TOP = [
  "id",
  "active",
  "cardType",
  "cardBadge",
  "cardEmoji",
  "cardBg",
  "name",
  "price",
  "unit",
  "loc",
  "fullLoc",
  "specs",
  "access",
  "mapUrl",
  "overview",
  "environment",
  "facilities",
  "photos",
];

const REQUIRED_ACCESS = ["train", "bus", "car"];
const ALLOWED_CARD_TYPES = new Set(["buy", "rent"]);

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

for (const [key, p] of Object.entries(cfg)) {
  const here = (msg) => errors.push(`[${key}] ${msg}`);

  if (typeof p !== "object" || p === null) {
    here("entry is not an object");
    continue;
  }

  for (const f of REQUIRED_TOP) {
    if (!(f in p)) here(`missing field "${f}"`);
  }

  if (p.id !== key) here(`id "${p.id}" does not match key "${key}"`);
  if (typeof p.active !== "boolean") here(`active must be boolean (got ${typeof p.active})`);
  if (!ALLOWED_CARD_TYPES.has(p.cardType)) {
    here(`cardType must be one of ${[...ALLOWED_CARD_TYPES].join(",")}, got "${p.cardType}"`);
  }
  for (const sf of ["cardBadge", "cardEmoji", "cardBg", "name", "price", "unit", "loc", "fullLoc"]) {
    if (sf in p && !isNonEmptyString(p[sf])) here(`${sf} must be non-empty string`);
  }

  if (p.athomeUrl !== undefined && !isNonEmptyString(p.athomeUrl)) {
    here("athomeUrl, if present, must be non-empty string");
  }

  if (!Array.isArray(p.specs)) here("specs must be array");
  else if (p.specs.length === 0) warn.push(`[${key}] specs is empty`);
  else if (!p.specs.every(isNonEmptyString)) here("specs must be array of non-empty strings");

  if (typeof p.access !== "object" || p.access === null) here("access must be object");
  else for (const af of REQUIRED_ACCESS) {
    if (!isNonEmptyString(p.access[af])) here(`access.${af} must be non-empty string`);
  }

  if (!isNonEmptyString(p.mapUrl)) here("mapUrl must be non-empty string");
  if (!isNonEmptyString(p.overview)) here("overview must be non-empty string");
  if (!isNonEmptyString(p.environment)) here("environment must be non-empty string");

  if (!Array.isArray(p.facilities)) here("facilities must be array");
  else p.facilities.forEach((fac, i) => {
    if (typeof fac !== "object" || fac === null) {
      here(`facilities[${i}] must be object`);
      return;
    }
    for (const ff of ["icon", "name", "dist"]) {
      if (!isNonEmptyString(fac[ff])) here(`facilities[${i}].${ff} must be non-empty string`);
    }
  });

  if (!Array.isArray(p.photos)) here("photos must be array");
  else p.photos.forEach((ph, i) => {
    if (typeof ph !== "object" || ph === null) {
      here(`photos[${i}] must be object`);
      return;
    }
    if (!("url" in ph) || typeof ph.url !== "string") here(`photos[${i}].url must be string (空文字可)`);
    if (!("cap" in ph) || typeof ph.cap !== "string") here(`photos[${i}].cap must be string (空文字可)`);
  });
}

const total = Object.keys(cfg).length;
const active = Object.values(cfg).filter((p) => p?.active === true).length;

if (errors.length) {
  console.error(`\n❌ ${errors.length} error(s) in ${total} propert${total === 1 ? "y" : "ies"}:`);
  for (const e of errors) console.error(`  - ${e}`);
  if (warn.length) {
    console.error(`\n⚠  ${warn.length} warning(s):`);
    for (const w of warn) console.error(`  - ${w}`);
  }
  process.exit(1);
}

if (warn.length) {
  console.warn(`⚠  ${warn.length} warning(s):`);
  for (const w of warn) console.warn(`  - ${w}`);
}

console.log(`✅ ${total} properties validated (${active} active, ${total - active} inactive)`);

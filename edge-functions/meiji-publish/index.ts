import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const REPO_OWNER = "MTO-64";
const REPO_NAME = "meiji-fudosan";
const ALLOWED_FILES = new Set(["properties-data.js"]);
const MAX_CONTENT_BYTES = 2_000_000; // 2 MB safety cap

const RATE_LIMIT_WINDOW_SEC = 600; // 10 分
const RATE_LIMIT_MAX_FAILURES = 5;
const RATE_LIMIT_LOCKOUT_SEC = 1800; // 失敗超過後 30 分は弾く

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
const JSON_HEADERS = { ...CORS, "Content-Type": "application/json" };

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const LOG_TABLE = "meiji_publish_log";

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function clientIp(req: Request): string {
  // Supabase Edge Functions は Cloudflare の背後で動作する。
  // cf-connecting-ip は Cloudflare が必ず上書きする真のクライアントIPで、
  // クライアントからは偽装できない。x-forwarded-for は CF が再構築するが
  // クライアント送信値が混入するため、レート制限のキーには使わない。
  const cf = (req.headers.get("cf-connecting-ip") || "").trim();
  return cf || "unknown";
}

function logUrl(): string {
  return `${SUPABASE_URL}/rest/v1/${LOG_TABLE}`;
}

function logHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function recordAttempt(row: {
  ip: string;
  filename: string;
  ok: boolean;
  reason: string;
  bytes: number | null;
  sha_before: string | null;
  sha_after: string | null;
}): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  try {
    await fetch(logUrl(), {
      method: "POST",
      headers: logHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(row),
    });
  } catch (e) {
    console.error("meiji-publish: log insert failed", e);
  }
}

async function recentFailureCount(ip: string): Promise<number> {
  if (!SUPABASE_URL || !SERVICE_KEY || !ip || ip === "unknown") return 0;
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_SEC * 1000)
    .toISOString();
  // rate_limited / locked_out はメタ的なログ行なので失敗カウントから除外。
  // これを含めると、一度ロックがかかった後に毎回カウントが増殖する。
  // 値は ASCII 固定リテラル (rate_limited, locked_out) なので URL エンコード不要 ——
  // PostgREST の `not.in.(...)` 構文をリテラルで書く。
  const url =
    `${logUrl()}?select=id&ip=eq.${encodeURIComponent(ip)}` +
    `&ok=eq.false&reason=not.in.(rate_limited,locked_out)` +
    `&created_at=gte.${encodeURIComponent(since)}`;
  try {
    const r = await fetch(url, {
      headers: logHeaders({ Prefer: "count=exact" }),
    });
    if (!r.ok) return 0;
    const cr = r.headers.get("content-range") || "";
    const m = cr.match(/\/(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  } catch (e) {
    console.error("meiji-publish: rate-limit query failed", e);
    return 0;
  }
}

async function isLockedOut(ip: string): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_KEY || !ip || ip === "unknown") return false;
  const since = new Date(Date.now() - RATE_LIMIT_LOCKOUT_SEC * 1000)
    .toISOString();
  const url =
    `${logUrl()}?select=id&ip=eq.${encodeURIComponent(ip)}` +
    `&reason=eq.rate_limited&created_at=gte.${encodeURIComponent(since)}` +
    `&limit=1`;
  try {
    const r = await fetch(url, { headers: logHeaders() });
    if (!r.ok) return false;
    const arr = await r.json();
    return Array.isArray(arr) && arr.length > 0;
  } catch {
    return false;
  }
}

function validateJsSyntax(src: string): { ok: true } | { ok: false; msg: string } {
  // 構文だけチェック。new Function はコンパイルのみで実行はしない。
  try {
    // deno-lint-ignore no-new-func
    new Function(src);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, msg };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method not allowed" });
  }

  const ip = clientIp(req);

  // Cloudflare 経由なら必ず cf-connecting-ip が付与される。"unknown" は到達経路が
  // 異常 = レート制限のキーが取れない状態なので、フェイルオープンを避けて拒否する。
  if (ip === "unknown") {
    await recordAttempt({
      ip,
      filename: "",
      ok: false,
      reason: "no_client_ip",
      bytes: null,
      sha_before: null,
      sha_after: null,
    });
    return jsonResponse(400, {
      error: "リクエスト送信元が確認できませんでした。",
    });
  }

  // 直近30分でレート制限を踏んだIPはまずブロック
  if (await isLockedOut(ip)) {
    await recordAttempt({
      ip,
      filename: "",
      ok: false,
      reason: "locked_out",
      bytes: null,
      sha_before: null,
      sha_after: null,
    });
    return jsonResponse(429, {
      error:
        "短時間に失敗が多すぎたため一時的にロックされました。30分後にもう一度お試しください。",
    });
  }

  let body: { password?: string; content?: string; filename?: string };
  try {
    body = await req.json();
  } catch {
    await recordAttempt({
      ip,
      filename: "",
      ok: false,
      reason: "invalid_json",
      bytes: null,
      sha_before: null,
      sha_after: null,
    });
    return jsonResponse(400, { error: "invalid JSON body" });
  }

  const password = typeof body.password === "string" ? body.password : "";
  const content = typeof body.content === "string" ? body.content : "";
  const filename =
    typeof body.filename === "string" && body.filename.length > 0
      ? body.filename
      : "properties-data.js";

  if (!ALLOWED_FILES.has(filename)) {
    await recordAttempt({
      ip,
      filename,
      ok: false,
      reason: "filename_not_allowed",
      bytes: null,
      sha_before: null,
      sha_after: null,
    });
    return jsonResponse(400, { error: `filename not allowed: ${filename}` });
  }
  if (!password || !content) {
    await recordAttempt({
      ip,
      filename,
      ok: false,
      reason: "missing_field",
      bytes: null,
      sha_before: null,
      sha_after: null,
    });
    return jsonResponse(400, { error: "password and content required" });
  }
  const contentBytes = new TextEncoder().encode(content);
  if (contentBytes.byteLength > MAX_CONTENT_BYTES) {
    await recordAttempt({
      ip,
      filename,
      ok: false,
      reason: "too_large",
      bytes: contentBytes.byteLength,
      sha_before: null,
      sha_after: null,
    });
    return jsonResponse(413, {
      error:
        `content too large (${contentBytes.byteLength} > ${MAX_CONTENT_BYTES})`,
    });
  }

  // JS構文検証 — 一文字壊れた properties-data.js でサイト全壊するのを防ぐ
  const syntax = validateJsSyntax(content);
  if (!syntax.ok) {
    await recordAttempt({
      ip,
      filename,
      ok: false,
      reason: "js_syntax_error",
      bytes: contentBytes.byteLength,
      sha_before: null,
      sha_after: null,
    });
    return jsonResponse(400, {
      error: `JavaScript構文エラー: ${syntax.msg}`,
    });
  }

  const expectedHash = (Deno.env.get("MEIJI_PUBLISH_PW_HASH") || "")
    .trim()
    .toLowerCase();
  const ghToken = (Deno.env.get("MEIJI_GITHUB_TOKEN") || "").trim();
  if (!expectedHash || !ghToken) {
    await recordAttempt({
      ip,
      filename,
      ok: false,
      reason: "server_misconfigured",
      bytes: contentBytes.byteLength,
      sha_before: null,
      sha_after: null,
    });
    return jsonResponse(500, {
      error:
        "server misconfigured: MEIJI_PUBLISH_PW_HASH または MEIJI_GITHUB_TOKEN が未設定",
    });
  }

  const actualHash = await sha256Hex(password);
  if (!constantTimeEqualHex(actualHash, expectedHash)) {
    // 失敗を記録してから、直近の失敗回数を見てレート制限発動を判定
    await recordAttempt({
      ip,
      filename,
      ok: false,
      reason: "auth_failed",
      bytes: contentBytes.byteLength,
      sha_before: null,
      sha_after: null,
    });
    const fails = await recentFailureCount(ip);
    if (fails >= RATE_LIMIT_MAX_FAILURES) {
      await recordAttempt({
        ip,
        filename,
        ok: false,
        reason: "rate_limited",
        bytes: null,
        sha_before: null,
        sha_after: null,
      });
      return jsonResponse(429, {
        error:
          "失敗回数が上限を超えました。30分間ロックします。時間をおいて再試行してください。",
      });
    }
    return jsonResponse(401, { error: "認証に失敗しました" });
  }

  const apiUrl =
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filename}`;
  const ghHeaders: Record<string, string> = {
    Authorization: `token ${ghToken}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "meiji-publish-edge-function",
  };

  let sha: string | undefined;
  const existing = await fetch(apiUrl, { headers: ghHeaders });
  if (existing.ok) {
    const j = await existing.json();
    sha = typeof j.sha === "string" ? j.sha : undefined;
  } else if (existing.status !== 404) {
    const text = await existing.text();
    console.error(
      `meiji-publish: GitHub GET failed status=${existing.status} body=${text.slice(0, 500)}`,
    );
    await recordAttempt({
      ip,
      filename,
      ok: false,
      reason: `github_get_${existing.status}`,
      bytes: contentBytes.byteLength,
      sha_before: null,
      sha_after: null,
    });
    return jsonResponse(502, {
      error:
        `GitHubからのファイル取得に失敗しました (status ${existing.status})。管理者に連絡してください。`,
    });
  }

  const encoded = bytesToBase64(contentBytes);
  const date = new Date().toISOString().slice(0, 10);
  const putBody: { message: string; content: string; sha?: string } = {
    message: `${filename} 更新 ${date} (admin panel)`,
    content: encoded,
  };
  if (sha) putBody.sha = sha;

  const put = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...ghHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(putBody),
  });

  if (!put.ok) {
    const text = await put.text();
    console.error(
      `meiji-publish: GitHub PUT failed status=${put.status} body=${text.slice(0, 500)}`,
    );
    await recordAttempt({
      ip,
      filename,
      ok: false,
      reason: `github_put_${put.status}`,
      bytes: contentBytes.byteLength,
      sha_before: sha ?? null,
      sha_after: null,
    });
    return jsonResponse(502, {
      error:
        `GitHubへの保存に失敗しました (status ${put.status})。管理者に連絡してください。`,
    });
  }

  // 成功 — 新しい blob SHA を取得して監査ログに残す
  let newSha: string | null = null;
  try {
    const putJson = await put.json();
    newSha = putJson?.content?.sha ?? null;
  } catch {
    // ignore body parse failure — commit はもう成功している
  }

  await recordAttempt({
    ip,
    filename,
    ok: true,
    reason: "ok",
    bytes: contentBytes.byteLength,
    sha_before: sha ?? null,
    sha_after: newSha,
  });

  return jsonResponse(200, {
    success: true,
    message: "GitHubに反映しました。1〜2分でサイトに表示されます。",
  });
});

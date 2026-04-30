import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const REPO_OWNER = "MTO-64";
const REPO_NAME = "meiji-fudosan";
const ALLOWED_FILES = new Set(["properties-data.js"]);
const MAX_CONTENT_BYTES = 2_000_000; // 2 MB safety cap

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

function clientIp(req: Request): string {
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

  let body: { content?: string; filename?: string };
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
  if (!content) {
    await recordAttempt({
      ip,
      filename,
      ok: false,
      reason: "missing_field",
      bytes: null,
      sha_before: null,
      sha_after: null,
    });
    return jsonResponse(400, { error: "content required" });
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

  const ghToken = (Deno.env.get("MEIJI_GITHUB_TOKEN") || "").trim();
  if (!ghToken) {
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
      error: "server misconfigured: MEIJI_GITHUB_TOKEN が未設定",
    });
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

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method not allowed" });
  }

  let body: { password?: string; content?: string; filename?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid JSON body" });
  }

  const password = typeof body.password === "string" ? body.password : "";
  const content = typeof body.content === "string" ? body.content : "";
  const filename =
    typeof body.filename === "string" && body.filename.length > 0
      ? body.filename
      : "properties-data.js";

  if (!ALLOWED_FILES.has(filename)) {
    return jsonResponse(400, { error: `filename not allowed: ${filename}` });
  }
  if (!password || !content) {
    return jsonResponse(400, { error: "password and content required" });
  }
  const contentBytes = new TextEncoder().encode(content);
  if (contentBytes.byteLength > MAX_CONTENT_BYTES) {
    return jsonResponse(413, {
      error: `content too large (${contentBytes.byteLength} > ${MAX_CONTENT_BYTES})`,
    });
  }

  const expectedHash = (Deno.env.get("MEIJI_PUBLISH_PW_HASH") || "")
    .trim()
    .toLowerCase();
  const ghToken = (Deno.env.get("MEIJI_GITHUB_TOKEN") || "").trim();
  if (!expectedHash || !ghToken) {
    return jsonResponse(500, {
      error:
        "server misconfigured: MEIJI_PUBLISH_PW_HASH または MEIJI_GITHUB_TOKEN が未設定",
    });
  }

  const actualHash = await sha256Hex(password);
  if (!constantTimeEqualHex(actualHash, expectedHash)) {
    return jsonResponse(401, { error: "認証に失敗しました" });
  }

  const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filename}`;
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
    return jsonResponse(502, {
      error: `GitHubからのファイル取得に失敗しました (status ${existing.status})。管理者に連絡してください。`,
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
    return jsonResponse(502, {
      error: `GitHubへの保存に失敗しました (status ${put.status})。管理者に連絡してください。`,
    });
  }

  return jsonResponse(200, {
    success: true,
    message: "GitHubに反映しました。1〜2分でサイトに表示されます。",
  });
});

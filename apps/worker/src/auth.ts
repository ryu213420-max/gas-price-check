import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import type { Env } from "./prices";

const STATE_COOKIE = "gpc_oauth_state";
export const SESSION_COOKIE = "gpc_session";

function publicOrigin(c: Context<{ Bindings: Env }>): string {
  return c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin;
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET);
}

/** GET /auth/google — Google の認可画面へリダイレクトする */
export async function startGoogleAuth(c: Context<{ Bindings: Env }>) {
  if (!googleConfigured(c.env)) {
    return c.json(
      { error: "google_oauth_not_configured", detail: "GOOGLE_CLIENT_ID 等のシークレットが未設定です" },
      503,
    );
  }
  const state = randomToken();
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
  });
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID as string,
    redirect_uri: `${publicOrigin(c)}/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

interface GoogleTokenResponse {
  id_token?: string;
  access_token?: string;
  error?: string;
}

/** GET /auth/google/callback — コード交換、ユーザー保存、セッション発行 */
export async function googleCallback(c: Context<{ Bindings: Env }>) {
  if (!googleConfigured(c.env)) {
    return c.json({ error: "google_oauth_not_configured" }, 503);
  }
  const code = c.req.query("code");
  const state = c.req.query("state");
  const expectedState = getCookie(c, STATE_COOKIE);
  if (!code || !state || state !== expectedState) {
    return c.json({ error: "invalid_oauth_state" }, 400);
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID as string,
      client_secret: c.env.GOOGLE_CLIENT_SECRET as string,
      redirect_uri: `${publicOrigin(c)}/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  const token = (await tokenRes.json()) as GoogleTokenResponse;
  if (!tokenRes.ok || !token.access_token) {
    return c.json({ error: "token_exchange_failed" }, 502);
  }

  const userRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!userRes.ok) {
    return c.json({ error: "userinfo_failed" }, 502);
  }
  const user = (await userRes.json()) as { sub: string; email?: string; name?: string };

  await c.env.DB.prepare(
    `INSERT INTO users (id, email, name) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name`,
  )
    .bind(user.sub, user.email ?? null, user.name ?? null)
    .run();

  // セッションは KV に保存し、ID のみを Cookie に入れる
  const sessionId = randomToken();
  await c.env.CACHE.put(`session:${sessionId}`, user.sub, { expirationTtl: 60 * 60 * 24 * 30 });
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return c.redirect("/");
}

/** セッション Cookie からユーザー ID を引く。未ログインなら null */
export async function currentUserId(c: Context<{ Bindings: Env }>): Promise<string | null> {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (!sessionId) return null;
  return c.env.CACHE.get(`session:${sessionId}`);
}

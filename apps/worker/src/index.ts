import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  SESSION_COOKIE,
  currentUserId,
  googleCallback,
  startGoogleAuth,
} from "./auth";
import {
  type Env,
  readPricesFromDb,
  refreshAreaPrices,
} from "./prices";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

/**
 * 緯度経度から市区町村コードを引く。
 * 逆ジオコーディングの提供元は未選定のため、現時点では未実装を明示して返す。
 * フロントエンドはこの応答を受けると空状態を表示する。
 */
app.get("/api/locate", (c) => {
  const lat = c.req.query("lat");
  const lng = c.req.query("lng");
  if (!lat || !lng) {
    return c.json({ error: "lat_lng_required" }, 400);
  }
  return c.json(
    {
      error: "area_resolution_not_implemented",
      detail: "逆ジオコーディングの接続先が未設定です",
    },
    501,
  );
});

/**
 * 市区町村コードで価格を返す。
 * KV キャッシュ → D1 の順に引き、D1 に無ければ取得処理を呼んでから返す。
 */
app.get("/api/prices", async (c) => {
  const areaCode = c.req.query("area");
  if (!areaCode) {
    return c.json({ error: "area_required" }, 400);
  }

  const cacheKey = `prices:${areaCode}`;
  const cached = await c.env.CACHE.get(cacheKey, "json");
  if (cached) {
    return c.json(cached);
  }

  let data = await readPricesFromDb(c.env, areaCode);
  if (data.stations.length === 0) {
    await refreshAreaPrices(c.env, areaCode);
    data = await readPricesFromDb(c.env, areaCode);
  }

  await c.env.CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: 3600 });
  return c.json(data);
});

/**
 * Workers AI で、価格データから事実だけの一言要約を作る。
 * AI が使えない場合は、同じ事実を定型文で返す。
 */
app.get("/api/summary", async (c) => {
  const areaCode = c.req.query("area");
  if (!areaCode) {
    return c.json({ error: "area_required" }, 400);
  }
  const data = await readPricesFromDb(c.env, areaCode);
  const withRegular = data.stations.filter((s) => s.fuels.regular);
  if (withRegular.length === 0 || data.averageRegular === null) {
    return c.json({ summary: null });
  }
  const cheapest = withRegular.reduce((a, b) =>
    (a.fuels.regular?.price ?? Infinity) <= (b.fuels.regular?.price ?? Infinity) ? a : b,
  );
  const cheapestPrice = cheapest.fuels.regular?.price as number;
  const diff = Math.round((data.averageRegular - cheapestPrice) * 10) / 10;
  const facts = `${data.areaName}のレギュラー最安値は${cheapest.name}の${cheapestPrice}円/L（${cheapest.fuels.regular?.confirmedDate}確認）。地域平均は${data.averageRegular}円/Lで、最安値は平均より${diff}円安い。`;

  try {
    const ai = (await c.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content:
            "渡された事実だけを使って、日本語で一文だけに要約してください。新しい情報や宣伝文句は加えないでください。",
        },
        { role: "user", content: facts },
      ],
      max_tokens: 120,
    })) as { response?: string };
    if (ai.response) {
      return c.json({ summary: ai.response.trim(), ai: true });
    }
  } catch {
    // Workers AI が未有効化の場合は定型文にフォールバックする
  }
  return c.json({ summary: facts, ai: false });
});

/** お気に入り一覧（要ログイン） */
app.get("/api/favorites", async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: "login_required" }, 401);
  const rows = await c.env.DB.prepare(
    "SELECT station_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(userId)
    .all<{ station_id: string }>();
  return c.json({ stationIds: rows.results.map((r) => r.station_id) });
});

/** お気に入り追加（要ログイン） */
app.post("/api/favorites", async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: "login_required" }, 401);
  const body = (await c.req.json().catch(() => null)) as { stationId?: string } | null;
  if (!body?.stationId) return c.json({ error: "station_id_required" }, 400);
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO favorites (user_id, station_id) VALUES (?, ?)",
  )
    .bind(userId, body.stationId)
    .run();
  return c.json({ ok: true });
});

/** ログアウト（セッション破棄） */
app.post("/auth/logout", async (c) => {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (sessionId) {
    await c.env.CACHE.delete(`session:${sessionId}`);
  }
  return c.json({ ok: true });
});

app.get("/auth/google", startGoogleAuth);
app.get("/auth/google/callback", googleCallback);

/** Cron: 既知の全市区町村の価格を取り直す */
async function refreshAllAreas(env: Env): Promise<void> {
  const areas = await env.DB.prepare("SELECT DISTINCT area_code FROM stations").all<{
    area_code: string;
  }>();
  for (const row of areas.results) {
    await refreshAreaPrices(env, row.area_code);
  }
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(refreshAllAreas(env));
  },
};

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  AI: Ai;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  /** デプロイ先の公開オリジン (例: https://gas-price-check.example.workers.dev) */
  PUBLIC_ORIGIN?: string;
}

export type FuelType = "regular" | "highOctane" | "diesel" | "kerosene";
export const FUELS: FuelType[] = ["regular", "highOctane", "diesel", "kerosene"];

export interface FuelPrice {
  price: number;
  priceType: "cash" | "member";
  confirmedDate: string;
}

export interface StationPrices {
  id: string;
  name: string;
  brand: string | null;
  address: string;
  distanceKm: number | null;
  fuels: Record<FuelType, FuelPrice | null>;
}

export interface PricesResponse {
  areaCode: string;
  areaName: string;
  averageRegular: number | null;
  fetchedAt: string;
  stations: StationPrices[];
}

interface StationRow {
  id: string;
  name: string;
  brand: string | null;
  address: string;
  area_name: string;
}

interface PriceRow {
  station_id: string;
  fuel: FuelType;
  price: number;
  price_type: "cash" | "member";
  confirmed_date: string;
}

const emptyFuels = (): Record<FuelType, FuelPrice | null> => ({
  regular: null,
  highOctane: null,
  diesel: null,
  kerosene: null,
});

/** D1 から、その市区町村の最新価格を組み立てて返す */
export async function readPricesFromDb(env: Env, areaCode: string): Promise<PricesResponse> {
  const stations = await env.DB.prepare(
    "SELECT id, name, brand, address, area_name FROM stations WHERE area_code = ?",
  )
    .bind(areaCode)
    .all<StationRow>();

  const result: StationPrices[] = stations.results.map((s) => ({
    id: s.id,
    name: s.name,
    brand: s.brand,
    address: s.address,
    distanceKm: null,
    fuels: emptyFuels(),
  }));
  const byId = new Map(result.map((s) => [s.id, s]));

  if (result.length > 0) {
    // 各スタンド・油種について最新の確認日の価格だけを採用する
    const prices = await env.DB.prepare(
      `SELECT p.station_id, p.fuel, p.price, p.price_type, p.confirmed_date
       FROM price_snapshots p
       JOIN stations s ON s.id = p.station_id
       WHERE s.area_code = ?
         AND p.confirmed_date = (
           SELECT MAX(confirmed_date) FROM price_snapshots
           WHERE station_id = p.station_id AND fuel = p.fuel
         )`,
    )
      .bind(areaCode)
      .all<PriceRow>();

    for (const row of prices.results) {
      const station = byId.get(row.station_id);
      if (station) {
        station.fuels[row.fuel] = {
          price: row.price,
          priceType: row.price_type,
          confirmedDate: row.confirmed_date,
        };
      }
    }
  }

  const regularPrices = result
    .map((s) => s.fuels.regular?.price)
    .filter((p): p is number => typeof p === "number");
  const averageRegular =
    regularPrices.length > 0
      ? Math.round((regularPrices.reduce((a, b) => a + b, 0) / regularPrices.length) * 10) / 10
      : null;

  return {
    areaCode,
    areaName: stations.results[0]?.area_name ?? "",
    averageRegular,
    fetchedAt: new Date().toISOString(),
    stations: result,
  };
}

export interface SourceStationPrice {
  station: {
    id: string;
    name: string;
    brand: string | null;
    address: string;
    areaName: string;
    lat: number | null;
    lng: number | null;
  };
  prices: Array<{
    fuel: FuelType;
    price: number;
    priceType: "cash" | "member";
    confirmedDate: string;
  }>;
}

/**
 * 価格データ源から1市区町村分の価格を取得する。
 *
 * 出所は gogo.gs の投稿価格だが、公式 API は提供されていない。
 * そのため取得方法はここに分離し、差し替え可能にしてある。
 * 未実装の間は空配列を返し、画面側は「データなし」の空状態になる
 * （モックデータを実データらしく見せることはしない）。
 */
export async function fetchAreaPricesFromSource(
  _env: Env,
  _areaCode: string,
): Promise<SourceStationPrice[]> {
  // TODO: gogo.gs の該当市区町村ページから投稿価格を読み取り、
  // SourceStationPrice[] に変換して返す実装をここに入れる。
  return [];
}

/** 取得した価格を D1 に保存する */
export async function refreshAreaPrices(env: Env, areaCode: string): Promise<number> {
  const items = await fetchAreaPricesFromSource(env, areaCode);
  let saved = 0;
  for (const item of items) {
    await env.DB.prepare(
      `INSERT INTO stations (id, name, brand, address, area_code, area_name, lat, lng)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, brand = excluded.brand, address = excluded.address,
         area_code = excluded.area_code, area_name = excluded.area_name`,
    )
      .bind(
        item.station.id,
        item.station.name,
        item.station.brand,
        item.station.address,
        areaCode,
        item.station.areaName,
        item.station.lat,
        item.station.lng,
      )
      .run();
    for (const p of item.prices) {
      await env.DB.prepare(
        `INSERT INTO price_snapshots (station_id, fuel, price, price_type, confirmed_date)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(item.station.id, p.fuel, p.price, p.priceType, p.confirmedDate)
        .run();
      saved++;
    }
  }
  if (saved > 0) {
    await env.CACHE.delete(`prices:${areaCode}`);
  }
  return saved;
}

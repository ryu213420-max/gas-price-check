-- ガソスタ価格チェック D1 スキーマ
-- 適用: wrangler d1 execute gas-price-check --file apps/worker/schema.sql

CREATE TABLE IF NOT EXISTS stations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  address TEXT NOT NULL,
  -- 全国地方公共団体コード（市区町村コード）
  area_code TEXT NOT NULL,
  area_name TEXT NOT NULL,
  lat REAL,
  lng REAL
);
CREATE INDEX IF NOT EXISTS idx_stations_area ON stations (area_code);

CREATE TABLE IF NOT EXISTS price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id TEXT NOT NULL REFERENCES stations (id),
  -- regular / highOctane / diesel / kerosene
  fuel TEXT NOT NULL,
  -- 円。kerosene のみ 18L あたり、それ以外は 1L あたり
  price INTEGER NOT NULL,
  price_type TEXT NOT NULL DEFAULT 'cash', -- cash / member
  source TEXT NOT NULL DEFAULT 'gogo.gs',
  -- 価格が確認された日 (YYYY-MM-DD)
  confirmed_date TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prices_station_fuel
  ON price_snapshots (station_id, fuel, confirmed_date DESC);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, -- Google の sub
  email TEXT,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES users (id),
  station_id TEXT NOT NULL REFERENCES stations (id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, station_id)
);

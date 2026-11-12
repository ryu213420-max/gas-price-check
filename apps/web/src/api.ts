import type { PricesResponse } from "./types";

/**
 * 現在地から市区町村コードを特定する。
 * 逆ジオコーディングは Worker 側の /api/locate に集約する想定で、
 * 未実装・失敗時は例外を投げ、画面側は空状態を表示する。
 */
export async function locateAreaCode(): Promise<{ areaCode: string; areaName: string }> {
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 300000,
    });
  });

  const res = await fetch(
    `/api/locate?lat=${position.coords.latitude}&lng=${position.coords.longitude}`,
  );
  if (!res.ok) {
    throw new Error(`locate failed: ${res.status}`);
  }
  return (await res.json()) as { areaCode: string; areaName: string };
}

/** 指定した市区町村の最新価格を取得する */
export async function fetchPrices(areaCode: string): Promise<PricesResponse> {
  const res = await fetch(`/api/prices?area=${encodeURIComponent(areaCode)}`);
  if (!res.ok) {
    throw new Error(`prices failed: ${res.status}`);
  }
  return (await res.json()) as PricesResponse;
}

const CACHE_PREFIX = "gas-price-check:prices:";

/**
 * 前回表示した価格を端末に残しておき、開いた瞬間に即表示するために使う。
 * これは実データのキャッシュであり、モックデータではない。
 */
export function readCachedPrices(areaCode: string): PricesResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + areaCode);
    return raw ? (JSON.parse(raw) as PricesResponse) : null;
  } catch {
    return null;
  }
}

export function writeCachedPrices(data: PricesResponse): void {
  try {
    localStorage.setItem(CACHE_PREFIX + data.areaCode, JSON.stringify(data));
  } catch {
    // 保存できなくても表示は継続する
  }
}

export function readLastAreaCode(): string | null {
  try {
    return localStorage.getItem("gas-price-check:last-area");
  } catch {
    return null;
  }
}

export function writeLastAreaCode(areaCode: string): void {
  try {
    localStorage.setItem("gas-price-check:last-area", areaCode);
  } catch {
    // noop
  }
}

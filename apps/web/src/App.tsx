import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchPrices,
  locateAreaCode,
  readCachedPrices,
  readLastAreaCode,
  writeCachedPrices,
  writeLastAreaCode,
} from "./api";
import { FUEL_LABELS, FUEL_UNITS, type FuelType, type PricesResponse, type Station } from "./types";

const FUELS: FuelType[] = ["regular", "highOctane", "diesel", "kerosene"];

/** 価格の数字をカウントアップ表示するためのフック */
function useCountUp(target: number | null, durationMs = 650): number | null {
  const [value, setValue] = useState<number | null>(target);
  const fromRef = useRef<number>(target ?? 0);

  useEffect(() => {
    if (target === null) {
      setValue(null);
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (target - from) * eased;
      setValue(current);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}

function priceOf(station: Station, fuel: FuelType): number | null {
  return station.fuels[fuel]?.price ?? null;
}

function SkeletonScreen() {
  return (
    <div className="screen skeleton-screen" aria-label="読み込み中">
      <div className="sk sk-area shimmer" />
      <div className="sk sk-hero shimmer" />
      <div className="sk sk-tabs shimmer" />
      <div className="sk sk-row shimmer" />
      <div className="sk sk-row shimmer" />
      <div className="sk sk-row shimmer" />
      <div className="sk sk-row shimmer" />
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<PricesResponse | null>(null);
  const [fuel, setFuel] = useState<FuelType>("regular");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const load = async (showSkeleton: boolean) => {
    if (showSkeleton) setLoading(true);
    else setRefreshing(true);
    setFailed(false);
    try {
      const { areaCode } = await locateAreaCode();
      writeLastAreaCode(areaCode);
      const fresh = await fetchPrices(areaCode);
      setData(fresh);
      writeCachedPrices(fresh);
      fetchSummary(areaCode);
    } catch {
      // 位置情報が取れない・API 未接続の場合は、キャッシュが無ければ空状態にする
      if (!data) setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchSummary = async (areaCode: string) => {
    try {
      const res = await fetch(`/api/summary?area=${encodeURIComponent(areaCode)}`);
      if (!res.ok) return;
      const json = (await res.json()) as { summary?: string };
      if (json.summary) setSummary(json.summary);
    } catch {
      // 要約は補助情報なので失敗しても表示しない
    }
  };

  useEffect(() => {
    // 開いた瞬間: 前回の地域のキャッシュがあれば即表示し、裏で最新を取り直す
    const lastArea = readLastAreaCode();
    const cached = lastArea ? readCachedPrices(lastArea) : null;
    if (cached) {
      setData(cached);
      setLoading(false);
      void load(false);
    } else {
      void load(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = useMemo(() => {
    if (!data) return [];
    return [...data.stations]
      .filter((s) => priceOf(s, fuel) !== null)
      .sort((a, b) => (priceOf(a, fuel) ?? Infinity) - (priceOf(b, fuel) ?? Infinity));
  }, [data, fuel]);

  const cheapest = sorted[0] ?? null;
  const cheapestPrice = cheapest ? priceOf(cheapest, fuel) : null;
  const animatedPrice = useCountUp(cheapestPrice);

  if (loading && !data) {
    return <SkeletonScreen />;
  }

  return (
    <div className="screen">
      <header className="area-bar glass">
        <span className="area-name">{data?.areaName ?? "現在地"}</span>
        {data && (
          <span className="fetched-at">
            {new Date(data.fetchedAt).toLocaleTimeString("ja-JP", {
              hour: "2-digit",
              minute: "2-digit",
            })}
            時点{refreshing ? " / 更新中" : ""}
          </span>
        )}
      </header>

      {failed && !data ? (
        <section className="empty glass">
          <p>価格データを取得できませんでした</p>
          <p className="empty-sub">位置情報の許可と通信状態を確認してください</p>
          <button type="button" className="retry" onClick={() => void load(true)}>
            再試行
          </button>
        </section>
      ) : (
        <>
          <section className="hero glass" key={fuel}>
            {cheapest && animatedPrice !== null ? (
              <>
                <div className="hero-label">最安値 / {FUEL_LABELS[fuel]}</div>
                <div className="hero-price">
                  <span className="hero-price-num">{Math.round(animatedPrice).toLocaleString()}</span>
                  <span className="hero-price-unit">{FUEL_UNITS[fuel]}</span>
                </div>
                <div className="hero-station">{cheapest.name}</div>
                <div className="hero-meta">
                  {cheapest.fuels[fuel]?.confirmedDate} 確認
                  {fuel === "regular" && data?.averageRegular
                    ? ` / 地域平均 ${data.averageRegular}円`
                    : ""}
                  {fuel === "kerosene" && cheapestPrice
                    ? ` / 1Lあたり約${(cheapestPrice / 18).toFixed(1)}円`
                    : ""}
                </div>
                {summary && <p className="hero-summary">{summary}</p>}
              </>
            ) : (
              <p className="hero-none">この地域の{FUEL_LABELS[fuel]}価格データがありません</p>
            )}
          </section>

          <nav className="fuel-tabs glass" aria-label="油種">
            {FUELS.map((f) => (
              <button
                key={f}
                type="button"
                className={f === fuel ? "tab active" : "tab"}
                onClick={() => setFuel(f)}
              >
                {FUEL_LABELS[f]}
              </button>
            ))}
          </nav>
          {fuel === "kerosene" && <p className="unit-note">灯油は18Lあたりの価格です</p>}

          <ul className="station-list" key={`list-${fuel}`}>
            {sorted.map((s, i) => {
              const fp = s.fuels[fuel];
              if (!fp) return null;
              return (
                <li
                  key={s.id}
                  className="station glass"
                  style={{ animationDelay: `${i * 45}ms` }}
                >
                  <span className="station-date">{fp.confirmedDate.slice(5).replace("-", "/")}</span>
                  <span className="station-main">
                    <span className="station-name">{s.name}</span>
                    <span className="station-sub">
                      {fp.priceType === "member" ? "会員価格" : "現金価格"}
                      {s.distanceKm !== null ? ` / ${s.distanceKm.toFixed(1)}km` : ""}
                    </span>
                  </span>
                  <span className="station-price">
                    {fp.price.toLocaleString()}
                    <small>{FUEL_UNITS[fuel]}</small>
                  </span>
                </li>
              );
            })}
          </ul>

          <footer className="footer">
            <span>価格は gogo.gs の投稿価格です</span>
            <button type="button" className="refresh" onClick={() => void load(false)}>
              更新
            </button>
            <a className="login" href="/auth/google">
              Googleでログイン
            </a>
          </footer>
        </>
      )}
    </div>
  );
}

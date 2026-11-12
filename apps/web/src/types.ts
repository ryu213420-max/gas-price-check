export type FuelType = "regular" | "highOctane" | "diesel" | "kerosene";

export interface FuelPrice {
  /** 円。灯油のみ 18L あたり、それ以外は 1L あたり */
  price: number;
  priceType: "cash" | "member";
  /** 価格が確認された日 (YYYY-MM-DD) */
  confirmedDate: string;
}

export interface Station {
  id: string;
  name: string;
  brand: string | null;
  address: string;
  /** 現在地からの距離 km（算出できる場合のみ） */
  distanceKm: number | null;
  fuels: Record<FuelType, FuelPrice | null>;
}

export interface PricesResponse {
  areaCode: string;
  areaName: string;
  /** レギュラーの地域平均（1L あたり、円）。データが無い場合は null */
  averageRegular: number | null;
  /** このレスポンスの価格を取得した時刻 (ISO 8601) */
  fetchedAt: string;
  stations: Station[];
}

export const FUEL_LABELS: Record<FuelType, string> = {
  regular: "レギュラー",
  highOctane: "ハイオク",
  diesel: "軽油",
  kerosene: "灯油",
};

export const FUEL_UNITS: Record<FuelType, string> = {
  regular: "円/L",
  highOctane: "円/L",
  diesel: "円/L",
  kerosene: "円/18L",
};

import type { WeatherData } from '../types';

/**
 * 危険スコアの「ルール定義」を計算ロジックから分離したモジュール。
 * 閾値・加点・理由文言（＝ポリシー）はすべてここに集約し、
 * riskCalculator.ts は「どう評価するか」だけに専念させる。
 *
 * CLAUDE.md のスコアリング表と1対1で対応する。
 */

/** 危険スコアの上限（これ以上は加点しない）。 */
export const MAX_SCORE = 100;

/**
 * 数値指標の段階（しきい値ごとの加点と理由文言）。
 * `min` 以上で該当。配列は必ず高い順に並べること（最初に該当した段階を採用）。
 */
export interface ScoreTier {
	readonly min: number;
	readonly score: number;
	readonly reason: (value: number) => string;
}

/** 風速 km/h → 加点（細分4段階）。 */
export const WIND_TIERS: readonly ScoreTier[] = [
	{ min: 90, score: 30, reason: (v) => `猛烈な風 ${Math.round(v)}km/h` },
	{ min: 60, score: 20, reason: (v) => `暴風 ${Math.round(v)}km/h` },
	{ min: 40, score: 12, reason: (v) => `強風 ${Math.round(v)}km/h` },
	{ min: 20, score:  5, reason: (v) => `やや強い風 ${Math.round(v)}km/h` }
];

/** 降水量 mm/h → 加点（WMO警報と独立した雨量スコア）。 */
export const PRECIPITATION_TIERS: readonly ScoreTier[] = [
	{ min: 50, score: 35, reason: (v) => `猛烈な雨 ${v.toFixed(0)}mm/h` },
	{ min: 30, score: 25, reason: (v) => `非常に激しい雨 ${v.toFixed(0)}mm/h` },
	{ min: 15, score: 15, reason: (v) => `激しい雨 ${v.toFixed(0)}mm/h` },
	{ min:  5, score:  8, reason: (v) => `やや強い雨 ${v.toFixed(0)}mm/h` },
	{ min:  1, score:  3, reason: (v) => `小雨 ${v.toFixed(0)}mm/h` }
];

/** 気温 ℃ → 加点（細分4段階）。 */
export const HEAT_TIERS: readonly ScoreTier[] = [
	{ min: 40, score: 40, reason: (v) => `危険な高温 ${v.toFixed(1)}℃` },
	{ min: 35, score: 30, reason: (v) => `熱中症危険域 ${v.toFixed(1)}℃` },
	{ min: 30, score: 15, reason: (v) => `猛暑 ${v.toFixed(1)}℃` },
	{ min: 28, score:  8, reason: (v) => `真夏日 ${v.toFixed(1)}℃` }
];

/** 地震マグニチュード → 基礎加点（時間・距離減衰を乗じた後の上限値）。 */
export const QUAKE_TIERS: readonly ScoreTier[] = [
	{ min: 5,   score: 40, reason: (v) => `M${v.toFixed(1)} 地震発生` },
	{ min: 4,   score: 20, reason: (v) => `M${v.toFixed(1)} 地震（7日以内）` },
	{ min: 3.5, score: 10, reason: (v) => `M${v.toFixed(1)} 小規模地震` }
];

/** PM2.5 μg/m³ → 加点。 */
export const PM25_TIERS: readonly ScoreTier[] = [
	{ min: 100, score: 40, reason: (v) => `PM2.5 ${v.toFixed(0)}μg/m³（非常に悪い）` },
	{ min:  50, score: 25, reason: (v) => `PM2.5 ${v.toFixed(0)}μg/m³（悪い）` },
	{ min:  25, score: 10, reason: (v) => `PM2.5 ${v.toFixed(0)}μg/m³（やや悪い）` }
];

/** 気象警報レベル → 加点と理由文言。 */
export interface AlertRule {
	readonly score: number;
	readonly reason: (weatherLabel: string) => string;
}

export const WEATHER_ALERT_RULES: Record<WeatherData['alertLevel'], AlertRule> = {
	special: { score: 50, reason: (label) => `特別警報（${label}）` },
	warning: { score: 30, reason: (label) => `大雨警報（${label}）` },
	advisory: { score: 15, reason: () => '気象注意報' },
	none: { score: 0, reason: () => '' }
};

/**
 * 値に該当する最上位の段階を返す（高い順に走査し、最初に `min` を満たした段階）。
 * 該当なしは null。
 */
export function matchTier(value: number, tiers: readonly ScoreTier[]): ScoreTier | null {
	for (const tier of tiers) {
		if (value >= tier.min) return tier;
	}
	return null;
}

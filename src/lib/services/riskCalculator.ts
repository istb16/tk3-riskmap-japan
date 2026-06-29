import type { RegionRisk, WeatherData, EarthquakeData, AirData, RiskType, Region, ScoreItem } from '../types';
import { fetchWeather, getWeatherLabel } from '../api/weather';
import { fetchEarthquake } from '../api/earthquake';
import { fetchAirQuality } from '../api/air';
import { valueOrNull } from '../utils/settled';
import {
	WIND_TIERS,
	PRECIPITATION_TIERS,
	HEAT_TIERS,
	QUAKE_TIERS,
	PM25_TIERS,
	WEATHER_ALERT_RULES,
	matchTier,
	MAX_SCORE
} from './scoringRules';
import type { ScoreTier } from './scoringRules';

export interface ScoreContribution {
	score: number;
	riskTypes: RiskType[];
	reasons: string[];
	scoreItems: ScoreItem[];
}

function emptyContribution(): ScoreContribution {
	return { score: 0, riskTypes: [], reasons: [], scoreItems: [] };
}

/** タイムスタンプ（ms）を「M/D HH:mm」形式の日本語日時文字列に変換 */
function formatDateTime(ts: number): string {
	return new Date(ts).toLocaleString('ja-JP', {
		month: 'numeric',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Asia/Tokyo'
	});
}

/**
 * 地震発生からの経過時間による減衰係数。
 * 0日=1.0、3日=0.1 の線形減衰。3日以降は0.1を維持。
 */
function earthquakeTimeFactor(timeMs: number | null): number {
	if (!timeMs) return 1.0;
	const ageDays = (Date.now() - timeMs) / (1000 * 60 * 60 * 24);
	if (ageDays <= 0) return 1.0;
	if (ageDays >= 3) return 0.1;
	return 1.0 - 0.9 * (ageDays / 3);
}

/**
 * 震源地からの距離による減衰係数。
 * 0km=1.0、333km=0.2 の線形減衰。
 */
function earthquakeDistanceFactor(distanceKm: number | null): number {
	if (distanceKm === null) return 1.0;
	const MAX_RADIUS = 333;
	return Math.max(0.2, 1.0 - 0.8 * (distanceKm / MAX_RADIUS));
}

/**
 * 単一の数値指標を段階表でスコア化する共通ロジック。
 */
function scoreMetric(
	value: number | null,
	tiers: readonly ScoreTier[],
	riskType: RiskType
): ScoreContribution {
	if (value === null) return emptyContribution();
	const tier = matchTier(value, tiers);
	if (!tier) return emptyContribution();
	const label = tier.reason(value);
	return {
		score: tier.score,
		riskTypes: [riskType],
		reasons: [label],
		scoreItems: [{ label, points: tier.score }]
	};
}

export function scoreWeather(w: WeatherData): ScoreContribution {
	const riskTypes: RiskType[] = [];
	const reasons: string[] = [];
	const scoreItems: ScoreItem[] = [];

	// 気象警報レベル + 風速 + 降水量 → 「weather」リスク
	let weatherScore = 0;
	const alert = WEATHER_ALERT_RULES[w.alertLevel];
	if (alert.score > 0) {
		weatherScore += alert.score;
		const timeStr = w.observedAt ? `　${formatDateTime(w.observedAt)}観測` : '';
		const alertLabel = alert.reason(getWeatherLabel(w.weatherCode));
		reasons.push(alertLabel + timeStr);
		scoreItems.push({ label: alertLabel, points: alert.score });
	}
	const wind = matchTier(w.windSpeed, WIND_TIERS);
	if (wind) {
		weatherScore += wind.score;
		const label = wind.reason(w.windSpeed);
		reasons.push(label);
		scoreItems.push({ label, points: wind.score });
	}
	const precip = matchTier(w.precipitation, PRECIPITATION_TIERS);
	if (precip) {
		weatherScore += precip.score;
		const label = precip.reason(w.precipitation);
		reasons.push(label);
		scoreItems.push({ label, points: precip.score });
	}
	if (weatherScore > 0) riskTypes.push('weather');

	// 気温 → 「heat」リスク
	let heatScore = 0;
	const heat = matchTier(w.temperature, HEAT_TIERS);
	if (heat) {
		heatScore = heat.score;
		riskTypes.push('heat');
		const label = heat.reason(w.temperature);
		reasons.push(label);
		scoreItems.push({ label, points: heat.score });
	}

	return { score: weatherScore + heatScore, riskTypes, reasons, scoreItems };
}

export function scoreEarthquake(eq: EarthquakeData): ScoreContribution {
	if (eq.magnitude === null) return emptyContribution();
	const tier = matchTier(eq.magnitude, QUAKE_TIERS);
	if (!tier) return emptyContribution();

	const timeFactor = earthquakeTimeFactor(eq.time);
	const distFactor = earthquakeDistanceFactor(eq.distanceKm);
	const combinedFactor = timeFactor * distFactor;
	const adjustedScore = Math.max(1, Math.round(tier.score * combinedFactor));

	const label = tier.reason(eq.magnitude);

	let note: string | undefined;
	if (combinedFactor < 0.99) {
		const decayDetails: string[] = [];
		if (eq.time) {
			const ageDays = (Date.now() - eq.time) / (1000 * 60 * 60 * 24);
			decayDetails.push(`${ageDays.toFixed(1)}日経過`);
		}
		if (eq.distanceKm !== null) {
			decayDetails.push(`震源${Math.round(eq.distanceKm)}km`);
		}
		const detail = decayDetails.length > 0 ? `（${decayDetails.join('・')}）` : '';
		note = `基礎${tier.score}点 × 減衰${combinedFactor.toFixed(2)}${detail}`;
	}

	return {
		score: adjustedScore,
		riskTypes: ['earthquake'],
		reasons: [label],
		scoreItems: [{ label, points: adjustedScore, note }]
	};
}

export function scoreAir(a: AirData): ScoreContribution {
	return scoreMetric(a.pm25, PM25_TIERS, 'air');
}

export async function calculateRegionRisk(region: Region): Promise<RegionRisk> {
	const [weather, earthquake, air] = await Promise.allSettled([
		fetchWeather(region.lat, region.lng),
		fetchEarthquake(region.lat, region.lng),
		fetchAirQuality(region.city, region.lat, region.lng)
	]);

	const w = valueOrNull(weather);
	const eq = valueOrNull(earthquake);
	const a = valueOrNull(air);

	const contributions: ScoreContribution[] = [];
	if (w) contributions.push(scoreWeather(w));
	if (eq) contributions.push(scoreEarthquake(eq));
	if (a) contributions.push(scoreAir(a));

	const totalScore = contributions.reduce((sum, c) => sum + c.score, 0);
	const reasons = contributions.flatMap((c) => c.reasons);
	const scoreItems = contributions.flatMap((c) => c.scoreItems);

	return {
		id: region.id,
		name: region.name,
		lat: region.lat,
		lng: region.lng,
		rawScore: totalScore,
		riskScore: Math.min(MAX_SCORE, totalScore),
		scoreItems,
		riskTypes: [...new Set(contributions.flatMap((c) => c.riskTypes))],
		reasons: reasons.length > 0 ? reasons : ['現在危険情報なし'],
		updatedAt: Date.now(),
		details: {
			weather: w ?? undefined,
			earthquake: eq ?? undefined,
			air: a ?? undefined
		}
	};
}

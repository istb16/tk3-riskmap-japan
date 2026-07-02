import type { RegionRisk, WeatherData, EarthquakeData, AirData, JmaData, RiskType, Region, ScoreItem } from '../types';
import { fetchWeather, getWeatherLabel, fetchWeatherBatch } from '../api/weather';
import { fetchEarthquake, fetchEarthquakesAll } from '../api/earthquake';
import { fetchAirQuality, fetchAirQualityBatch } from '../api/air';
import { fetchJmaWarnings, fetchAllJmaWarnings } from '../api/jma';
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
export function formatDateTime(ts: number): string {
	return new Date(ts).toLocaleString('ja-JP', {
		month: 'numeric',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Asia/Tokyo'
	});
}

function ageInDays(timeMs: number): number {
	return (Date.now() - timeMs) / (1000 * 60 * 60 * 24);
}

/**
 * 地震発生からの経過時間による減衰係数。
 * 0日=1.0、3日=0.1 の線形減衰。3日以降は0.1を維持。
 */
function earthquakeTimeFactor(timeMs: number | null): number {
	if (!timeMs) return 1.0;
	const ageDays = ageInDays(timeMs);
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

export function scoreWeather(w: WeatherData, jmaAlertLevel?: JmaData['alertLevel']): ScoreContribution {
	const riskTypes: RiskType[] = [];
	const reasons: string[] = [];
	const scoreItems: ScoreItem[] = [];

	// JMAが発令済み（'none'以外）の場合のみ優先。未発令('none')はOpen-Meteoの推定値を維持する
	const effectiveAlertLevel = (jmaAlertLevel && jmaAlertLevel !== 'none') ? jmaAlertLevel : w.alertLevel;

	// 気象警報レベル + 風速 + 降水量 → 「weather」リスク
	let weatherScore = 0;
	const alert = WEATHER_ALERT_RULES[effectiveAlertLevel];
	if (alert.score > 0) {
		weatherScore += alert.score;
		const timeStr = w.observedAt ? `　${formatDateTime(w.observedAt)}観測` : '';
		const alertLabel = alert.reason(getWeatherLabel(w.weatherCode));
		reasons.push(alertLabel + timeStr);
		scoreItems.push({ label: alertLabel + timeStr, points: alert.score });
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

	const dateStr = eq.time ? `（${formatDateTime(eq.time)}）` : '';
	const label = tier.reason(eq.magnitude) + dateStr;

	let note: string | undefined;
	if (combinedFactor < 0.99) {
		const decayDetails: string[] = [];
		if (eq.time) {
			decayDetails.push(`${ageInDays(eq.time).toFixed(1)}日経過`);
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

function buildRegionRisk(
	region: Region,
	w: WeatherData | null,
	eq: EarthquakeData | null,
	a: AirData | null,
	j: JmaData | null,
	now: number
): RegionRisk {
	const contributions: ScoreContribution[] = [];
	if (w) contributions.push(scoreWeather(w, j?.alertLevel));
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
		riskTypes: contributions.flatMap((c) => c.riskTypes),
		reasons: reasons.length > 0 ? reasons : ['現在危険情報なし'],
		updatedAt: now,
		details: {
			weather: w ?? undefined,
			earthquake: eq ?? undefined,
			air: a ?? undefined,
			jma: j ?? undefined
		}
	};
}

export interface AllRegionRisksResult {
	regions: RegionRisk[];
	failedApis: string[];
}

/**
 * 全地域のリスクデータをバッチAPIで効率的に取得して計算する。
 * 個別に47回リクエストを送る代わりに、APIごとに1〜数リクエストにまとめる。
 * - Open-Meteo 天気・大気: 各1リクエスト（47地点一括）
 * - USGS 地震: 日本全体1リクエスト → 地域ごとに振り分け
 * - JMA 警報: 同時実行数5で順次取得
 */
export async function calculateAllRegionRisks(regions: Region[]): Promise<AllRegionRisksResult> {
	const [weatherSettled, earthquakeSettled, airSettled, jmaSettled] = await Promise.allSettled([
		fetchWeatherBatch(regions),
		fetchEarthquakesAll(regions),
		fetchAirQualityBatch(regions),
		fetchAllJmaWarnings(regions)
	]);

	const weathers: (WeatherData | null)[] =
		valueOrNull(weatherSettled) ?? new Array<WeatherData | null>(regions.length).fill(null);
	const earthquakes: (EarthquakeData | null)[] =
		valueOrNull(earthquakeSettled) ?? new Array<EarthquakeData | null>(regions.length).fill(null);
	const airs: (AirData | null)[] =
		valueOrNull(airSettled) ?? new Array<AirData | null>(regions.length).fill(null);
	const jmas: (JmaData | null)[] =
		valueOrNull(jmaSettled) ?? new Array<JmaData | null>(regions.length).fill(null);

	const failedApis: string[] = [];
	if (weatherSettled.status === 'rejected') failedApis.push('気象');
	if (earthquakeSettled.status === 'rejected') failedApis.push('地震');
	if (airSettled.status === 'rejected') failedApis.push('大気質');
	if (jmaSettled.status === 'rejected') failedApis.push('JMA警報');

	const now = Date.now();
	const regionList = regions.map((region, i) =>
		buildRegionRisk(region, weathers[i] ?? null, earthquakes[i] ?? null, airs[i] ?? null, jmas[i] ?? null, now)
	);
	return { regions: regionList, failedApis };
}

/** 単一地域のリスクを計算する（テスト・後方互換用）。 */
export async function calculateRegionRisk(region: Region): Promise<RegionRisk> {
	const [weather, earthquake, air, jma] = await Promise.allSettled([
		fetchWeather(region.lat, region.lng),
		fetchEarthquake(region.lat, region.lng),
		fetchAirQuality(region.lat, region.lng),
		fetchJmaWarnings(region.jmaCode)
	]);
	return buildRegionRisk(
		region,
		valueOrNull(weather),
		valueOrNull(earthquake),
		valueOrNull(air),
		valueOrNull(jma),
		Date.now()
	);
}

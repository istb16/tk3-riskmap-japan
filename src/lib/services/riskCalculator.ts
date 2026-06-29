import type { RegionRisk, WeatherData, EarthquakeData, AirData, RiskType, Region } from '../types';
import { fetchWeather, getWeatherLabel } from '../api/weather';
import { fetchEarthquake } from '../api/earthquake';
import { fetchAirQuality } from '../api/air';
import { valueOrNull } from '../utils/settled';
import {
	WIND_TIERS,
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
}

function emptyContribution(): ScoreContribution {
	return { score: 0, riskTypes: [], reasons: [] };
}

/**
 * 単一の数値指標を段階表でスコア化する共通ロジック。
 * 地震・大気のように「1つの値→1段階→1リスクタイプ」の指標で使う。
 */
function scoreMetric(
	value: number | null,
	tiers: readonly ScoreTier[],
	riskType: RiskType
): ScoreContribution {
	if (value === null) return emptyContribution();
	const tier = matchTier(value, tiers);
	if (!tier) return emptyContribution();
	return { score: tier.score, riskTypes: [riskType], reasons: [tier.reason(value)] };
}

export function scoreWeather(w: WeatherData): ScoreContribution {
	const riskTypes: RiskType[] = [];
	const reasons: string[] = [];

	// 気象警報レベル + 風速 → 「weather」リスク
	let weatherScore = 0;
	const alert = WEATHER_ALERT_RULES[w.alertLevel];
	if (alert.score > 0) {
		weatherScore += alert.score;
		reasons.push(alert.reason(getWeatherLabel(w.weatherCode)));
	}
	const wind = matchTier(w.windSpeed, WIND_TIERS);
	if (wind) {
		weatherScore += wind.score;
		reasons.push(wind.reason(w.windSpeed));
	}
	if (weatherScore > 0) riskTypes.push('weather');

	// 気温 → 「heat」リスク
	let heatScore = 0;
	const heat = matchTier(w.temperature, HEAT_TIERS);
	if (heat) {
		heatScore = heat.score;
		riskTypes.push('heat');
		reasons.push(heat.reason(w.temperature));
	}

	return { score: weatherScore + heatScore, riskTypes, reasons };
}

export function scoreEarthquake(eq: EarthquakeData): ScoreContribution {
	return scoreMetric(eq.magnitude, QUAKE_TIERS, 'earthquake');
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

	return {
		id: region.id,
		name: region.name,
		lat: region.lat,
		lng: region.lng,
		riskScore: Math.min(MAX_SCORE, totalScore),
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

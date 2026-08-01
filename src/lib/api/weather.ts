import type { WeatherData } from '../types';
import { fetchJson } from './http';

interface OpenMeteoWeatherResponse {
	current: {
		time: string;
		temperature_2m: number;
		apparent_temperature: number;
		weather_code: number;
		precipitation: number;
		wind_speed_10m: number;
		wind_gusts_10m: number;
		snowfall: number;
		/** 積雪深。Open-Meteo は m 単位で返す（降雪量 snowfall は cm 単位）。 */
		snow_depth: number;
	};
}

/** Open-Meteo に要求する観測項目（単発・バッチで共通）。 */
const CURRENT_PARAMS = [
	'temperature_2m',
	'apparent_temperature',
	'weather_code',
	'precipitation',
	'wind_speed_10m',
	'wind_gusts_10m',
	'snowfall',
	'snow_depth',
].join(',');

const WMO_SEVERE = new Set([65, 67, 75, 77, 82, 85, 86, 95, 96, 99]);
const WMO_WARNING = new Set([61, 63, 71, 73, 80, 81, 55, 57]);
/** 早期注意情報相当（霧・霧雨など、まだ注意報には至らない天候）。 */
const WMO_EARLY = new Set([45, 48, 51, 53, 56]);

function buildWeatherUrl(latitudes: string, longitudes: string): string {
	return (
		`https://api.open-meteo.com/v1/forecast?latitude=${latitudes}&longitude=${longitudes}` +
		`&current=${CURRENT_PARAMS}&timezone=Asia%2FTokyo&forecast_days=1`
	);
}

function parseWeatherResponse(data: OpenMeteoWeatherResponse): WeatherData {
	const temp = data.current.temperature_2m ?? 0;
	const apparent = data.current.apparent_temperature ?? temp;
	const code = data.current.weather_code ?? 0;
	const precip = data.current.precipitation ?? 0;
	const wind = data.current.wind_speed_10m ?? 0;
	const gusts = data.current.wind_gusts_10m ?? wind;
	const snowfall = data.current.snowfall ?? 0;
	// snow_depth は m 単位で返るため cm に変換する
	const snowDepthCm = (data.current.snow_depth ?? 0) * 100;

	const observedAt = data.current.time ? new Date(data.current.time + ':00+09:00').getTime() : null;

	// 気象庁の警報が取得できない場合の推定レベル（JMAが発令済みならそちらを優先する）
	let alertLevel: WeatherData['alertLevel'] = 'none';
	if (WMO_SEVERE.has(code) || precip > 30) alertLevel = 'special';
	else if (WMO_WARNING.has(code) || precip > 10) alertLevel = 'warning';
	else if (precip > 2 || wind > 50) alertLevel = 'advisory';
	else if (WMO_EARLY.has(code) || precip > 0.2 || wind > 35) alertLevel = 'early';

	return {
		temperature: temp,
		apparentTemperature: apparent,
		weatherCode: code,
		precipitation: precip,
		windSpeed: wind,
		windGusts: gusts,
		snowfall,
		snowDepthCm,
		alertLevel,
		observedAt,
	};
}

export async function fetchWeather(lat: number, lng: number): Promise<WeatherData> {
	const data = await fetchJson<OpenMeteoWeatherResponse>(
		buildWeatherUrl(String(lat), String(lng)),
		'Weather'
	);
	return parseWeatherResponse(data);
}

/**
 * 複数地点の天気データを1リクエストで一括取得する。
 * 個別地点のパースエラーや全体の通信失敗はすべて null に変換して返す。
 */
export async function fetchWeatherBatch(
	regions: Array<{ lat: number; lng: number }>
): Promise<(WeatherData | null)[]> {
	if (regions.length === 0) return [];
	const lats = regions.map((r) => r.lat).join(',');
	const lngs = regions.map((r) => r.lng).join(',');

	try {
		const data = await fetchJson<OpenMeteoWeatherResponse | OpenMeteoWeatherResponse[]>(
			buildWeatherUrl(lats, lngs),
			'WeatherBatch'
		);
		const arr = Array.isArray(data) ? data : [data];
		return arr.map((d) => {
			try {
				return parseWeatherResponse(d);
			} catch {
				return null;
			}
		});
	} catch {
		return regions.map(() => null);
	}
}

export function getWeatherLabel(code: number): string {
	if (code === 0) return '快晴';
	if (code <= 3) return '曇り';
	if (code <= 48) return '霧';
	if (code <= 57) return '霧雨';
	if (code <= 67) return '雨';
	if (code <= 77) return '雪';
	if (code <= 82) return 'にわか雨';
	if (code <= 86) return '雪のにわか降り';
	if (code <= 99) return '雷雨';
	return '不明';
}

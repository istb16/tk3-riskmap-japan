import type { WeatherData } from '../types';
import { fetchJson } from './http';

interface OpenMeteoWeatherResponse {
	current: {
		time: string;
		temperature_2m: number;
		weather_code: number;
		precipitation: number;
		wind_speed_10m: number;
	};
}

const WMO_SEVERE = new Set([65, 67, 75, 77, 82, 85, 86, 95, 96, 99]);
const WMO_WARNING = new Set([61, 63, 71, 73, 80, 81, 55, 57]);

function parseWeatherResponse(data: OpenMeteoWeatherResponse): WeatherData {
	const temp = data.current.temperature_2m ?? 0;
	const code = data.current.weather_code ?? 0;
	const precip = data.current.precipitation ?? 0;
	const wind = data.current.wind_speed_10m ?? 0;

	const observedAt = data.current.time
		? new Date(data.current.time + ':00+09:00').getTime()
		: null;

	let alertLevel: WeatherData['alertLevel'] = 'none';
	if (WMO_SEVERE.has(code) || precip > 30) alertLevel = 'special';
	else if (WMO_WARNING.has(code) || precip > 10) alertLevel = 'warning';
	else if (precip > 2 || wind > 50) alertLevel = 'advisory';

	return { temperature: temp, weatherCode: code, precipitation: precip, windSpeed: wind, alertLevel, observedAt };
}

export async function fetchWeather(lat: number, lng: number): Promise<WeatherData> {
	const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,precipitation,wind_speed_10m&timezone=Asia%2FTokyo&forecast_days=1`;
	const data = await fetchJson<OpenMeteoWeatherResponse>(url, 'Weather');
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
	const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&current=temperature_2m,weather_code,precipitation,wind_speed_10m&timezone=Asia%2FTokyo&forecast_days=1`;

	try {
		const data = await fetchJson<OpenMeteoWeatherResponse | OpenMeteoWeatherResponse[]>(url, 'WeatherBatch');
		const arr = Array.isArray(data) ? data : [data];
		return arr.map((d) => {
			try { return parseWeatherResponse(d); }
			catch { return null; }
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

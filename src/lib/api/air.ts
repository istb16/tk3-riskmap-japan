import type { AirData } from '../types';
import { fetchJson } from './http';

interface OpenMeteoAirResponse {
	current?: {
		pm2_5?: number | null;
		european_aqi?: number | null;
	};
}

function parseAirResponse(data: OpenMeteoAirResponse): AirData {
	return {
		pm25: data.current?.pm2_5 ?? null,
		aqi: data.current?.european_aqi ?? null,
	};
}

export async function fetchAirQuality(lat: number, lng: number): Promise<AirData> {
	const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=pm2_5,european_aqi&timezone=Asia%2FTokyo`;
	const data = await fetchJson<OpenMeteoAirResponse>(url, 'OpenMeteoAir');
	return parseAirResponse(data);
}

/**
 * 複数地点の大気質データを1リクエストで一括取得する。
 * 個別地点のパースエラーや通信失敗はすべて null に変換して返す。
 */
export async function fetchAirQualityBatch(
	regions: Array<{ lat: number; lng: number }>
): Promise<(AirData | null)[]> {
	if (regions.length === 0) return [];
	const lats = regions.map((r) => r.lat).join(',');
	const lngs = regions.map((r) => r.lng).join(',');
	const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lngs}&current=pm2_5,european_aqi&timezone=Asia%2FTokyo`;

	try {
		const data = await fetchJson<OpenMeteoAirResponse | OpenMeteoAirResponse[]>(url, 'AirBatch');
		const arr = Array.isArray(data) ? data : [data];
		return arr.map((d) => {
			try {
				return parseAirResponse(d);
			} catch {
				return null;
			}
		});
	} catch {
		return regions.map(() => null);
	}
}

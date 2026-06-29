import type { AirData } from '../types';
import { fetchJson } from './http';

interface OpenMeteoAirResponse {
	current?: {
		pm2_5?: number | null;
		european_aqi?: number | null;
	};
}

export async function fetchAirQuality(lat: number, lng: number): Promise<AirData> {
	const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=pm2_5,european_aqi&timezone=Asia%2FTokyo`;

	const data = await fetchJson<OpenMeteoAirResponse>(url, 'OpenMeteoAir');
	return {
		pm25: data.current?.pm2_5 ?? null,
		aqi: data.current?.european_aqi ?? null
	};
}

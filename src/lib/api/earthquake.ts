import type { EarthquakeData } from '../types';
import { fetchJson } from './http';

interface USGSProperties {
	mag: number;
	place: string | null;
	time: number;
}

interface USGSGeometry {
	coordinates: [number, number, number]; // [lng, lat, depth_km]
}

interface USGSFeature {
	properties: USGSProperties;
	geometry: USGSGeometry;
}

interface USGSFeatureCollection {
	features: USGSFeature[];
}

const MIN_MAG = 3.0;
const RADIUS_KM = 3 * 111;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// 日本全体をカバーするバウンディングボックス
const JAPAN_BOUNDS = { minLat: 24, maxLat: 47, minLng: 122, maxLng: 154 };

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6371;
	const dLat = (lat2 - lat1) * (Math.PI / 180);
	const dLng = (lng2 - lng1) * (Math.PI / 180);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLng / 2) ** 2;
	return R * 2 * Math.asin(Math.sqrt(a));
}

function sevenDaysAgoDateStr(): string {
	return new Date(Date.now() - SEVEN_DAYS_MS).toISOString().slice(0, 10);
}

function featureToEarthquakeData(
	quake: USGSFeature,
	regionLat: number,
	regionLng: number
): EarthquakeData {
	const epicLng = quake.geometry.coordinates[0];
	const epicLat = quake.geometry.coordinates[1];
	return {
		magnitude: quake.properties.mag,
		place: quake.properties.place,
		time: quake.properties.time,
		depth: quake.geometry.coordinates[2],
		distanceKm: haversineKm(regionLat, regionLng, epicLat, epicLng)
	};
}

/** 単一地域の地震データを取得する（後方互換・テスト用）。 */
export async function fetchEarthquake(lat: number, lng: number): Promise<EarthquakeData> {
	const startTime = sevenDaysAgoDateStr();

	const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${startTime}&latitude=${lat}&longitude=${lng}&maxradiuskm=${RADIUS_KM}&minmagnitude=${MIN_MAG}&orderby=magnitude&limit=1`;
	const data = await fetchJson<USGSFeatureCollection>(url, 'Earthquake');

	if (!data.features || data.features.length === 0) {
		return { magnitude: null, place: null, time: null, depth: null, distanceKm: null };
	}
	return featureToEarthquakeData(data.features[0], lat, lng);
}

/**
 * 日本全体の地震データを1リクエストで取得し、各地域の最大規模の地震を返す。
 * USGSから規模降順で取得するため、最初にヒットした地震が各地域で最も規模が大きい。
 */
export async function fetchEarthquakesAll(
	regions: Array<{ lat: number; lng: number }>
): Promise<EarthquakeData[]> {
	const startTime = sevenDaysAgoDateStr();

	const url =
		`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
		`&starttime=${startTime}` +
		`&minlatitude=${JAPAN_BOUNDS.minLat}&maxlatitude=${JAPAN_BOUNDS.maxLat}` +
		`&minlongitude=${JAPAN_BOUNDS.minLng}&maxlongitude=${JAPAN_BOUNDS.maxLng}` +
		`&minmagnitude=${MIN_MAG}&orderby=magnitude&limit=2000`;

	const data = await fetchJson<USGSFeatureCollection>(url, 'EarthquakeBatch');
	const features = data.features ?? [];

	return regions.map((region) => {
		for (const quake of features) {
			const eq = featureToEarthquakeData(quake, region.lat, region.lng);
			if ((eq.distanceKm ?? Infinity) <= RADIUS_KM) return eq;
		}
		return { magnitude: null, place: null, time: null, depth: null, distanceKm: null };
	});
}

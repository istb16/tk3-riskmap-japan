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

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6371;
	const dLat = (lat2 - lat1) * (Math.PI / 180);
	const dLng = (lng2 - lng1) * (Math.PI / 180);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLng / 2) ** 2;
	return R * 2 * Math.asin(Math.sqrt(a));
}

export async function fetchEarthquake(lat: number, lng: number): Promise<EarthquakeData> {
	const now = new Date();
	const past = new Date(now.getTime() - SEVEN_DAYS_MS);
	const startTime = past.toISOString().slice(0, 10);
	const radiusKm = RADIUS_KM;

	const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${startTime}&latitude=${lat}&longitude=${lng}&maxradiuskm=${radiusKm}&minmagnitude=${MIN_MAG}&orderby=magnitude&limit=1`;

	const data = await fetchJson<USGSFeatureCollection>(url, 'Earthquake');

	if (!data.features || data.features.length === 0) {
		return { magnitude: null, place: null, time: null, depth: null, distanceKm: null };
	}

	const quake = data.features[0];
	const epicLng = quake.geometry.coordinates[0];
	const epicLat = quake.geometry.coordinates[1];
	return {
		magnitude: quake.properties.mag,
		place: quake.properties.place,
		time: quake.properties.time,
		depth: quake.geometry.coordinates[2],
		distanceKm: haversineKm(lat, lng, epicLat, epicLng)
	};
}

import type { EarthquakeData, Region, ShindoLevel } from '../types';
import { prefCodeOf } from '../types';
import { fetchJson } from './http';
import { decayedShindoScore, QUAKE_WINDOW_DAYS } from '../services/scoringRules';
import { haversineKm } from '../utils/geo';
import { DAY_MS, ageInDays } from '../utils/time';
import { fetchJmaQuakes, type JmaQuakeSummary } from './jmaQuake';
import { getCityCodesByClass10 } from './jma';

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
const QUAKE_WINDOW_MS = QUAKE_WINDOW_DAYS * DAY_MS;

// 日本全体をカバーするバウンディングボックス
const JAPAN_BOUNDS = { minLat: 24, maxLat: 47, minLng: 122, maxLng: 154 };

/** USGSに渡す取得開始日。地震スコアの評価期間と揃える。 */
function windowStartDateStr(): string {
	return new Date(Date.now() - QUAKE_WINDOW_MS).toISOString().slice(0, 10);
}

function emptyEarthquake(): EarthquakeData {
	return {
		magnitude: null,
		place: null,
		time: null,
		depth: null,
		distanceKm: null,
		shindo: null,
		shindoSource: null,
		recentQuakeCount: 0,
	};
}

// ─── 震度の推定（気象庁の実測値が取得できない場合のフォールバック） ─────────────

/** 平均的な地盤の表層増幅率（工学的基盤 Vs=600m/s に対する地表の最大速度比）。 */
const SITE_AMPLIFICATION = 1.8;

/**
 * 計測震度（実数値）を気象庁震度階級に変換する。
 */
export function shindoLevelFromInstrumental(instrumental: number): ShindoLevel | null {
	if (instrumental < 0.5) return null;
	if (instrumental < 1.5) return '1';
	if (instrumental < 2.5) return '2';
	if (instrumental < 3.5) return '3';
	if (instrumental < 4.5) return '4';
	if (instrumental < 5.0) return '5-';
	if (instrumental < 5.5) return '5+';
	if (instrumental < 6.0) return '6-';
	if (instrumental < 6.5) return '6+';
	return '7';
}

/**
 * マグニチュード・震源深さ・震央距離から震度を推定する。
 *
 * 司・翠川(1999) の最大速度距離減衰式で工学的基盤の PGV を求め、
 * 平均的な地盤増幅を掛けたうえで翠川ら(1999) の式で計測震度に換算する。
 * 気象庁の実測震度が取得できたときは常にそちらを使うため、これはフォールバック専用。
 */
export function estimateShindo(
	magnitude: number,
	depthKm: number | null,
	distanceKm: number | null
): ShindoLevel | null {
	const depth = depthKm ?? 10;
	const epicentralDistance = distanceKm ?? 0;
	// 震源距離（震央距離と深さから求める斜距離）
	const hypocentralDistance = Math.sqrt(epicentralDistance ** 2 + depth ** 2);

	// 司・翠川(1999): log10(PGV) = 0.58M + 0.0038D - 1.29 - log10(X + 0.0028·10^0.5M) - 0.002X
	const nearFieldTerm = 0.0028 * 10 ** (0.5 * magnitude);
	const logPgvBedrock =
		0.58 * magnitude +
		0.0038 * depth -
		1.29 -
		Math.log10(hypocentralDistance + nearFieldTerm) -
		0.002 * hypocentralDistance;

	const pgvSurface = 10 ** logPgvBedrock * SITE_AMPLIFICATION;
	if (pgvSurface <= 0) return null;

	// 翠川ら(1999): I = 2.68 + 1.72·log10(PGV)
	const instrumental = 2.68 + 1.72 * Math.log10(pgvSurface);
	return shindoLevelFromInstrumental(instrumental);
}

// ─── USGS（フォールバック経路） ───────────────────────────────────────────────

function featureToEarthquakeData(
	quake: USGSFeature,
	regionLat: number,
	regionLng: number
): EarthquakeData {
	const epicLng = quake.geometry.coordinates[0];
	const epicLat = quake.geometry.coordinates[1];
	const depth = quake.geometry.coordinates[2];
	const distanceKm = haversineKm(regionLat, regionLng, epicLat, epicLng);
	const magnitude = quake.properties.mag;
	const shindo =
		magnitude === null || magnitude === undefined
			? null
			: estimateShindo(magnitude, depth, distanceKm);
	return {
		magnitude,
		place: quake.properties.place,
		time: quake.properties.time,
		depth,
		distanceKm,
		shindo,
		shindoSource: shindo ? 'estimated' : null,
		// USGSからは地域別の観測回数が得られないため群発性は評価しない
		recentQuakeCount: 0,
	};
}

/** 単一地域の地震データをUSGSから取得する（後方互換・テスト用）。 */
export async function fetchEarthquake(lat: number, lng: number): Promise<EarthquakeData> {
	const startTime = windowStartDateStr();

	const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${startTime}&latitude=${lat}&longitude=${lng}&maxradiuskm=${RADIUS_KM}&minmagnitude=${MIN_MAG}&orderby=magnitude&limit=1`;
	const data = await fetchJson<USGSFeatureCollection>(url, 'Earthquake');

	if (!data.features || data.features.length === 0) return emptyEarthquake();
	return featureToEarthquakeData(data.features[0], lat, lng);
}

/** 時間減衰後の震度スコア。地域ごとに「いま最も危険な地震」を選ぶための比較値。 */
function currentDangerOf(eq: EarthquakeData, now: number): number {
	if (!eq.shindo) return -1;
	return decayedShindoScore(eq.shindo, eq.time === null ? 0 : ageInDays(eq.time, now));
}

/**
 * 日本全体の地震データをUSGSから1リクエストで取得し、各地域で推定震度が最も高い地震を返す。
 * 気象庁の実測震度が取得できなかった場合のフォールバック経路。
 */
export async function fetchEarthquakesFromUsgs(
	regions: Array<{ lat: number; lng: number }>
): Promise<EarthquakeData[]> {
	const startTime = windowStartDateStr();

	const url =
		`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
		`&starttime=${startTime}` +
		`&minlatitude=${JAPAN_BOUNDS.minLat}&maxlatitude=${JAPAN_BOUNDS.maxLat}` +
		`&minlongitude=${JAPAN_BOUNDS.minLng}&maxlongitude=${JAPAN_BOUNDS.maxLng}` +
		`&minmagnitude=${MIN_MAG}&orderby=magnitude&limit=2000`;

	const data = await fetchJson<USGSFeatureCollection>(url, 'EarthquakeBatch');
	const features = data.features ?? [];
	const now = Date.now();

	return regions.map((region) => {
		let best = emptyEarthquake();
		let bestScore = -1;
		for (const quake of features) {
			const eq = featureToEarthquakeData(quake, region.lat, region.lng);
			if ((eq.distanceKm ?? Infinity) > RADIUS_KM) continue;
			const score = currentDangerOf(eq, now);
			if (score > bestScore) {
				bestScore = score;
				best = eq;
			}
		}
		return best;
	});
}

// ─── 気象庁（主経路） ─────────────────────────────────────────────────────────

function summaryToEarthquakeData(
	summary: JmaQuakeSummary,
	region: { lat: number; lng: number }
): EarthquakeData {
	const { strongest, recentQuakeCount } = summary;
	if (!strongest) return { ...emptyEarthquake(), recentQuakeCount };

	const distanceKm =
		strongest.epicenterLat !== null && strongest.epicenterLng !== null
			? haversineKm(region.lat, region.lng, strongest.epicenterLat, strongest.epicenterLng)
			: null;

	return {
		magnitude: strongest.magnitude,
		place: strongest.place,
		time: strongest.time,
		depth: strongest.depthKm,
		distanceKm,
		shindo: strongest.shindo,
		shindoSource: 'observed',
		recentQuakeCount,
	};
}

/**
 * 全地域の地震データを取得する。
 * 気象庁の実測震度を主経路とし、取得に失敗した場合のみUSGS＋推定震度にフォールバックする。
 * 地震はこのアプリの看板機能であり、単一エンドポイントの一時障害でスコアが丸ごと
 * 消えるのを避けるため二重化している。
 */
export async function fetchEarthquakesAll(regions: Region[]): Promise<EarthquakeData[]> {
	try {
		// 地域は一次細分区域で定義されているので、震度を引くために自治体コード（5桁）へ展開する。
		// 全国の自治体コードも同じ表から導けるので、area.json の集計は1回で済ませる
		const cityCodesByClass10 = await getCityCodesByClass10();
		const toCode5 = (cityCode7: string) => cityCode7.slice(0, 5);
		const municipalityCodes5 = [
			...new Set(Object.values(cityCodesByClass10).flat().map(toCode5)),
		].sort();
		const regionKeys = regions.map((region) => ({
			prefCode: prefCodeOf(region),
			cityCodes: [
				...new Set(
					region.class10Codes.flatMap((code) => (cityCodesByClass10[code] ?? []).map(toCode5))
				),
			],
		}));
		const summaries = await fetchJmaQuakes(regionKeys, municipalityCodes5);
		return summaries.map((summary, i) => summaryToEarthquakeData(summary, regions[i]));
	} catch {
		return fetchEarthquakesFromUsgs(regions);
	}
}

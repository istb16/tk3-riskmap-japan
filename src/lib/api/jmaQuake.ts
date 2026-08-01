import type { ShindoLevel } from '../types';
import { fetchJson } from './http';
import {
	SHINDO_SCORES,
	decayedShindoScore,
	QUAKE_WINDOW_DAYS,
	SWARM_WINDOW_DAYS,
} from '../services/scoringRules';
import { DAY_MS, ageInDays } from '../utils/time';

/**
 * 気象庁の地震情報一覧から「都道府県ごとの実測震度」を取得する。
 *
 * USGS はマグニチュード・震源位置しか返さないため震度は推定するしかないが、
 * 気象庁は各地震について都道府県別の観測震度を公開している。実測値が常に推定値に優る。
 *
 * データの性質（実データで確認済み）:
 * - `list.json` は約30日分を含むため、評価期間でのフィルタはこちら側で行う必要がある
 * - 同一地震（`eid`）に対して複数の報（震度速報 → 震源・震度情報 …）が並ぶため、
 *   `eid` 単位でマージしないと同じ地震を重複カウントしてしまう
 * - `int[].code` は必ず2桁の都道府県コード（`Region.jmaCode` の先頭2桁と一致）
 */

/** 地震スコアの評価対象期間（余震危険度が残る2週間）。 */
const QUAKE_WINDOW_MS = QUAKE_WINDOW_DAYS * DAY_MS;

const QUAKE_LIST_URL = 'https://www.jma.go.jp/bosai/quake/data/list.json';

interface JmaQuakeIntCity {
	code?: string;
	maxi?: string;
}

interface JmaQuakeIntArea {
	code?: string;
	maxi?: string;
	city?: JmaQuakeIntCity[];
}

interface JmaQuakeListEntry {
	eid?: string;
	/** 地震発生時刻（ISO8601 +09:00） */
	at?: string;
	/** 震央地名 */
	anm?: string;
	/** 震源座標「+32.6+130.7-10000/」形式（深さはメートル・負値） */
	cod?: string;
	mag?: string;
	maxi?: string;
	int?: JmaQuakeIntArea[];
}

/** 1つの地震について、ある都道府県で観測された内容。 */
export interface JmaQuakeObservation {
	shindo: ShindoLevel;
	magnitude: number | null;
	place: string | null;
	/** 地震発生時刻（ミリ秒UNIXタイムスタンプ） */
	time: number;
	depthKm: number | null;
	epicenterLat: number | null;
	epicenterLng: number | null;
}

/** ある地域の直近の地震状況。 */
export interface JmaQuakeSummary {
	/** 時間減衰後のスコアが最大の地震（＝いま最も危険な地震）。該当なしは null。 */
	strongest: JmaQuakeObservation | null;
	/** 直近 `SWARM_WINDOW_DAYS` 日間に震度1以上を観測した地震の件数（群発性の指標）。 */
	recentQuakeCount: number;
}

/**
 * 気象庁の震度表記をパースする。
 * `5@` / `6@` は「震度5弱以上と推定」等の速報値なので、弱側（`5-` / `6-`）として扱う。
 */
export function parseShindo(raw: string | undefined | null): ShindoLevel | null {
	if (!raw) return null;
	const normalized = raw.replace('@', '-');
	switch (normalized) {
		case '1':
		case '2':
		case '3':
		case '4':
		case '7':
		case '5-':
		case '5+':
		case '6-':
		case '6+':
			return normalized;
		default:
			return null;
	}
}

/** 「+32.6+130.7-10000/」→ 緯度・経度・深さ(km)。深さは省略される場合がある。 */
export function parseEpicenter(cod: string | undefined): {
	lat: number | null;
	lng: number | null;
	depthKm: number | null;
} {
	const empty = { lat: null, lng: null, depthKm: null };
	if (!cod) return empty;
	const m = /^([+-][\d.]+)([+-][\d.]+)(?:([+-]\d+))?/.exec(cod);
	if (!m) return empty;
	const lat = Number(m[1]);
	const lng = Number(m[2]);
	// 深さはメートル・負値で入るため絶対値をkmに変換する
	const depthKm = m[3] === undefined ? null : Math.abs(Number(m[3])) / 1000;
	return {
		lat: Number.isFinite(lat) ? lat : null,
		lng: Number.isFinite(lng) ? lng : null,
		depthKm: depthKm !== null && Number.isFinite(depthKm) ? depthKm : null,
	};
}

/** 同一地震（eid）に属する複数の報をマージした結果。 */
interface MergedQuake {
	time: number;
	place: string | null;
	magnitude: number | null;
	depthKm: number | null;
	epicenterLat: number | null;
	epicenterLng: number | null;
	/** 都道府県コード → その県の最大震度 */
	shindoByPref: Map<string, ShindoLevel>;
	/** 市区町村コード（7桁）→ その市区町村の震度。地域を一次細分区域で切るために使う。 */
	shindoByCity: Map<string, ShindoLevel>;
}

/**
 * 地震情報一覧を `eid` 単位にマージする。
 * 都道府県別震度は「同一地震の全報のうち最も強い震度」を採用し、
 * 震源情報は最初に現れた非空の値（＝最新報の値）を優先する。
 */
export function mergeQuakeEntries(
	entries: JmaQuakeListEntry[],
	now: number,
	windowMs: number = QUAKE_WINDOW_MS
): MergedQuake[] {
	const byEvent = new Map<string, MergedQuake>();
	const cutoff = now - windowMs;

	for (const entry of entries) {
		if (!entry.eid || !entry.at) continue;
		const time = new Date(entry.at).getTime();
		if (!Number.isFinite(time) || time < cutoff) continue;

		let merged = byEvent.get(entry.eid);
		if (!merged) {
			merged = {
				time,
				place: null,
				magnitude: null,
				depthKm: null,
				epicenterLat: null,
				epicenterLng: null,
				shindoByPref: new Map(),
				shindoByCity: new Map(),
			};
			byEvent.set(entry.eid, merged);
		}

		// list.json は新しい報が先に並ぶため、未設定のフィールドだけを埋める
		if (merged.place === null && entry.anm) merged.place = entry.anm;
		if (merged.magnitude === null && entry.mag) {
			const mag = Number(entry.mag);
			if (Number.isFinite(mag)) merged.magnitude = mag;
		}
		if (merged.epicenterLat === null) {
			const { lat, lng, depthKm } = parseEpicenter(entry.cod);
			if (lat !== null) {
				merged.epicenterLat = lat;
				merged.epicenterLng = lng;
				merged.depthKm = depthKm;
			}
		}

		for (const area of entry.int ?? []) {
			const shindo = parseShindo(area.maxi);
			if (area.code && shindo) {
				const current = merged.shindoByPref.get(area.code);
				if (!current || SHINDO_SCORES[shindo] > SHINDO_SCORES[current]) {
					merged.shindoByPref.set(area.code, shindo);
				}
			}
			for (const city of area.city ?? []) {
				const cityShindo = parseShindo(city.maxi);
				if (!city.code || !cityShindo) continue;
				const current = merged.shindoByCity.get(city.code);
				if (!current || SHINDO_SCORES[cityShindo] > SHINDO_SCORES[current]) {
					merged.shindoByCity.set(city.code, cityShindo);
				}
			}
		}
	}

	return [...byEvent.values()];
}

/** 震度を引く対象。市区町村コードがあればそちらを優先し、無ければ都道府県の最大震度を使う。 */
export interface QuakeRegionKey {
	prefCode: string;
	/** この地域に属する自治体コード（5桁）。空なら都道府県単位にフォールバックする。 */
	cityCodes: readonly string[];
}

/**
 * 地震情報の市区町村コード（7桁）を `area.json` 側の自治体コード（5桁）に解決する関数を作る。
 *
 * 2種類のズレを吸収する必要がある:
 * 1. **市の地理的分割** —— `area.json` は釧路市を `0120601` 釧路市釧路 / `0120602` 釧路市阿寒 に
 *    分けるが、地震情報は `0120600` 釧路市で報じる。5桁に落とせばどちらも `01206` で一致する。
 * 2. **政令指定都市の行政区** —— 地震情報は札幌市中央区(`01101`)のように区単位で報じるが、
 *    `area.json` は札幌市(`01100`)しか持たない。実データでは154区が該当する。
 *
 * 2 の親市は「同一都道府県内で、その区コードを超えない最大の自治体コード」として求める。
 * 行政区コードは親市コードの直後に連番で割り当てられ、その範囲に他の自治体は存在しないため
 * この規則が成り立つ（大阪市 `27100` の区は `27102`〜`27128`、堺市 `27140` の区は `27141`〜`27147`）。
 * 公式の「気象・地震・火山情報／市町村等」コード表の154区すべてで検証し、齟齬ゼロを確認した。
 *
 * 下位桁を落とす方法は使えない。4桁接頭辞は340組で衝突し（`0120` に函館市・小樽市・旭川市が同居）、
 * 札幌市清田区(`01110`)は接頭辞パターンから外れ、浜松市(`22130`)の区は `22138`〜 と境界を跨ぐため
 * 静岡市(`22100`)に誤って丸められる。名前照合も使えない（公式表の「大阪堺市西区」は
 * 「大阪市」に前方一致してしまう）。
 */
export function createMunicipalityResolver(
	municipalityCodes5: readonly string[]
): (cityCode7: string) => string {
	const known = new Set(municipalityCodes5);
	const byPref = new Map<string, string[]>();
	for (const code of municipalityCodes5) {
		const pref = code.slice(0, 2);
		const list = byPref.get(pref);
		if (list) list.push(code);
		else byPref.set(pref, [code]);
	}
	for (const list of byPref.values()) list.sort();

	return (cityCode7: string): string => {
		const code5 = cityCode7.slice(0, 5);
		if (known.has(code5)) return code5;
		let parent = code5;
		for (const candidate of byPref.get(code5.slice(0, 2)) ?? []) {
			if (candidate > code5) break;
			parent = candidate;
		}
		return parent;
	};
}

/**
 * マージ済みの地震から、地域ごとの「いま最も危険な地震」と観測回数を求める。
 * 「最も危険」の判定は震度の基礎点 × 時間減衰で行う。
 * マグニチュードが最大の地震ではなく、6日前のM7より1時間前の震度5強を選ぶ。
 */
export function summarizeByRegion(
	quakes: MergedQuake[],
	regionKeys: readonly QuakeRegionKey[],
	now: number,
	/** 地震情報の7桁コード → 自治体コード5桁。省略時は単純に先頭5桁を使う。 */
	resolveMunicipality: (cityCode7: string) => string = (c) => c.slice(0, 5)
): JmaQuakeSummary[] {
	// 自治体コード（5桁）→ 該当する地域のindex
	const cityToRegions = new Map<string, number[]>();
	regionKeys.forEach((key, i) => {
		for (const code of key.cityCodes) {
			const list = cityToRegions.get(code) ?? [];
			if (!list.includes(i)) list.push(i);
			cityToRegions.set(code, list);
		}
	});

	const strongest: (JmaQuakeObservation | null)[] = regionKeys.map(() => null);
	const bestScores: number[] = regionKeys.map(() => -1);
	const counts: number[] = regionKeys.map(() => 0);
	// 地震ごとに作り直さず使い回す（数百件×数十地域のループなので確保コストが効く）
	const perRegion: (ShindoLevel | null)[] = regionKeys.map(() => null);

	for (const quake of quakes) {
		perRegion.fill(null);

		for (const [cityCode, shindo] of quake.shindoByCity) {
			for (const i of cityToRegions.get(resolveMunicipality(cityCode)) ?? []) {
				const current = perRegion[i];
				if (!current || SHINDO_SCORES[shindo] > SHINDO_SCORES[current]) perRegion[i] = shindo;
			}
		}
		// 都道府県単位で補うのは次の2つの場合だけ:
		// (1) その報が市区町村単位の震度を持たない（震度速報など）
		// (2) その地域が市区町村コードを1つも持たない（area.json が取得できなかった等）
		// 市区町村データがある報は震度1以上を観測した全市区町村を列挙しているので、
		// 照合できる地域で該当がなければ「観測なし」が正しい
		// （都道府県値で補うと揺れていない地域に点が入る）。
		const reportHasCityData = quake.shindoByCity.size > 0;
		regionKeys.forEach((key, i) => {
			if (perRegion[i]) return;
			if (reportHasCityData && key.cityCodes.length > 0) return;
			perRegion[i] = quake.shindoByPref.get(key.prefCode) ?? null;
		});

		const age = ageInDays(quake.time, now);
		const withinSwarmWindow = age <= SWARM_WINDOW_DAYS;
		perRegion.forEach((shindo, i) => {
			if (!shindo) return;
			if (withinSwarmWindow) counts[i]++;
			const score = decayedShindoScore(shindo, age);
			if (score > bestScores[i]) {
				bestScores[i] = score;
				strongest[i] = {
					shindo,
					magnitude: quake.magnitude,
					place: quake.place,
					time: quake.time,
					depthKm: quake.depthKm,
					epicenterLat: quake.epicenterLat,
					epicenterLng: quake.epicenterLng,
				};
			}
		});
	}

	return regionKeys.map((_, i) => ({ strongest: strongest[i], recentQuakeCount: counts[i] }));
}

/** 全地域の実測震度を1リクエストで取得する（市区町村コードの展開に area.json も使う）。 */
export async function fetchJmaQuakes(
	regionKeys: readonly QuakeRegionKey[],
	municipalityCodes5: readonly string[] = []
): Promise<JmaQuakeSummary[]> {
	const entries = await fetchJson<JmaQuakeListEntry[]>(QUAKE_LIST_URL, 'JMAQuake');
	const now = Date.now();
	const merged = mergeQuakeEntries(Array.isArray(entries) ? entries : [], now);
	const resolve =
		municipalityCodes5.length > 0 ? createMunicipalityResolver(municipalityCodes5) : undefined;
	return summarizeByRegion(merged, regionKeys, now, resolve);
}

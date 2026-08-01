import type { Region, VolcanoAlert, VolcanoData } from '../types';
import { prefCodeOf } from '../types';
import { fetchJson } from './http';
import { haversineKm } from '../utils/geo';

/**
 * 気象庁の噴火警報・予報を取得し、都道府県ごとの噴火警戒レベルを求める。
 *
 * `warning.json` は「現在発表中」の噴火警報だけを含むため時間減衰は不要
 * （2007年発表の警報が今も継続しているケースがある）。
 * 対象市町村コードの先頭2桁が都道府県コードと一致するので、地域マッチは厳密に行える。
 */

const VOLCANO_WARNING_URL = 'https://www.jma.go.jp/bosai/volcano/data/warning.json';
const VOLCANO_LIST_URL = 'https://www.jma.go.jp/bosai/volcano/const/volcano_list.json';

/** 噴火警報・予報のうち、火山ごとの警戒レベルを持つ情報種別。 */
const TARGET_VOLCANO_INFO_TYPE = '噴火警報・予報（対象火山）';

/**
 * 火山スコアの距離減衰。この距離までは満点（km）。
 * 噴火警戒レベルの防災対応は火口周辺〜居住地域が対象で、数km〜数十kmの範囲。
 */
const VOLCANO_FULL_SCORE_KM = 50;

/**
 * 火山スコアの距離減衰。この距離で係数0になる（km）。
 *
 * 都道府県コードだけで割り当てると、東京都は約1000km南の西之島・硫黄島・福徳岡ノ場の
 * 噴火警報を拾ってしまい、無人島の噴火だけで常に全国1位になる。
 * 各地域は県庁所在地を代表地点にしているため、そこから見た距離で減衰させる。
 *
 * 固定しきい値で切るのではなく連続減衰にしているのは、しきい値の位置が恣意的になり
 * 「八丈島（東京から約285km・有人）は満点か0か」のような二択を生んでしまうため。
 */
const VOLCANO_ZERO_SCORE_KM = 300;

interface VolcanoInfoArea {
	name?: string;
	code?: string;
}

interface VolcanoInfoItem {
	name?: string;
	code?: string;
	condition?: string;
	areas?: VolcanoInfoArea[];
}

interface VolcanoInfo {
	type?: string;
	items?: VolcanoInfoItem[];
}

interface VolcanoWarningEntry {
	reportDatetime?: string;
	eventId?: string;
	/** 対象市町村コード（7桁）。先頭2桁が都道府県コード。 */
	areas?: string[];
	volcanoInfos?: VolcanoInfo[];
}

/**
 * 噴火警報コード → 噴火警戒レベル（1〜5）と、レベル運用火山かどうか。
 *
 * ## 出典
 * 気象庁防災情報XMLフォーマット「VolcanicWarning コード表」
 * （種別："警報等情報要素／噴火警報・予報等"）。
 * <https://xml.kishou.go.jp/tec_material.html> の「個別コード表」内
 * `地震火山関連コード表.xls` シート81。
 *
 * 11〜15 が噴火警戒レベル運用火山、21〜25 と 35〜36 がレベル運用外の火山。
 * 運用外の火山は防災対応のキーワードから相当レベルに換算する
 * （噴火予報=1 / 火口周辺警報=2〜3 / 噴火警報（居住地域）=4〜5）。
 */
const VOLCANO_CODE_LEVELS: Record<string, { level: number; isLevelOperated: boolean }> = {
	// 噴火警戒レベル運用火山
	'11': { level: 1, isLevelOperated: true }, // レベル１（活火山であることに留意）
	'12': { level: 2, isLevelOperated: true }, // レベル２（火口周辺規制）
	'13': { level: 3, isLevelOperated: true }, // レベル３（入山規制）
	'14': { level: 4, isLevelOperated: true }, // レベル４（高齢者等避難）
	'15': { level: 5, isLevelOperated: true }, // レベル５（避難）
	// レベル運用外の火山（陸域）
	'21': { level: 1, isLevelOperated: false }, // 活火山であることに留意
	'22': { level: 2, isLevelOperated: false }, // 火口周辺危険
	'23': { level: 3, isLevelOperated: false }, // 入山危険
	'24': { level: 4, isLevelOperated: false }, // 山麓厳重警戒
	'25': { level: 5, isLevelOperated: false }, // 居住地域厳重警戒
	// レベル運用外の火山（海底火山）
	'35': { level: 1, isLevelOperated: false }, // 活火山であることに留意（海底火山）
	'36': { level: 2, isLevelOperated: false }, // 周辺海域警戒
};

/** 公式コード表に載っている噴火警報コードか（未知コードの検知に使う）。 */
export function isKnownVolcanoCode(code: string): boolean {
	return code in VOLCANO_CODE_LEVELS;
}

/** 全角数字を半角に変換する（気象庁は「レベル２」のように全角で表記する）。 */
function toHalfWidthDigits(text: string): string {
	return text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * 噴火警報の警戒レベルを判定する。
 *
 * 公式コード表（`VOLCANO_CODE_LEVELS`）で引くのを基本とし、
 * コードが欠けている・未知の場合のみ警戒レベル文言から推定する。
 */
export function volcanoLevel(
	code: string | undefined,
	rawName: string | undefined
): { level: number; isLevelOperated: boolean } {
	const official = code ? VOLCANO_CODE_LEVELS[code] : undefined;
	if (official) return { ...official };
	return volcanoLevelFromName(rawName);
}

/**
 * 噴火警報の警戒レベル文言からレベル1〜5を判定する（コードが引けない場合のフォールバック）。
 *
 * 噴火警戒レベルが運用されている火山は「レベル３（入山規制）」のように明示されるが、
 * 運用外の火山は「火口周辺危険」「入山危険」「周辺海域警戒」など文言のみで表される。
 * 後者は防災対応の内容から相当レベルに換算する。
 */
export function volcanoLevelFromName(rawName: string | undefined): {
	level: number;
	isLevelOperated: boolean;
} {
	if (!rawName) return { level: 1, isLevelOperated: false };
	const name = toHalfWidthDigits(rawName);

	const levelMatch = /レベル\s*([1-5])/.exec(name);
	if (levelMatch) return { level: Number(levelMatch[1]), isLevelOperated: true };

	// 運用外の火山：防災対応の内容からレベル相当を割り当てる
	// 「高齢者等避難」は「避難」を含むため、より限定的な文言から先に判定する
	if (name.includes('高齢者等避難') || name.includes('避難準備')) {
		return { level: 4, isLevelOperated: false };
	}
	if (name.includes('居住地域')) return { level: 4, isLevelOperated: false };
	if (name.includes('避難')) return { level: 5, isLevelOperated: false };
	if (name.includes('入山危険') || name.includes('入山規制')) {
		return { level: 3, isLevelOperated: false };
	}
	if (name.includes('火口周辺') || name.includes('周辺海域')) {
		return { level: 2, isLevelOperated: false };
	}
	return { level: 1, isLevelOperated: false };
}

/** 噴火警報エントリから対象都道府県コードを抽出する。 */
function prefCodesOfEntry(entry: VolcanoWarningEntry): Set<string> {
	const codes = new Set<string>();
	for (const cityCode of entry.areas ?? []) {
		if (cityCode.length >= 2) codes.add(cityCode.slice(0, 2));
	}
	if (codes.size === 0) {
		// 上位の areas が無い場合は「対象市町村等」の情報から拾う
		for (const info of entry.volcanoInfos ?? []) {
			if (info.type === TARGET_VOLCANO_INFO_TYPE) continue;
			for (const item of info.items ?? []) {
				for (const area of item.areas ?? []) {
					if (area.code && area.code.length >= 7) codes.add(area.code.slice(0, 2));
				}
			}
		}
	}
	return codes;
}

/**
 * 距離減衰を掛ける前の中間表現。
 * 火山コードを保持し、距離に依存するフィールド（`distanceKm` / `distanceFactor`）はまだ持たない。
 */
export interface ResolvedVolcanoAlert {
	name: string;
	/** 火山コード（`volcano_list.json` の `code` と対応） */
	code: string;
	level: number;
	levelText: string;
	isLevelOperated: boolean;
}

/** 噴火警報一覧を都道府県ごとの火山アラートに畳み込む（レベル降順）。 */
export function resolveVolcanoesByPrefecture(
	entries: VolcanoWarningEntry[]
): Map<string, ResolvedVolcanoAlert[]> {
	const result = new Map<string, ResolvedVolcanoAlert[]>();

	for (const entry of entries) {
		const target = (entry.volcanoInfos ?? []).find((i) => i.type === TARGET_VOLCANO_INFO_TYPE);
		if (!target) continue;

		const prefCodes = prefCodesOfEntry(entry);
		if (prefCodes.size === 0) continue;

		for (const item of target.items ?? []) {
			const { level, isLevelOperated } = volcanoLevel(item.code, item.name);
			for (const area of item.areas ?? []) {
				if (!area.name) continue;
				const alert: ResolvedVolcanoAlert = {
					name: area.name,
					code: area.code ?? '',
					level,
					levelText: item.name ?? `レベル${level}`,
					isLevelOperated,
				};
				for (const prefCode of prefCodes) {
					const list = result.get(prefCode) ?? [];
					// 同一火山が複数の報で重複しないようにする
					if (!list.some((a) => a.name === alert.name)) list.push(alert);
					result.set(prefCode, list);
				}
			}
		}
	}

	for (const alerts of result.values()) {
		alerts.sort((a, b) => b.level - a.level);
	}
	return result;
}

// ─── 火山の位置情報 ──────────────────────────────────────────────────────────

interface VolcanoListEntry {
	code?: string;
	/** ["44.133", "145.161"] のように文字列で入る */
	latlon?: [string, string];
}

// 火山コード → 緯度経度（Promiseをキャッシュして並列fetch競合・永続汚染を防ぐ）
let volcanoCoordsPromise: Promise<Map<string, { lat: number; lng: number }>> | null = null;

function getVolcanoCoords(): Promise<Map<string, { lat: number; lng: number }>> {
	if (!volcanoCoordsPromise) {
		volcanoCoordsPromise = fetchJson<VolcanoListEntry[]>(VOLCANO_LIST_URL, 'JMAVolcanoList')
			.then((list) => {
				const map = new Map<string, { lat: number; lng: number }>();
				for (const v of Array.isArray(list) ? list : []) {
					if (!v.code || !v.latlon) continue;
					const lat = Number(v.latlon[0]);
					const lng = Number(v.latlon[1]);
					if (Number.isFinite(lat) && Number.isFinite(lng)) map.set(v.code, { lat, lng });
				}
				return map;
			})
			.catch((e) => {
				// 座標が取れないと全火山が距離減衰なし（係数1.0）になり、
				// 約1000km南の西之島で東京が最上位になる問題が復活してしまう。
				// 黙って劣化させず、火山スコアごと失敗させて failedApis に出す。
				volcanoCoordsPromise = null;
				throw e;
			});
	}
	return volcanoCoordsPromise;
}

/**
 * 距離から火山スコアの減衰係数を求める。
 * `VOLCANO_FULL_SCORE_KM` 以内は1.0、そこから `VOLCANO_ZERO_SCORE_KM` まで線形に0へ。
 */
export function volcanoDistanceFactor(distanceKm: number): number {
	if (distanceKm <= VOLCANO_FULL_SCORE_KM) return 1;
	if (distanceKm >= VOLCANO_ZERO_SCORE_KM) return 0;
	const span = VOLCANO_ZERO_SCORE_KM - VOLCANO_FULL_SCORE_KM;
	return 1 - (distanceKm - VOLCANO_FULL_SCORE_KM) / span;
}

/**
 * 地域の代表地点からの距離で火山スコアを減衰させる。
 * 係数0になった火山（＝実質的に無関係な遠方の噴火）は落とす。
 * 座標が不明な火山は都道府県一致を信じて満点で残す（取りこぼしを避ける）。
 */
export function applyVolcanoDistanceDecay(
	alerts: ResolvedVolcanoAlert[],
	region: { lat: number; lng: number },
	coords: Map<string, { lat: number; lng: number }>
): VolcanoAlert[] {
	return alerts
		.map(({ name, code, level, levelText, isLevelOperated }) => {
			const c = coords.get(code);
			const distanceKm = c ? haversineKm(region.lat, region.lng, c.lat, c.lng) : null;
			return {
				name,
				level,
				levelText,
				isLevelOperated,
				distanceKm,
				distanceFactor: distanceKm === null ? 1 : volcanoDistanceFactor(distanceKm),
			};
		})
		.filter((a) => a.distanceFactor > 0);
}

/** 全地域の噴火警報を取得する（警報一覧＋火山位置の2リクエスト、位置はキャッシュされる）。 */
export async function fetchVolcanoAll(regions: Region[]): Promise<VolcanoData[]> {
	const [data, coords] = await Promise.all([
		fetchJson<VolcanoWarningEntry[]>(VOLCANO_WARNING_URL, 'JMAVolcano'),
		getVolcanoCoords(),
	]);
	const byPref = resolveVolcanoesByPrefecture(Array.isArray(data) ? data : []);
	return regions.map((r) => ({
		alerts: applyVolcanoDistanceDecay(byPref.get(prefCodeOf(r)) ?? [], r, coords),
	}));
}

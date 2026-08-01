import type { Region, TsunamiData, TsunamiLevel } from '../types';
import { fetchJson } from './http';

/**
 * 気象庁の津波警報・注意報・予報（VTSE41）を取得し、地域ごとの津波レベルを求める。
 *
 * 一覧JSON（`list.json`）のイベント情報は全国共通なので、そのまま適用すると内陸の地域にも
 * 津波スコアが乗ってしまう。詳細JSONに含まれる「津波予報区」単位の情報まで降りて、
 * `Region.tsunamiAreaCodes` と突き合わせる。
 */

const TSUNAMI_LIST_URL = 'https://www.jma.go.jp/bosai/tsunami/data/list.json';
const TSUNAMI_DETAIL_BASE = 'https://www.jma.go.jp/bosai/tsunami/data/';

/** 津波警報・注意報・予報の電文種別。この種別だけが予報区ごとのレベルを持つ。 */
const FORECAST_INFO_TYPE = 'VTSE41';

interface TsunamiListEntry {
	json?: string;
	at?: string;
	rdt?: string;
}

interface TsunamiForecastItem {
	Area?: { Name?: string; Code?: string };
	Category?: { Kind?: { Name?: string; Code?: string } };
}

interface TsunamiDetail {
	Head?: { ReportDateTime?: string };
	Body?: {
		Tsunami?: {
			Forecast?: {
				Item?: TsunamiForecastItem[];
			};
		};
	};
}

/**
 * 津波予報区の警報種別名からレベルを判定する。
 * コード表は電文種別ごとに揺れがあるため、自己記述的な名称を優先して解釈する。
 */
export function tsunamiLevelFromKindName(name: string | undefined): TsunamiLevel {
	if (!name) return 'none';
	if (name.includes('解除') || name.includes('心配なし')) return 'none';
	if (name.includes('大津波警報')) return 'major';
	if (name.includes('津波警報')) return 'warning';
	if (name.includes('津波注意報')) return 'advisory';
	if (name.includes('津波予報')) return 'forecast';
	return 'none';
}

const TSUNAMI_LEVEL_RANK: Record<TsunamiLevel, number> = {
	none: 0,
	forecast: 1,
	advisory: 2,
	warning: 3,
	major: 4,
};

/**
 * 詳細JSONを「津波予報区コード → 発表内容」に畳み込む。
 * 予報区と地域の対応は `Region.tsunamiAreaCodes`（気象庁の公式コード表から起こしたもの）が持つ。
 */
export function resolveTsunamiByArea(detail: TsunamiDetail): Map<string, TsunamiData> {
	const result = new Map<string, TsunamiData>();
	const items = detail.Body?.Tsunami?.Forecast?.Item ?? [];
	const reportedAt = detail.Head?.ReportDateTime
		? new Date(detail.Head.ReportDateTime).getTime()
		: null;
	const issuedAt = reportedAt !== null && Number.isFinite(reportedAt) ? reportedAt : null;

	for (const item of items) {
		const level = tsunamiLevelFromKindName(item.Category?.Kind?.Name);
		if (level === 'none') continue;
		const areaCode = item.Area?.Code;
		if (!areaCode) continue;
		const current = result.get(areaCode);
		if (!current || TSUNAMI_LEVEL_RANK[level] > TSUNAMI_LEVEL_RANK[current.level]) {
			result.set(areaCode, { level, areaName: item.Area?.Name ?? null, issuedAt });
		}
	}

	return result;
}

const NO_TSUNAMI: TsunamiData = { level: 'none', areaName: null, issuedAt: null };

/** 地域に属する予報区のうち、最も強い津波レベルを採用する。 */
export function strongestTsunamiFor(
	areaCodes: readonly string[],
	byArea: Map<string, TsunamiData>
): TsunamiData {
	let best = NO_TSUNAMI;
	for (const code of areaCodes) {
		const found = byArea.get(code);
		if (found && TSUNAMI_LEVEL_RANK[found.level] > TSUNAMI_LEVEL_RANK[best.level]) best = found;
	}
	return best;
}

/**
 * 全地域の津波情報を取得する。
 * 最新の津波警報・注意報・予報（VTSE41）1件が現在の発表状況を表すため、それだけを読む。
 * 解除された予報区は `none` になるので、古い電文が残っていても誤検知しない。
 */
export async function fetchTsunamiAll(regions: Region[]): Promise<TsunamiData[]> {
	const list = await fetchJson<TsunamiListEntry[]>(TSUNAMI_LIST_URL, 'JMATsunami');
	const entries = Array.isArray(list) ? list : [];
	const latest = entries.find((e) => e.json?.includes(FORECAST_INFO_TYPE));
	if (!latest?.json) return regions.map(() => NO_TSUNAMI);

	const detail = await fetchJson<TsunamiDetail>(
		TSUNAMI_DETAIL_BASE + latest.json,
		'JMATsunamiDetail'
	);
	const byArea = resolveTsunamiByArea(detail);

	return regions.map((r) => strongestTsunamiFor(r.tsunamiAreaCodes, byArea));
}

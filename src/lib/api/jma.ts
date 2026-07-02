import type { JmaData, JmaWarningArea } from '../types';
import { fetchJson } from './http';
import { runWithConcurrency } from '../utils/concurrent';

// JMA警報コード → 日本語名称（気象庁標準）
const WARNING_CODE_TO_NAME: Record<string, string> = {
	'02': '大雨特別警報',
	'03': '大雪特別警報',
	'04': '暴風特別警報',
	'05': '暴風雪特別警報',
	'06': '波浪特別警報',
	'07': '高潮特別警報',
	'10': '大雨警報（浸水害）',
	'11': '洪水警報',
	'12': '大雨警報（土砂災害）',
	'13': '大雨警報',
	'14': '雷注意報',
	'15': '強風注意報',
	'16': '風雪注意報',
	'17': '大雪警報',
	'18': '波浪警報',
	'19': '高潮警報',
	'20': '大雨注意報',
	'21': '洪水注意報',
	'22': '大雪注意報',
	'23': '風雪注意報',
	'24': '波浪注意報',
	'25': '高潮注意報',
	'32': '暴風警報',
	'33': '暴風雪警報',
};

// 特別警報コード（最高レベル）
const SPECIAL_CODES = new Set(['02', '03', '04', '05', '06', '07']);
// 警報コード（中レベル）
const WARNING_CODES = new Set(['10', '11', '12', '13', '17', '18', '19', '32', '33']);

interface JmaWarningEntry {
	code?: string;
	status: string;
}

interface JmaArea {
	code: string;
	warnings: JmaWarningEntry[];
}

interface JmaAreaType {
	areas: JmaArea[];
}

interface JmaWarningResponse {
	areaTypes: JmaAreaType[];
}

interface AreaInfo {
	name: string;
}

interface AreaJson {
	class10s: Record<string, AreaInfo>;
}

// 一次細分区域コード → 名称（Promiseをキャッシュして並列fetch競合・永続汚染を防ぐ）
let areaNamePromise: Promise<Record<string, string>> | null = null;

function getAreaNames(): Promise<Record<string, string>> {
	if (!areaNamePromise) {
		areaNamePromise = fetchJson<AreaJson>(
			'https://www.jma.go.jp/bosai/common/const/area.json',
			'JMAArea'
		)
			.then((data) =>
				Object.fromEntries(Object.entries(data.class10s).map(([code, info]) => [code, info.name]))
			)
			.catch(() => {
				areaNamePromise = null;
				return {} as Record<string, string>;
			});
	}
	return areaNamePromise;
}

function alertLevelFromCodes(activeCodes: string[]): JmaData['alertLevel'] {
	if (activeCodes.some((c) => SPECIAL_CODES.has(c))) return 'special';
	if (activeCodes.some((c) => WARNING_CODES.has(c))) return 'warning';
	if (activeCodes.length > 0) return 'advisory';
	return 'none';
}

export async function fetchJmaWarnings(prefCode: string): Promise<JmaData> {
	const [warningData, areaNames] = await Promise.all([
		fetchJson<JmaWarningResponse>(
			`https://www.jma.go.jp/bosai/warning/data/warning/${prefCode}.json`,
			'JMA'
		),
		getAreaNames(),
	]);

	// 一次細分区域（areaTypes[0]）を使用
	const primaryAreas: JmaArea[] = warningData.areaTypes?.[0]?.areas ?? [];

	const allActiveCodes: string[] = [];
	const activeAreas: JmaWarningArea[] = [];
	for (const area of primaryAreas) {
		const codes = (area.warnings ?? [])
			.filter((w) => w.code && (w.status === '発表' || w.status === '継続'))
			.map((w) => w.code as string);
		if (codes.length > 0) {
			allActiveCodes.push(...codes);
			activeAreas.push({
				name: areaNames[area.code] ?? area.code,
				warnings: codes.map((c) => WARNING_CODE_TO_NAME[c] ?? `警報(${c})`),
			});
		}
	}

	return { areas: activeAreas, alertLevel: alertLevelFromCodes(allActiveCodes) };
}

/**
 * 全都道府県の警報データを同時実行数5で取得する。
 */
export async function fetchAllJmaWarnings(
	regions: Array<{ jmaCode: string }>
): Promise<(JmaData | null)[]> {
	return runWithConcurrency(regions, (r) => fetchJmaWarnings(r.jmaCode), 5);
}

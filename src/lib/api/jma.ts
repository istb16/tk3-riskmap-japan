import type { JmaData, JmaWarningArea } from '../types';
import { fetchJson } from './http';
import { runWithConcurrency } from '../utils/concurrent';

interface JmaWarningEntry {
	type: string;
	status: string;
}

interface JmaArea {
	code: string;
	name: string;
	warnings: JmaWarningEntry[];
}

interface JmaAreaType {
	areas: JmaArea[];
}

interface JmaWarningResponse {
	areaTypes: JmaAreaType[];
}

function alertLevelFromWarnings(warnings: string[]): JmaData['alertLevel'] {
	if (warnings.some((w) => w.includes('特別警報'))) return 'special';
	if (warnings.some((w) => w.includes('警報'))) return 'warning';
	if (warnings.some((w) => w.includes('注意報'))) return 'advisory';
	return 'none';
}

export async function fetchJmaWarnings(prefCode: string): Promise<JmaData> {
	const url = `https://www.jma.go.jp/bosai/warning/data/warning/${prefCode}.json`;
	const data = await fetchJson<JmaWarningResponse>(url, 'JMA');

	// 一次細分区域（areaTypes[0]）を使用
	const primaryAreas: JmaArea[] = data.areaTypes?.[0]?.areas ?? [];

	const activeAreas: JmaWarningArea[] = primaryAreas
		.map((area) => ({
			name: area.name,
			warnings: (area.warnings ?? [])
				.filter((w) => w.status === '発表' || w.status === '継続')
				.map((w) => w.type)
		}))
		.filter((area) => area.warnings.length > 0);

	const allWarnings = activeAreas.flatMap((a) => a.warnings);
	return { areas: activeAreas, alertLevel: alertLevelFromWarnings(allWarnings) };
}

/**
 * 全都道府県の警報データを同時実行数5で取得する。
 * 一度に47リクエストを飛ばさず、5本ずつ処理してAPIへの負荷を抑える。
 */
export async function fetchAllJmaWarnings(
	regions: Array<{ jmaCode: string }>
): Promise<(JmaData | null)[]> {
	return runWithConcurrency(regions, (r) => fetchJmaWarnings(r.jmaCode), 5);
}

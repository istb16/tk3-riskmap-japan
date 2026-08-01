import type { Region, WeatherCategory } from '../types';
import { fetchJson } from './http';

/**
 * 気象庁の「早期注意情報（警報級の可能性）」を取得する。
 *
 * 早期注意情報は警報JSON（`warning/{officeCode}.json`）には含まれない。
 * 当初は Open-Meteo の天気コードから推定していたが、気象庁が全国分を1リクエストで
 * 公開しているのでそちらを使う。しかも一次細分区域コード単位で、
 * 大雨・土砂災害・雪・風・波と現象別に分かれておりカテゴリ設計とそのまま対応する。
 *
 * 都道府県ごとの `probability/{officeCode}.json` は最終発表時点のまま更新されず
 * （実測で2か月前の内容が残っていた）、有効期限も判断できないため使わない。
 * 一括版の `r8/map.json` は `reportDatetime` が最新に保たれている。
 */

const EARLY_WARNING_URL = 'https://www.jma.go.jp/bosai/probability/data/probability/r8/map.json';

/** 「警報級の可能性」の程度。気象庁は「なし」「中」「高」で表す。 */
export type EarlyWarningProbability = '中' | '高';

export interface EarlyWarningItem {
	/** 現象名（「大雨」「土砂災害」「雪」など） */
	phenomenon: string;
	probability: EarlyWarningProbability;
}

/** 一次細分区域ごとの、カテゴリ別の警報級の可能性。 */
export type EarlyWarningData = Partial<Record<WeatherCategory, EarlyWarningItem>>;

interface ProbabilityProperty {
	type?: string;
	probabilities?: string[];
}

interface ProbabilityArea {
	code?: string;
	properties?: ProbabilityProperty[];
}

interface ProbabilityTimeSeries {
	areas?: ProbabilityArea[];
}

interface ProbabilityBlock {
	reportDatetime?: string;
	timeSeries?: ProbabilityTimeSeries[];
}

/** 現象名 → スコアのカテゴリ。土砂災害・洪水は大雨に起因するので雨に含める。 */
export function categoryForPhenomenon(type: string): WeatherCategory | null {
	if (type.includes('雪')) return type.includes('風') ? 'wind' : 'snow';
	if (type.includes('風')) return 'wind';
	if (type.includes('波') || type.includes('潮位') || type.includes('高潮')) return 'coast';
	if (type.includes('雨') || type.includes('土砂災害') || type.includes('洪水')) return 'rain';
	return null;
}

/** 「〜の警報級の可能性」から現象名だけを取り出す（「大雨の警報級の可能性」→「大雨」）。 */
function phenomenonName(type: string): string {
	return type.replace(/の警報級の可能性$/, '');
}

const PROBABILITY_RANK: Record<EarlyWarningProbability, number> = { 中: 1, 高: 2 };

function parseProbability(value: string): EarlyWarningProbability | null {
	return value === '中' || value === '高' ? value : null;
}

/**
 * 一括JSONを「一次細分区域コード → カテゴリ別の警報級の可能性」に畳み込む。
 *
 * 時系列は今日〜明後日の7コマあるが、早期注意情報はそもそも先を見越した情報なので
 * 全コマの最大を採る。同一カテゴリに複数の現象があれば可能性の高い方を採用する。
 * 外側の配列に配列が混ざることがあるため平坦化して読む。
 */
export function resolveEarlyWarnings(payload: unknown): Map<string, EarlyWarningData> {
	const result = new Map<string, EarlyWarningData>();
	if (!Array.isArray(payload)) return result;

	const blocks: ProbabilityBlock[] = payload.flatMap((entry) =>
		Array.isArray(entry) ? (entry as ProbabilityBlock[]) : [entry as ProbabilityBlock]
	);

	for (const block of blocks) {
		for (const series of block?.timeSeries ?? []) {
			for (const area of series.areas ?? []) {
				if (!area.code) continue;
				for (const property of area.properties ?? []) {
					if (!property.type) continue;
					const category = categoryForPhenomenon(property.type);
					if (!category) continue;

					let strongest: EarlyWarningProbability | null = null;
					for (const raw of property.probabilities ?? []) {
						const probability = parseProbability(raw);
						if (!probability) continue;
						if (!strongest || PROBABILITY_RANK[probability] > PROBABILITY_RANK[strongest]) {
							strongest = probability;
						}
					}
					if (!strongest) continue;

					const data = result.get(area.code) ?? {};
					const current = data[category];
					if (!current || PROBABILITY_RANK[strongest] > PROBABILITY_RANK[current.probability]) {
						data[category] = { phenomenon: phenomenonName(property.type), probability: strongest };
					}
					result.set(area.code, data);
				}
			}
		}
	}

	return result;
}

/** 地域が持つ一次細分区域のうち、カテゴリごとに最も可能性の高いものをまとめる。 */
export function strongestEarlyWarningFor(
	class10Codes: readonly string[],
	byArea: Map<string, EarlyWarningData>
): EarlyWarningData {
	const merged: EarlyWarningData = {};
	for (const code of class10Codes) {
		const data = byArea.get(code);
		if (!data) continue;
		for (const [category, item] of Object.entries(data) as [WeatherCategory, EarlyWarningItem][]) {
			const current = merged[category];
			if (!current || PROBABILITY_RANK[item.probability] > PROBABILITY_RANK[current.probability]) {
				merged[category] = item;
			}
		}
	}
	return merged;
}

/** 全地域の早期注意情報を1リクエストで取得する。 */
export async function fetchEarlyWarningAll(regions: Region[]): Promise<EarlyWarningData[]> {
	const payload = await fetchJson<unknown>(EARLY_WARNING_URL, 'JMAEarlyWarning');
	const byArea = resolveEarlyWarnings(payload);
	return regions.map((r) => strongestEarlyWarningFor(r.class10Codes, byArea));
}

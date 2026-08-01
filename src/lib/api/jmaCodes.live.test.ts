import { describe, it, expect } from 'vitest';
import { REGIONS } from '../regions';
import { isKnownWarningCode, getCityCodesByClass10 } from './jma';
import { isKnownVolcanoCode } from './volcano';
import { categoryForPhenomenon } from './earlyWarning';
import { runWithConcurrency } from '../utils/concurrent';

/**
 * 気象庁のコード表がハードコードした内容とズレていないかを、実際のAPIレスポンスで検証する。
 *
 * コード表は `xml.kishou.go.jp` の配布物から起こした静的データなので、気象庁が改訂しても
 * こちらは自動では変わらない。「実際に流通しているコードのうち、こちらが知らないものはないか」を
 * 突き合わせることで、取りこぼしに気づけるようにする。
 *
 * **ネットワークにアクセスするため通常のテスト実行からは除外している。**
 * `npm run verify:jma` で実行する。失敗＝気象庁側が変わった可能性が高いので、
 * <https://xml.kishou.go.jp/tec_material.html> の最新のコード表を確認すること。
 */

const TIMEOUT = 120_000;

async function getJson<T>(url: string): Promise<T> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url} → ${res.status}`);
	return (await res.json()) as T;
}

describe('気象庁コード表の追随確認（ネットワークアクセスあり）', () => {
	it(
		'流通している気象警報コードがすべて公式コード表に載っている',
		async () => {
			interface WarningJson {
				areaTypes?: Array<{ areas?: Array<{ warnings?: Array<{ code?: string }> }> }>;
			}
			const offices = [...new Set(REGIONS.map((r) => r.jmaCode))];
			const results = await runWithConcurrency(
				offices,
				(code) =>
					getJson<WarningJson>(`https://www.jma.go.jp/bosai/warning/data/warning/${code}.json`),
				5
			);

			// runWithConcurrency は失敗を null にするため、取得できた件数を先に確認する
			// （全滅していると「未知コードなし」で空振りパスしてしまう）
			expect(results.filter(Boolean).length).toBe(offices.length);

			const unknown = new Set<string>();
			const seen = new Set<string>();
			for (const data of results) {
				for (const area of data?.areaTypes?.[0]?.areas ?? []) {
					for (const w of area.warnings ?? []) {
						if (!w.code) continue;
						seen.add(w.code);
						if (!isKnownWarningCode(w.code)) unknown.add(w.code);
					}
				}
			}
			expect(seen.size).toBeGreaterThan(0);
			expect([...unknown].sort()).toEqual([]);
		},
		TIMEOUT
	);

	it(
		'流通している噴火警報コードがすべて公式コード表に載っている',
		async () => {
			interface VolcanoJson {
				volcanoInfos?: Array<{ type?: string; items?: Array<{ code?: string }> }>;
			}
			const data = await getJson<VolcanoJson[]>(
				'https://www.jma.go.jp/bosai/volcano/data/warning.json'
			);
			const unknown = new Set<string>();
			const seen = new Set<string>();
			for (const entry of data) {
				const target = (entry.volcanoInfos ?? []).find(
					(i) => i.type === '噴火警報・予報（対象火山）'
				);
				for (const item of target?.items ?? []) {
					if (!item.code) continue;
					seen.add(item.code);
					if (!isKnownVolcanoCode(item.code)) unknown.add(item.code);
				}
			}
			expect(seen.size).toBeGreaterThan(0);
			expect([...unknown].sort()).toEqual([]);
		},
		TIMEOUT
	);

	it(
		'早期注意情報の現象名がすべてカテゴリに対応づく',
		async () => {
			const payload = await getJson<unknown>(
				'https://www.jma.go.jp/bosai/probability/data/probability/r8/map.json'
			);
			const blocks = (Array.isArray(payload) ? payload : []).flatMap((e) =>
				Array.isArray(e) ? e : [e]
			) as Array<{
				timeSeries?: Array<{ areas?: Array<{ properties?: Array<{ type?: string }> }> }>;
			}>;
			const unmapped = new Set<string>();
			const seen = new Set<string>();
			for (const block of blocks) {
				for (const series of block?.timeSeries ?? []) {
					for (const area of series.areas ?? []) {
						for (const p of area.properties ?? []) {
							if (!p.type) continue;
							seen.add(p.type);
							if (!categoryForPhenomenon(p.type)) unmapped.add(p.type);
						}
					}
				}
			}
			expect(seen.size).toBeGreaterThan(0);
			expect([...unmapped].sort()).toEqual([]);
		},
		TIMEOUT
	);

	it(
		'地域が参照する一次細分区域がすべて気象庁の区域一覧に存在する',
		async () => {
			const byClass10 = await getCityCodesByClass10();
			expect(Object.keys(byClass10).length).toBeGreaterThan(0);
			const missing = REGIONS.flatMap((r) => r.class10Codes).filter((code) => !byClass10[code]);
			expect(missing).toEqual([]);
		},
		TIMEOUT
	);

	it(
		'気象庁の一次細分区域を1つも取りこぼしていない',
		async () => {
			// 逆向きの検査。北海道を1地域にしていた頃は釧路・根室・十勝など13区域が
			// どの地域にも属しておらず、警報も震度もどこにも反映されていなかった。
			// 「参照先が存在するか」だけでは検知できないので、全国側から突き合わせる。
			const byClass10 = await getCityCodesByClass10();
			const all = Object.keys(byClass10);
			expect(all.length).toBeGreaterThan(0);
			const ours = new Set(REGIONS.flatMap((r) => r.class10Codes));
			const uncovered = all.filter((code) => !ours.has(code));
			expect(uncovered).toEqual([]);
		},
		TIMEOUT
	);

	it(
		'早期注意情報が地域の全区域をカバーしている',
		async () => {
			const payload = await getJson<unknown>(
				'https://www.jma.go.jp/bosai/probability/data/probability/r8/map.json'
			);
			const blocks = (Array.isArray(payload) ? payload : []).flatMap((e) =>
				Array.isArray(e) ? e : [e]
			) as Array<{ timeSeries?: Array<{ areas?: Array<{ code?: string }> }> }>;
			const covered = new Set<string>();
			for (const block of blocks) {
				for (const series of block?.timeSeries ?? []) {
					for (const area of series.areas ?? []) if (area.code) covered.add(area.code);
				}
			}
			expect(covered.size).toBeGreaterThan(0);
			const missing = [...new Set(REGIONS.flatMap((r) => r.class10Codes))].filter(
				(c) => !covered.has(c)
			);
			expect(missing).toEqual([]);
		},
		TIMEOUT
	);

	it(
		'地震情報の都道府県コードが2桁のままである',
		async () => {
			interface QuakeEntry {
				int?: Array<{ code?: string }>;
			}
			const list = await getJson<QuakeEntry[]>('https://www.jma.go.jp/bosai/quake/data/list.json');
			expect(list.length).toBeGreaterThan(0);
			const lengths = new Set<number>();
			for (const entry of list) {
				for (const i of entry.int ?? []) if (i.code) lengths.add(i.code.length);
			}
			expect([...lengths]).toEqual([2]);
		},
		TIMEOUT
	);
});

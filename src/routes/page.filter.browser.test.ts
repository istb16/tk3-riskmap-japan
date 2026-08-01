import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import type { Writable } from 'svelte/store';
import { REGIONS } from '$lib/regions';
import { pinnedIds } from '$lib/stores/pinnedStore';
import { riskBand } from '$lib/services/scoringRules';
import { APP_VERSION } from '$lib/utils/buildInfo';
import type { RegionRisk } from '$lib/types';
import Page from './+page.svelte';

/**
 * 地域フィルタと地図マーカーを本物のブラウザで動かす。
 *
 * ブラウザでしか確かめられないこと:
 * - Leaflet が実際に生成したマーカーの**実寸**（危険度でサイズが変わること）
 * - 絞り込みに地図が追随すること（0件のときに前のマーカーが残らないこと）
 * - `getComputedStyle` による所属都道府県の文字サイズ比
 */
vi.mock('$lib/stores/riskStore', async () => {
	const { writable } = await import('svelte/store');
	return {
		regions: writable<RegionRisk[]>([]),
		rankedRegions: writable<RegionRisk[]>([]),
		loading: writable(false),
		lastUpdated: writable<number | null>(null),
		error: writable<string | null>(null),
		selectedRegion: writable<RegionRisk | null>(null),
		startAutoRefresh: () => {},
		stopAutoRefresh: () => {},
		refreshAll: async () => {},
	};
});

/**
 * **タイル画像を取りに行かせない。** テストはネットワークに出ない（CLAUDE.md）。
 * ページは `import('leaflet')` で遅延読み込みするが、モジュールキャッシュを共有するので
 * ここで prototype を差し替えておけば地図の初期化時にも効く。
 *
 * 差し替えるのは URL の生成だけにする —— `createTile` ごと置き換えると Leaflet 内部の
 * 管理（`_leaflet_pos` など）が入らず、タイル配置時に例外になる。
 */
const TRANSPARENT_PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const leaflet = (await import('leaflet')).default;
leaflet.TileLayer.prototype.getTileUrl = () => TRANSPARENT_PNG;

const riskStore = await import('$lib/stores/riskStore');
const ranked = riskStore.rankedRegions as unknown as Writable<RegionRisk[]>;
const lastUpdated = riskStore.lastUpdated as unknown as Writable<number | null>;
const pinned = pinnedIds as Writable<ReadonlySet<string>>;

function makeRisk(id: string, riskScore: number): RegionRisk {
	const region = REGIONS.find((r) => r.id === id);
	if (region === undefined) throw new Error(`地域が見つからない: ${id}`);
	return {
		id: region.id,
		name: region.name,
		lat: region.lat,
		lng: region.lng,
		riskScore,
		rawScore: riskScore,
		scoreItems: [],
		riskTypes: ['earthquake'],
		reasons: ['テスト理由'],
		updatedAt: 0,
		details: {},
	};
}

/** スコア降順。北海道が2件・沖縄が1件・0点が1件含まれるように選ぶ。 */
const FIXTURES = [
	makeRisk('kumamoto', 62), // 危険
	makeRisk('hokkaido-kushiro', 41), // 警戒
	makeRisk('hokkaido-tokachi', 18), // 注意
	makeRisk('tokyo', 6), // 平穏
	makeRisk('okinawa', 0), // マーカーを描かない
];

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];

const rankNames = () =>
	$$('.rank-list .rank-name').map((el) => el.textContent?.replace(/\s+/g, '') ?? '');
const rankNums = () => $$('.rank-list .rank-num').map((el) => el.textContent?.trim() ?? '');
const count = () => $('.filter-count')?.textContent?.trim();
const markers = () => $$('.leaflet-marker-icon');

async function setFilter(value: string) {
	const input = $<HTMLInputElement>('.filter-input');
	if (input === null) throw new Error('絞り込み入力欄がない');
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await flush();
}

async function flush(times = 4) {
	for (let i = 0; i < times; i += 1) await tick();
}

beforeEach(() => {
	localStorage.clear();
	pinned.set(new Set());
	lastUpdated.set(null);
	ranked.set(FIXTURES);
});

describe('地域フィルタ', () => {
	it('漢字で絞り込める', async () => {
		await render(Page);
		await flush();
		expect(rankNames()).toHaveLength(5);

		await setFilter('北海道');
		expect(rankNames()).toEqual(['釧路・根室（北海道）', '十勝（北海道）']);
		expect(count()).toBe('2地域');
	});

	// IME は変換を確定する前に入力欄の値がひらがなになっている。
	// かなを照合対象に持っていないと「打ちながら絞り込む」が成立しない
	it('ひらがな（変換確定前の状態）で絞り込める', async () => {
		await render(Page);
		await setFilter('くしろ');
		expect(rankNames()).toEqual(['釧路・根室（北海道）']);

		await setFilter('ほっかいどう');
		expect(rankNames()).toHaveLength(2);
	});

	it('カタカナ・全角も同じ結果になる（正規化）', async () => {
		await render(Page);
		await setFilter('クシロ');
		expect(rankNames()).toEqual(['釧路・根室（北海道）']);

		await setFilter('ｸｼﾛ');
		expect(rankNames()).toEqual(['釧路・根室（北海道）']);
	});

	it('順位番号は全国順位のまま、メダルは全国3位以内にだけ付く', async () => {
		await render(Page);
		expect(rankNums()).toEqual(['🥇', '🥈', '🥉', '#4', '#5']);

		await setFilter('北海道');
		// 釧路・根室は全国2位なので🥈のまま、十勝は#3ではなく🥉（全国3位）
		expect(rankNums()).toEqual(['🥈', '🥉']);

		await setFilter('東京');
		// 全国4位。絞り込み内で1位になっても🥇は付けない
		expect(rankNums()).toEqual(['#4']);
	});

	it('0件のときは静かな1行だけを出す', async () => {
		await render(Page);
		await setFilter('存在しない地名');

		expect(rankNames()).toHaveLength(0);
		expect(count()).toBe('該当なし');
		expect($('.rank-empty')?.textContent).toContain('存在しない地名');
	});

	it('Escape で絞り込みが解除される', async () => {
		await render(Page);
		await setFilter('北海道');
		expect(rankNames()).toHaveLength(2);

		const input = $<HTMLInputElement>('.filter-input');
		input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await flush();

		expect(input?.value).toBe('');
		expect(rankNames()).toHaveLength(5);
	});

	it('✕ボタンは絞り込み中だけ現れ、押すと解除される', async () => {
		await render(Page);
		expect($('.filter-clear')).toBeNull();

		await setFilter('北海道');
		const clear = $<HTMLButtonElement>('.filter-clear');
		expect(clear).not.toBeNull();

		clear?.click();
		await flush();
		expect($('.filter-clear')).toBeNull();
		expect(rankNames()).toHaveLength(5);
	});

	// バナーはフィルタが危険を隠さないための安全網。絞り込みの影響を受けてはいけない
	it('最高危険地域のバナーは絞り込みに影響されない', async () => {
		await render(Page);
		const banner = () => $('.top-name')?.textContent?.replace(/\s+/g, '');
		expect(banner()).toBe('熊本');

		await setFilter('東京');
		expect(rankNames()).toEqual(['東京']);
		expect(banner()).toBe('熊本');
	});
});

/**
 * ヘッダーのビルド情報。どのデプロイが公開されているかを画面から判別するために出す。
 * `define` が各設定に渡っていないと参照時点で落ちるので、描画できること自体が検査になる。
 */
describe('ヘッダーのビルド情報', () => {
	it('サイト名のすぐ右にバージョンとビルド日を出す', async () => {
		await render(Page);
		const text = $('.build-info')?.textContent?.trim() ?? '';
		expect(text).toMatch(/^\(v\d+\.\d+\.\d+ at \d{4}\/\d{2}\/\d{2}\)$/);
		expect(text).toContain(`v${APP_VERSION}`);

		// h1 の直後の兄弟であること（タイトルから離れると何のバージョンか読めない）
		expect($('h1')?.nextElementSibling).toBe($('.build-info'));
	});

	// どちらも時刻なので、素で並べるとどちらが何か読めない
	it('データ取得時刻と役割が区別できる', async () => {
		lastUpdated.set(Date.parse('2026-08-02T03:04:00+09:00'));
		await render(Page);
		const build = $('.build-info');
		const status = $('.status-text');
		expect(status).not.toBeNull();

		expect(build?.getAttribute('title')).toContain('ビルド日時');
		expect(status?.textContent?.trim()).toMatch(/^Updated: \d{2}:\d{2}$/);
		expect(status?.getAttribute('title')).toBe('データ取得時刻');
		// 同じ文字列が並んで見分けられない状態になっていない
		expect(build?.textContent?.trim()).not.toBe(status?.textContent?.trim());
	});

	it('ハザード表示より小さく・控えめに描かれる', async () => {
		await render(Page);
		const build = $('.build-info');
		const title = $('h1');
		if (build === null || title === null) throw new Error('ヘッダーの構成が壊れている');

		const buildSize = parseFloat(getComputedStyle(build).fontSize);
		expect(buildSize).toBeLessThan(parseFloat(getComputedStyle(title).fontSize));
		expect(parseFloat(getComputedStyle(build).opacity)).toBeLessThan(1);
	});
});

/**
 * 所属都道府県の接尾辞（「釧路・根室（北海道）」の括弧部分）は一段落として描く。
 * em 指定なので、ランキング・バナー・詳細パネルのどこでも同じ比率になる。
 */
describe('地域名の描画', () => {
	it('所属都道府県は地域名より小さく描かれる', async () => {
		await render(Page);
		await setFilter('釧路');

		const nameEl = $('.rank-list .rank-name');
		const prefEl = $('.rank-list .rank-name .name-pref');
		if (nameEl === null || prefEl === null) throw new Error('地域名の構成が壊れている');

		const base = parseFloat(getComputedStyle(nameEl).fontSize);
		const pref = parseFloat(getComputedStyle(prefEl).fontSize);
		expect(pref).toBeLessThan(base);
		expect(pref / base).toBeCloseTo(0.7, 1);
	});

	it('都道府県そのものの地域には接尾辞が付かない', async () => {
		await render(Page);
		await setFilter('東京');
		expect($('.rank-list .name-pref')).toBeNull();
	});
});

/**
 * 地図マーカー。危険度を色とサイズの両方で符号化しているので、
 * 実際に描かれた円の直径が帯ごとに変わることを見る。
 */
describe('地図マーカー', () => {
	async function openMap() {
		await render(Page);
		await flush();
		const mapTab = $$('.tab-btn').find((b) => b.textContent?.includes('地図'));
		mapTab?.click();
		// Leaflet の動的 import とマーカー生成を待つ
		await vi.waitFor(() => expect(markers().length).toBeGreaterThan(0), { timeout: 5000 });
	}

	const circleOf = (marker: HTMLElement) => {
		const div = marker.querySelector<HTMLElement>('div');
		if (div === null) throw new Error('マーカーの中身がない');
		return div;
	};
	const diameter = (marker: HTMLElement) =>
		Math.round(circleOf(marker).getBoundingClientRect().width);
	const scoreOf = (marker: HTMLElement) => Number(circleOf(marker).textContent?.trim());

	it('スコア0の地域にはマーカーを描かない', async () => {
		await openMap();
		// 5地域のうち沖縄は0点なので4つ
		expect(markers()).toHaveLength(4);
		expect(
			markers()
				.map(scoreOf)
				.sort((a, b) => b - a)
		).toEqual([62, 41, 18, 6]);
	});

	it('危険度が高いマーカーほど大きく描かれる', async () => {
		await openMap();
		const bySize = markers()
			.map((m) => ({ score: scoreOf(m), size: diameter(m) }))
			.sort((a, b) => a.score - b.score);

		for (let i = 1; i < bySize.length; i += 1) {
			expect(bySize[i].size).toBeGreaterThanOrEqual(bySize[i - 1].size);
		}
		// 最高スコアと最低スコアでは実際に差がある（同じ大きさに潰れていない）
		expect(bySize.at(-1)?.size).toBeGreaterThan(bySize[0].size);
	});

	it('マーカーの直径は帯の定義（markerSizePx）どおり', async () => {
		await openMap();
		for (const marker of markers()) {
			expect(diameter(marker)).toBe(riskBand(scoreOf(marker)).markerSizePx);
		}
	});

	it('重なり順は危険度で決まる（小さい平穏の円が上に乗らない）', async () => {
		await openMap();
		const pairs = markers().map((m) => ({
			score: scoreOf(m),
			z: Number(getComputedStyle(m).zIndex),
		}));
		const sorted = [...pairs].sort((a, b) => a.score - b.score);
		for (let i = 1; i < sorted.length; i += 1) {
			expect(sorted[i].z).toBeGreaterThan(sorted[i - 1].z);
		}
	});

	it('絞り込みは地図にも効く', async () => {
		await openMap();
		expect(markers()).toHaveLength(4);

		await setFilter('北海道');
		await vi.waitFor(() => expect(markers()).toHaveLength(2));
		expect(
			markers()
				.map(scoreOf)
				.sort((a, b) => b - a)
		).toEqual([41, 18]);
	});

	/**
	 * 実装中に踏んだバグ。「描画対象が0件なら updateMarkers を呼ばない」と書くと、
	 * 前のマーカーが地図に残り続ける（リストは0件なのに地図には点が出ている状態）。
	 */
	it('絞り込みが0件になったら前のマーカーが残らない', async () => {
		await openMap();
		await setFilter('存在しない地名');
		await vi.waitFor(() => expect(markers()).toHaveLength(0));

		// 解除すると戻る
		await setFilter('');
		await vi.waitFor(() => expect(markers()).toHaveLength(4));
	});
});

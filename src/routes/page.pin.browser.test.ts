import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { get, type Writable } from 'svelte/store';
import { REGIONS } from '$lib/regions';
import { pinnedIds } from '$lib/stores/pinnedStore';
import { emptyCategoryLevels, emptyCategoryNames, type RegionRisk } from '$lib/types';
import Page from './+page.svelte';

/**
 * ピン留め機能をページ全体の中で動かす。
 *
 * ここに置くのは**本物のブラウザでしか確かめられないこと**に限る:
 * - `document.activeElement`（お気に入りから外すとフォーカスがどこへ行くか）
 * - `getComputedStyle` の解決結果（CSSカスタムプロパティの継承・実際の行の高さ）
 * - 実際のクリックが正しいボタンに当たること（行ボタンとピンボタンの取り違え）
 *
 * `riskStore` はモックしてネットワークに出さない。自動更新も止める。
 * `pinnedStore` は**本物**を使う（このページの検証対象そのものなので）。
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

const riskStore = await import('$lib/stores/riskStore');
const ranked = riskStore.rankedRegions as unknown as Writable<RegionRisk[]>;
const loading = riskStore.loading as unknown as Writable<boolean>;
const selected = riskStore.selectedRegion as unknown as Writable<RegionRisk | null>;
const pinned = pinnedIds as Writable<ReadonlySet<string>>;

function regionById(id: string) {
	const region = REGIONS.find((r) => r.id === id);
	if (region === undefined) throw new Error(`地域が見つからない: ${id}`);
	return region;
}

/** 実在する地域IDから RegionRisk を作る（フィルタのかな照合が本物のデータに依存するため）。 */
function makeRisk(
	id: string,
	riskScore: number,
	extra: { reasons?: string[]; jmaAreas?: string[] } = {}
): RegionRisk {
	const region = regionById(id);
	return {
		id: region.id,
		name: region.name,
		lat: region.lat,
		lng: region.lng,
		riskScore,
		rawScore: riskScore,
		scoreItems: [{ label: 'テスト', points: riskScore }],
		riskTypes: ['earthquake'],
		reasons: extra.reasons ?? [],
		updatedAt: 0,
		details:
			extra.jmaAreas === undefined
				? {}
				: {
						jma: {
							areas: extra.jmaAreas.map((name) => ({ name, warnings: ['大雨警報'] })),
							alertLevel: 'warning',
							categoryLevels: { ...emptyCategoryLevels(), rain: 'warning' },
							categoryNames: { ...emptyCategoryNames(), rain: '大雨警報' },
						},
					},
	};
}

/** 警戒帯（30点以上・展開される）/ 注意帯（コンパクト）/ 平穏 を1件ずつ。 */
const ALERT = makeRisk('kumamoto', 48, {
	reasons: ['震度7 M7.1', '地震活動が極めて活発'],
	jmaAreas: ['熊本県熊本地方'],
});
const CAUTION = makeRisk('hokkaido-kushiro', 19, { reasons: ['震度3'] });
const CALM = makeRisk('tokyo', 0);
const FIXTURES = [ALERT, CAUTION, CALM];

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];

/** お気に入りセクションの ol（存在すれば全国リストより前に来る）。 */
const lists = () => $$('.rank-list');
const favouriteList = () => (lists().length > 1 ? lists()[0] : null);
const nationalList = () => lists().at(-1) ?? null;
const rowsIn = (list: HTMLElement | null) => (list ? [...list.querySelectorAll('.rank-row')] : []);
const headings = () => $$('.section-title').map((el) => el.textContent?.trim());
const pinButtonFor = (list: HTMLElement | null, id: string) =>
	list?.querySelector<HTMLButtonElement>(`.pin-btn[data-region-id="${id}"]`) ?? null;

async function setFilter(value: string) {
	const input = $<HTMLInputElement>('.filter-input');
	if (input === null) throw new Error('絞り込み入力欄がない');
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
	await tick();
}

/**
 * Svelte の更新を流す。
 *
 * ピンの押下は `handlePinClick` が**内部でも `tick()` を待ってから**フォーカスを移すので、
 * 1回では足りない（実測: 1回目の直後は行が消えて `activeElement` が `<body>`、
 * 2回目でフォーカスが移る）。余裕を持って数回流す。
 */
async function flush(times = 4) {
	for (let i = 0; i < times; i += 1) await tick();
}

async function renderPage() {
	const result = await render(Page);
	await tick();
	return result;
}

beforeEach(() => {
	localStorage.clear();
	pinned.set(new Set());
	selected.set(null);
	loading.set(false);
	ranked.set(FIXTURES);
});

describe('ピン留め — お気に入りセクションの出入り', () => {
	it('ピンを押すとお気に入りセクションが現れ、全国リストは1行も減らない', async () => {
		await renderPage();
		expect(favouriteList()).toBeNull();
		const before = rowsIn(nationalList()).length;

		pinButtonFor(nationalList(), ALERT.id)?.click();
		await tick();

		expect(rowsIn(favouriteList())).toHaveLength(1);
		// 重複表示。抜くと順位に欠番ができ、外したときに行が遠くへワープする
		expect(rowsIn(nationalList())).toHaveLength(before);
	});

	it('お気に入りはスコア降順で、全国順位の番号をそのまま持つ', async () => {
		await renderPage();
		pinButtonFor(nationalList(), CAUTION.id)?.click();
		pinButtonFor(nationalList(), ALERT.id)?.click();
		await tick();

		const rows = rowsIn(favouriteList());
		expect(rows.map((r) => r.querySelector('.rank-name')?.textContent?.trim())).toEqual([
			ALERT.name,
			CAUTION.name,
		]);
		// 熊本は全国1位なので🥇、釧路・根室は2位なので🥈（振り直さない）
		expect(rows.map((r) => r.querySelector('.rank-num')?.textContent?.trim())).toEqual([
			'🥇',
			'🥈',
		]);
	});

	it('もう一度押すとお気に入りから消え、セクションごと畳まれる', async () => {
		await renderPage();
		pinButtonFor(nationalList(), ALERT.id)?.click();
		await tick();
		expect(favouriteList()).not.toBeNull();

		pinButtonFor(nationalList(), ALERT.id)?.click();
		await tick();
		expect(favouriteList()).toBeNull();
	});
});

describe('見出しとヒント', () => {
	it('「全国ランキング」の見出しはどの状態でも消えない', async () => {
		await renderPage();
		// (1) ピンなし（ヒントが出ている）
		expect(headings()).toEqual(['全国ランキング']);
		expect($('.pin-hint')).not.toBeNull();

		// (2) ピンあり
		pinButtonFor(nationalList(), ALERT.id)?.click();
		await tick();
		expect(headings()).toEqual(['お気に入り', '全国ランキング']);
		expect($('.pin-hint')).toBeNull();

		// (3) ピンはあるが絞り込みで全部外れた
		await setFilter('北海道');
		expect(headings()).toEqual(['全国ランキング']);
		expect(favouriteList()).toBeNull();
	});

	it('絞り込みで0件になってもヒントは出さない（ピンが消えたように読めるため）', async () => {
		await renderPage();
		pinButtonFor(nationalList(), ALERT.id)?.click();
		await tick();

		await setFilter('北海道');
		expect($('.pin-hint')).toBeNull();

		await setFilter('存在しない地名');
		expect($('.pin-hint')).toBeNull();
		expect(rowsIn(nationalList())).toHaveLength(0);
	});

	/**
	 * 初期値は同期で読む（`$effect` では読まない）という決定の担保。
	 * `$effect` は初回描画の**後**に走るので、保存済みのピンがあっても
	 * 「お気に入りが空のときのヒント」が一瞬見えてから消える。
	 * DOM の変化を監視して、一度も現れないことを確かめる。
	 */
	it('保存済みのピンがあるとき、ヒントは一瞬も描かれない', async () => {
		pinned.set(new Set([ALERT.id]));

		let hintAppeared = false;
		const observer = new MutationObserver(() => {
			if (document.querySelector('.pin-hint') !== null) hintAppeared = true;
		});
		observer.observe(document.body, { childList: true, subtree: true });
		await renderPage();
		await flush();
		observer.disconnect();

		expect(hintAppeared).toBe(false);
		expect(favouriteList()).not.toBeNull();
	});

	it('ピンを全部外すとヒントが戻る', async () => {
		await renderPage();
		pinButtonFor(nationalList(), ALERT.id)?.click();
		await tick();
		expect($('.pin-hint')).toBeNull();

		pinButtonFor(nationalList(), ALERT.id)?.click();
		await tick();
		expect($('.pin-hint')).not.toBeNull();
	});
});

/**
 * 危険度で行の密度が変わること。`getComputedStyle` が要るのでブラウザでしか書けない。
 * CSSカスタムプロパティ `--row-pad-y` を行が公開し、行ボタンとピンボタンの両方が読む
 * という配線が壊れると、ピンのアイコンだけが静かにずれる。
 */
describe('行の密度（ハイブリッド）', () => {
	beforeEach(() => {
		pinned.set(new Set([ALERT.id, CAUTION.id]));
	});

	it('警戒帯は展開・注意帯はコンパクトで、高さが実際に違う', async () => {
		await renderPage();
		const [alertRow, cautionRow] = rowsIn(favouriteList()) as HTMLElement[];

		expect(alertRow.classList.contains('rank-row-compact')).toBe(false);
		expect(cautionRow.classList.contains('rank-row-compact')).toBe(true);
		expect(alertRow.getBoundingClientRect().height).toBeGreaterThan(
			cautionRow.getBoundingClientRect().height
		);
	});

	it('コンパクト行は理由文・スコアバー・警報バッジを落とす', async () => {
		await renderPage();
		const [alertRow, cautionRow] = rowsIn(favouriteList());

		expect(alertRow.querySelector('.rank-reasons')).not.toBeNull();
		expect(alertRow.querySelector('.score-bar-bg')).not.toBeNull();
		expect(cautionRow.querySelector('.rank-reasons')).toBeNull();
		expect(cautionRow.querySelector('.score-bar-bg')).toBeNull();
		// タイプバッジは残す（「平穏だが何かは起きている」が1行で読めるべき）
		expect(cautionRow.querySelector('.type-badge')).not.toBeNull();
	});

	it('全国リスト側は同じ地域でも常に展開する（コンパクトはお気に入りだけ）', async () => {
		await renderPage();
		const nationalCaution = nationalList()?.querySelector(
			`.rank-row:has(.pin-btn[data-region-id="${CAUTION.id}"])`
		);
		expect(nationalCaution?.classList.contains('rank-row-compact')).toBe(false);
		expect(nationalCaution?.querySelector('.rank-reasons')).not.toBeNull();
	});

	it('ピンの上余白が行の余白と一致する（--row-pad-y が両方に届いている）', async () => {
		await renderPage();
		for (const row of rowsIn(favouriteList()) as HTMLElement[]) {
			const item = row.querySelector<HTMLElement>('.rank-item');
			const pin = row.querySelector<HTMLElement>('.pin-btn');
			if (item === null || pin === null) throw new Error('行の構成が壊れている');
			expect(getComputedStyle(pin).paddingTop).toBe(getComputedStyle(item).paddingTop);
		}
	});

	it('ピンのタップ領域は幅44px以上・高さは行いっぱい', async () => {
		await renderPage();
		for (const row of rowsIn(favouriteList()) as HTMLElement[]) {
			const pin = row.querySelector<HTMLElement>('.pin-btn');
			const box = pin?.getBoundingClientRect();
			expect(box?.width).toBeGreaterThanOrEqual(44);
			expect(Math.round(box?.height ?? 0)).toBe(Math.round(row.getBoundingClientRect().height));
		}
	});
});

describe('キーボードと支援技術', () => {
	it('行の中にフォーカスできる要素を作らない（button の入れ子を作らない）', async () => {
		pinned.set(new Set([ALERT.id]));
		await renderPage();
		expect($$('button button')).toHaveLength(0);
		// 気象庁バッジは role/tabindex を持たない（フォーカスできるのに開けない罠を作らない）
		expect($$('.rank-item button, .rank-item [tabindex], .rank-item a')).toHaveLength(0);
		expect($('.jma-alert-badge')?.getAttribute('aria-hidden')).toBe('true');
	});

	it('読み上げ名は状態に依存せず、状態は aria-pressed が運ぶ', async () => {
		await renderPage();
		const pin = pinButtonFor(nationalList(), ALERT.id);
		const nameBefore = pin?.getAttribute('aria-label');
		expect(pin?.getAttribute('aria-pressed')).toBe('false');

		pin?.click();
		await tick();

		const after = pinButtonFor(nationalList(), ALERT.id);
		expect(after?.getAttribute('aria-pressed')).toBe('true');
		// 「お気に入りから外す、押されています」という二重否定を作らない
		expect(after?.getAttribute('aria-label')).toBe(nameBefore);
		expect(after?.getAttribute('aria-label')).not.toContain('外す');
		// マウス向けの title は状態を語ってよい
		expect(after?.getAttribute('title')).toContain('外す');
	});

	/**
	 * お気に入りから外すと、押したボタンごと行が消えてフォーカスが `<body>` に落ちる。
	 * キーボード・読み上げの利用者は現在位置を失い、次の Tab が文書の先頭から再開する。
	 * 同じ地域のピンは全国リストに残っているので、そこへ移す。
	 */
	it('お気に入りから外したフォーカスは全国リストの同じ地域へ移る', async () => {
		pinned.set(new Set([ALERT.id]));
		await renderPage();

		const favouritePin = pinButtonFor(favouriteList(), ALERT.id);
		favouritePin?.focus();
		expect(document.activeElement).toBe(favouritePin);

		favouritePin?.click();
		await flush();

		const active = document.activeElement as HTMLElement | null;
		expect(active).not.toBe(document.body);
		expect(active?.classList.contains('pin-btn')).toBe(true);
		expect(active?.dataset.regionId).toBe(ALERT.id);
		// 消えた行のボタンではなく、生き残っている全国リスト側であること
		expect(active).toBe(pinButtonFor(nationalList(), ALERT.id));
		expect(favouriteList()).toBeNull();
	});

	it('全国リストで外したときはフォーカスを動かさない（行が消えないため）', async () => {
		pinned.set(new Set([ALERT.id]));
		await renderPage();

		const nationalPin = pinButtonFor(nationalList(), ALERT.id);
		nationalPin?.focus();
		nationalPin?.click();
		await flush();

		expect(document.activeElement).toBe(nationalPin);
	});
});

describe('ピンと行クリックの取り違えが起きないこと', () => {
	it('ピンを押しても詳細パネルは開かない（兄弟なのでバブリングしない）', async () => {
		await renderPage();
		pinButtonFor(nationalList(), ALERT.id)?.click();
		await tick();

		expect(get(selected)).toBeNull();
		expect($('.detail-overlay')).toBeNull();
		expect(get(pinned).has(ALERT.id)).toBe(true);
	});

	it('行を押すと詳細パネルが開き、ピンの状態は変わらない', async () => {
		await renderPage();
		nationalList()?.querySelector<HTMLButtonElement>('.rank-item')?.click();
		await tick();

		expect($('.detail-overlay')).not.toBeNull();
		expect(get(pinned).size).toBe(0);
	});
});

describe('詳細パネルのピン', () => {
	it('ラベルが状態で切り替わり、aria-pressed は付けない', async () => {
		await renderPage();
		selected.set(ALERT);
		await tick();

		const button = $<HTMLButtonElement>('.detail-pin-btn');
		expect(button?.textContent?.trim()).toBe('お気に入りに追加');
		// 見えている文字が状態を語るので aria-pressed を重ねると二重否定になる
		expect(button?.hasAttribute('aria-pressed')).toBe(false);

		button?.click();
		await tick();

		expect($('.detail-pin-btn')?.textContent?.trim()).toBe('お気に入りから外す');
		expect(get(pinned).has(ALERT.id)).toBe(true);
	});

	it('閉じるボタンと重ならない（誤タップで閉じてしまわない）', async () => {
		await renderPage();
		selected.set(ALERT);
		await tick();

		const pin = $('.detail-pin-btn')?.getBoundingClientRect();
		const close = $('.close-btn')?.getBoundingClientRect();
		if (pin === undefined || close === undefined) throw new Error('詳細パネルの構成が壊れている');
		const overlaps =
			pin.right > close.left &&
			pin.left < close.right &&
			pin.bottom > close.top &&
			pin.top < close.bottom;
		expect(overlaps).toBe(false);
	});
});

describe('絞り込みバーの件数', () => {
	it('データ取得前は件数を出さない（空の入力欄の隣で「該当なし」と言わない）', async () => {
		ranked.set([]);
		loading.set(true);
		await renderPage();

		expect($('.filter-count')?.textContent?.trim()).toBe('');
		expect($('.spinner')).not.toBeNull();
	});

	it('数えているのは該当した地域数で、画面の行数ではない', async () => {
		pinned.set(new Set([CAUTION.id]));
		await renderPage();
		await setFilter('北海道');

		// 該当1地域。画面はお気に入り1行＋全国1行＝2行になる（重複表示のため）
		expect($('.filter-count')?.textContent?.trim()).toBe('1地域');
		expect(rowsIn(favouriteList())).toHaveLength(1);
		expect(rowsIn(nationalList())).toHaveLength(1);
	});
});

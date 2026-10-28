import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { REGIONS } from '#lib/regions.ts';
import { PINNED_STORAGE_KEY } from '#lib/utils/pinnedStorage.ts';

/**
 * pinnedStore を**本物の localStorage**の上で動かす。
 *
 * node 側（`pinnedStorage.test.ts`）は保存値のパースだけを純関数として見ている。
 * このモジュール自体は「モジュール初期化時に同期で読む」「書き戻さない」「例外を飲む」
 * という副作用の塊なので、ストレージのある環境でしか確かめられない。
 *
 * 初期読み込みはモジュール評価時に一度だけ走るので、テストごとに**評価し直す**必要がある。
 * `vi.resetModules()` はブラウザモードでは効かない（ブラウザのモジュールレジストリが
 * 一度読んだ URL を永久にキャッシュするため）。クエリを変えて別 URL にすることで
 * 新しいモジュールとして評価させる。
 */
const EXISTING = REGIONS.map((r) => r.id);
const A = EXISTING[0];
const B = EXISTING[1];
/** 8地域へ分割されて実在しなくなったID（実際に起きた変更） */
const GONE = 'hokkaido';

let evaluation = 0;

/** モジュールを新しく評価する（＝「アプリを開き直す」に相当）。 */
async function freshStore(): Promise<typeof import('./pinnedStore')> {
	evaluation += 1;
	return (await import(
		/* @vite-ignore */ `./pinnedStore.ts?evaluation=${evaluation}`
	)) as typeof import('./pinnedStore');
}

/** 保存値を用意してから読み込む。 */
async function loadStoreWith(raw: string | null) {
	localStorage.clear();
	if (raw !== null) localStorage.setItem(PINNED_STORAGE_KEY, raw);
	return await freshStore();
}

const saved = () => localStorage.getItem(PINNED_STORAGE_KEY);

describe('pinnedStore（本物の localStorage）', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('実在しないIDが混ざっていても実在するIDだけを復元する', async () => {
		expect(EXISTING).not.toContain(GONE);
		const { pinnedIds } = await loadStoreWith(JSON.stringify([GONE, A]));
		expect([...get(pinnedIds)]).toEqual([A]);
	});

	/**
	 * ここが本題。掃除した結果を書き戻すと、キャッシュに残った古いバンドルが
	 * 新しいIDのピンを消してしまい、移行コードが手を出す余地もなくなる。
	 * **表示から落とすだけで、保存値は絶対に書き換えないこと。**
	 */
	it('知らないIDを表示から落としても、保存値は書き換えない', async () => {
		const raw = JSON.stringify([GONE, A]);
		await loadStoreWith(raw);
		expect(saved()).toBe(raw);
	});

	it('一度も操作していなければ localStorage にキーを作らない', async () => {
		await loadStoreWith(null);
		expect(saved()).toBeNull();
		expect(localStorage.length).toBe(0);
	});

	it('ピンを留めると保存され、外すと保存から消える', async () => {
		const { pinnedIds, togglePinned } = await loadStoreWith(null);
		togglePinned(A);
		expect(saved()).toBe(JSON.stringify([A]));
		togglePinned(B);
		expect(new Set(JSON.parse(saved() ?? '[]'))).toEqual(new Set([A, B]));
		togglePinned(A);
		expect(JSON.parse(saved() ?? '[]')).toEqual([B]);
		expect([...get(pinnedIds)]).toEqual([B]);
	});

	it('保存した内容が次回の読み込みで復元される', async () => {
		const first = await loadStoreWith(null);
		first.togglePinned(A);
		first.togglePinned(B);
		const raw = saved();

		// 「次回の訪問」＝ モジュールを捨てて、同じ localStorage から読み直す
		const second = await freshStore();
		expect(get(second.pinnedIds)).toEqual(new Set([A, B]));
		// 読むだけなので保存値は変わらない
		expect(saved()).toBe(raw);
	});

	it('壊れた保存値でも例外を投げずに空で立ち上がる', async () => {
		const { pinnedIds } = await loadStoreWith('{壊れている');
		expect(get(pinnedIds).size).toBe(0);
	});

	it('ストアは毎回新しい Set を配る（同一参照を書き換えない）', async () => {
		const { pinnedIds, togglePinned } = await loadStoreWith(null);
		const before = get(pinnedIds);
		togglePinned(A);
		const after = get(pinnedIds);
		expect(after).not.toBe(before);
		expect(before.size).toBe(0);
	});
});

/**
 * localStorage が使えない環境（Safari のプライベートモードは参照自体が例外を投げる）。
 * **防災アプリの初期描画を例外で落とさない**ことがここでの要件で、
 * ピンはセッション内でだけ効けばよい。
 */
describe('localStorage が例外を投げる環境', () => {
	let original: PropertyDescriptor | undefined;

	beforeEach(() => {
		original = Object.getOwnPropertyDescriptor(window, 'localStorage');
		Object.defineProperty(window, 'localStorage', {
			configurable: true,
			get() {
				throw new Error('SecurityError: storage is disabled');
			},
		});
	});

	afterEach(() => {
		if (original) Object.defineProperty(window, 'localStorage', original);
	});

	it('モジュールの読み込みが失敗しない', async () => {
		const { pinnedIds } = await freshStore();
		expect(get(pinnedIds).size).toBe(0);
	});

	it('保存できなくてもセッション内ではピンが効く', async () => {
		const { pinnedIds, togglePinned } = await freshStore();
		expect(() => togglePinned(A)).not.toThrow();
		expect([...get(pinnedIds)]).toEqual([A]);
	});
});

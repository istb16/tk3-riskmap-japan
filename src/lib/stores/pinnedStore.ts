import { writable } from 'svelte/store';
import { REGIONS } from '../regions';
import { PINNED_STORAGE_KEY, parsePinned, serializePinned } from '../utils/pinnedStorage';

/**
 * ピン留め（お気に入り）した地域。
 *
 * 順序を持たない集合であることが設計の核。表示は常にスコア降順なので、
 * 「何番目に留めたか」を保存する必要がない。順序を保存すると必然的に
 * 並べ替えUI（ドラッグ&ドロップ・上下ボタン）を要求されてスコープが跳ねる。
 *
 * ## localStorage との付き合い方
 *
 * - **初期値は同期で読む。** `$effect` で読むと初回描画の後になり、
 *   「お気に入りが空のときのヒント」が一瞬見えてから消える
 * - **全アクセスを try/catch で包む。** Safari のプライベートモードは
 *   `localStorage` の参照自体が例外を投げる。`localStorage` が存在しない環境でも
 *   `ReferenceError` として同じ catch に落ちるので、`typeof` の事前判定は要らない。
 *   読み書きに失敗してもセッション内メモリだけで動かす（ピンは効くが次回に残らない）
 * - **知らないIDは読むときに捨てるだけで、保存値には書き戻さない。**
 *   書き戻すと破壊的になる —— 新しい地域IDでピンを留めたあと、別タブや
 *   キャッシュに残った古いバンドルが読み込まれると、そのバンドルはIDを知らないので
 *   掃除して上書きし、**移行コードが手を出す前にピンが消える**。
 *   読み捨てるだけでも表示は同じで壊れないので、書き戻す利点は何もない。
 */

/** 現在存在する地域ID。これに無いIDは保存値から捨てる。 */
const VALID_IDS: ReadonlySet<string> = new Set(REGIONS.map((r) => r.id));

function readRaw(): string | null {
	try {
		return localStorage.getItem(PINNED_STORAGE_KEY);
	} catch {
		return null;
	}
}

function write(ids: Iterable<string>): void {
	try {
		localStorage.setItem(PINNED_STORAGE_KEY, serializePinned(ids));
	} catch {
		// 保存できなくてもセッション内では動かす（容量超過・プライベートモード・非ブラウザ）
	}
}

// 知らないIDは読み捨てるだけ。書き戻さない（上のコメント参照）ので、
// 一度も操作していない訪問者の localStorage にキーを作ることもない。
export const pinnedIds = writable<ReadonlySet<string>>(new Set(parsePinned(readRaw(), VALID_IDS)));

/** ピンを留める / 外す。押すたびに保存する。 */
export function togglePinned(id: string): void {
	pinnedIds.update((current) => {
		const next = new Set(current);
		// Set.delete は「消せたか」を返すので、これだけでトグルになる
		if (!next.delete(id)) next.add(id);
		write(next);
		return next;
	});
}

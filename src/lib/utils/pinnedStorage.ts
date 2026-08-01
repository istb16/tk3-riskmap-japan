/**
 * ピン留め（お気に入り）地域の永続化形式。
 *
 * localStorage の入出力そのものは `stores/pinnedStore.ts` が持ち、ここには
 * 「保存値をどう読み直すか」という純粋な判断だけを置く（テストのため）。
 *
 * ## 保存形式の契約
 *
 * 保存するのは**地域IDの配列**（`["tokyo","kumamoto"]`）。名前でも順位でもない。
 * 名前は変わりうる（実際に所属都道府県の接尾辞 `（北海道）` を後から付けた）し、
 * 順位は5分ごとに変わる。
 *
 * **バージョン欄は持たない。** 「文字列の配列か」を検証すれば形の違いは検出できるので、
 * 将来形を変えたら古い値は検証で弾かれて空扱いになる。
 *
 * **知らないIDは黙って捨てる。** 地域の構成が変わればIDは消えうる
 * （`hokkaido` は8地域へ分割された）。「以前ピン留めしていた地域が見つかりません」は
 * こちらの内部リファクタリングの話であって、ユーザーには意味がなく対処もできない。
 */

/** localStorage のキー。アプリ名で名前空間を切る。 */
export const PINNED_STORAGE_KEY = 'riskmap:pinned';

/**
 * 保存値を地域IDの配列に読み直す。
 *
 * 何が来ても例外を投げず配列を返す —— これは防災アプリの初期描画で走るコードなので、
 * 壊れた保存値でページ全体を落とすことは絶対に避ける。
 *
 * 並び順に意味はない（表示は常にスコア降順）。
 *
 * @param raw localStorage から読んだ生の文字列（未保存なら `null`）
 * @param validIds 現在存在する地域IDの集合。ここに無いIDは捨てる
 */
export function parsePinned(raw: string | null, validIds: ReadonlySet<string>): string[] {
	if (raw === null) return [];

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];

	// Set は挿入順を保つので、これで「文字列で・実在して・重複しない」が一度に済む
	return [...new Set(parsed.filter((x): x is string => typeof x === 'string' && validIds.has(x)))];
}

/** 保存する文字列を作る。`parsePinned` と対になる形式の定義。 */
export function serializePinned(ids: Iterable<string>): string {
	return JSON.stringify([...ids]);
}

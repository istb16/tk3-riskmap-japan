import type { Region } from '../types';

/**
 * 地域フィルタの照合。
 *
 * 名前（漢字）と読み（ひらがな）の**両方**に対する部分一致で判定する。
 * 部分一致にしているのは選べる余地がないため —— `（北海道）` は名前の末尾にあるので、
 * 前方一致にすると `北海道` で8地域を絞るという用途が成立しない。
 *
 * 照合対象は地名だけで、理由文や警報名は含めない。現象（`津波` `注意報`）で絞れるように
 * すると、同じ入力に対する結果が天候によって変わり（`津波` は平常時0件）、
 * フィルタとして壊れているように見えるため。
 */

/** カタカナ・半角カナ・全角英数を、照合できる形に揃える。 */
export function normalizeForSearch(input: string): string {
	return (
		input
			// 半角カナ（ｸｼﾛ）→ 全角カタカナ、全角英数（Ａ）→ 半角へ寄せる
			.normalize('NFKC')
			.trim()
			.toLowerCase()
			// カタカナ → ひらがな。IME の変換途中はひらがななので、そちらに寄せる。
			// 長音符（ー）は範囲外なのでそのまま残る（ひらがなでも同じ文字を使う）
			.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
	);
}

/**
 * 地域ごとの照合用テキスト。名前と読みを**連結せず別々に持つ**。
 * 連結すると境界（`（北海道）` の閉じ括弧と読みの先頭）を跨いだ偽陽性が生まれるため。
 */
export type RegionSearchIndex = ReadonlyMap<string, readonly string[]>;

export function buildSearchIndex(regions: readonly Region[]): RegionSearchIndex {
	return new Map(
		regions.map((r) => [r.id, [normalizeForSearch(r.name), normalizeForSearch(r.kana)]])
	);
}

/**
 * 空のクエリはすべてに一致する（フィルタなしの状態）。
 * 索引に無い ID は一致しない扱いにする —— 未知の地域を黙って表示するより、
 * 絞り込みから漏れているほうが気づける。
 */
export function matchesSearch(
	index: RegionSearchIndex,
	regionId: string,
	normalizedQuery: string
): boolean {
	if (normalizedQuery === '') return true;
	const texts = index.get(regionId);
	if (texts === undefined) return false;
	return texts.some((t) => t.includes(normalizedQuery));
}

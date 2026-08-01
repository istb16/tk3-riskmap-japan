/**
 * 表示名を「地域名」と「所属都道府県」に分ける。
 *
 * 都道府県そのものでない地域（北海道8地方・離島10地域）は `釧路・根室（北海道）` のように
 * 所属都道府県を全角括弧で添えている（`regions.ts` の命名規約）。UIでは都道府県側を
 * 小さく淡く描き、地域名を主題として見せるためにこの2つを分けて扱う。
 *
 * 括弧付きの地域名は他より横幅を食うため、分けずに同じ字送りで描くと
 * ランキング行のリスク種別バッジが2行目に折り返し、行の高さが不揃いになる。
 */
export interface RegionNameParts {
	/** 地域名そのもの（例: `釧路・根室`） */
	readonly base: string;
	/** 所属都道府県。都道府県そのものの地域では null（例: `東京` → null） */
	readonly prefecture: string | null;
}

/** 末尾の全角括弧だけを所属都道府県として切り出す。 */
const TRAILING_PREFECTURE = /^(.+)（([^（）]+)）$/;

export function splitRegionName(name: string): RegionNameParts {
	const matched = TRAILING_PREFECTURE.exec(name);
	if (!matched) return { base: name, prefecture: null };
	return { base: matched[1], prefecture: matched[2] };
}

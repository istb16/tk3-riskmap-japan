import { describe, it, expect } from 'vitest';
import { normalizeForSearch, buildSearchIndex, matchesSearch } from './regionFilter';
import { REGIONS } from '../regions';

const INDEX = buildSearchIndex(REGIONS);

/** クエリにヒットする地域名を返す（表示順は問わないのでソートして比較する）。 */
function hits(query: string): string[] {
	const q = normalizeForSearch(query);
	return REGIONS.filter((r) => matchesSearch(INDEX, r.id, q))
		.map((r) => r.name)
		.sort();
}

describe('normalizeForSearch', () => {
	it('カタカナをひらがなに寄せる', () => {
		expect(normalizeForSearch('クシロ')).toBe('くしろ');
		expect(normalizeForSearch('ホッカイドウ')).toBe('ほっかいどう');
	});

	it('半角カナを経由してもひらがなになる', () => {
		expect(normalizeForSearch('ｸｼﾛ')).toBe('くしろ');
	});

	it('長音符はそのまま残る（ひらがなでも同じ文字を使う）', () => {
		expect(normalizeForSearch('コーチ')).toBe('こーち');
	});

	it('前後の空白を落とし、英字は小文字にする', () => {
		expect(normalizeForSearch('  Tokyo  ')).toBe('tokyo');
	});

	it('全角括弧は NFKC で半角になる（名前側も同じ関数を通すので揃う）', () => {
		expect(normalizeForSearch('（北海道）')).toBe('(北海道)');
	});

	it('漢字とひらがなは変化しない', () => {
		expect(normalizeForSearch('釧路')).toBe('釧路');
		expect(normalizeForSearch('くしろ')).toBe('くしろ');
	});
});

describe('matchesSearch', () => {
	it('空のクエリはすべてに一致する', () => {
		expect(hits('')).toHaveLength(64);
		expect(hits('   ')).toHaveLength(64);
	});

	it('漢字で絞れる', () => {
		expect(hits('釧路')).toEqual(['釧路・根室（北海道）']);
		expect(hits('熊本')).toEqual(['熊本']);
	});

	it('ひらがなで絞れる（変換確定前の入力）', () => {
		expect(hits('くしろ')).toEqual(['釧路・根室（北海道）']);
		expect(hits('しりべし')).toEqual(['石狩・空知・後志（北海道）']);
	});

	it('カタカナでも絞れる', () => {
		expect(hits('クシロ')).toEqual(['釧路・根室（北海道）']);
	});

	it('都道府県で絞ると所属する地域がすべて出る', () => {
		// 表示名の接尾辞に都道府県が入っているので、専用のグルーピングデータが要らない
		expect(hits('北海道')).toHaveLength(8);
		expect(hits('沖縄')).toEqual(['八重山（沖縄）', '大東島（沖縄）', '宮古島（沖縄）', '沖縄']);
		expect(hits('長崎')).toEqual(['五島（長崎）', '壱岐・対馬（長崎）', '長崎']);
	});

	it('都道府県は読みでも絞れる', () => {
		expect(hits('ほっかいどう')).toHaveLength(8);
		expect(hits('おきなわ')).toHaveLength(4);
	});

	it('部分一致なので語の途中でも当たる', () => {
		// 「根室」は名前の途中にある
		expect(hits('根室')).toEqual(['釧路・根室（北海道）']);
		expect(hits('ねむろ')).toEqual(['釧路・根室（北海道）']);
	});

	it('変換途中の中間状態でも部分一致なので当たり続ける', () => {
		// 「しりべし」に到達する過程。読みが短いので中間状態も他地域に当たる
		// （`しり` は `あばしり` にも含まれる）。0件を通過しないので画面が跳ねない
		expect(hits('しり')).toEqual(['石狩・空知・後志（北海道）', '網走・北見・紋別（北海道）']);
		expect(hits('しりべ')).toEqual(['石狩・空知・後志（北海道）']);
		expect(hits('しりべし')).toEqual(['石狩・空知・後志（北海道）']);
	});

	it('該当しないクエリは0件', () => {
		expect(hits('ぱりぱり')).toEqual([]);
		// 現象は照合対象外
		expect(hits('津波')).toEqual([]);
		expect(hits('注意報')).toEqual([]);
	});

	it('代表都市名では引けない（地域名は地方・県の名前なので）', () => {
		// 実装上の既知の穴。`Region.city` はローマ字（`Sapporo` `Hakodate`）でしか持っておらず
		// 照合対象にも入れていない。ユーザーは市名を打つ可能性が高い
		expect(hits('札幌')).toEqual([]);
		expect(hits('さっぽろ')).toEqual([]);
		expect(hits('函館')).toEqual([]);
		expect(hits('仙台')).toEqual([]);
	});

	it('索引に無い ID は一致しない', () => {
		expect(matchesSearch(INDEX, 'no-such-region', 'くしろ')).toBe(false);
		// 空クエリだけは索引を引かずに通す（フィルタなしの状態）
		expect(matchesSearch(INDEX, 'no-such-region', '')).toBe(true);
	});
});

describe('REGIONS の読み', () => {
	it('64地域すべてに読みがある', () => {
		for (const r of REGIONS) expect(r.kana).toBeTruthy();
	});

	it('読みはひらがな（と長音符）だけで構成される', () => {
		// 漢字・カタカナ・記号・空白が混じっていると、変換途中の入力と一致しなくなる
		for (const r of REGIONS) {
			expect(r.kana, `${r.name} の読み`).toMatch(/^[ぁ-んー]+$/);
		}
	});

	it('読みは64件すべて一意', () => {
		const kanas = REGIONS.map((r) => r.kana);
		expect(new Set(kanas).size).toBe(kanas.length);
	});

	it('都道府県以外の18地域は読みが所属都道府県の読みで終わる', () => {
		const suffixKana: Record<string, string> = {
			北海道: 'ほっかいどう',
			東京: 'とうきょう',
			新潟: 'にいがた',
			島根: 'しまね',
			長崎: 'ながさき',
			鹿児島: 'かごしま',
			沖縄: 'おきなわ',
		};
		let checked = 0;
		for (const r of REGIONS) {
			const matched = /（(.+)）$/.exec(r.name);
			if (!matched) continue;
			const expected = suffixKana[matched[1]];
			expect(expected, `${matched[1]} の読みが未定義`).toBeTruthy();
			expect(r.kana, `${r.name} の読み`).toMatch(new RegExp(`${expected}$`));
			checked++;
		}
		expect(checked).toBe(18);
	});

	it('すべての地域が自分の名前と読みでちょうど自分だけにヒットする、または同名を含む地域群に含まれる', () => {
		for (const r of REGIONS) {
			expect(hits(r.name)).toContain(r.name);
			expect(hits(r.kana)).toContain(r.name);
		}
	});
});

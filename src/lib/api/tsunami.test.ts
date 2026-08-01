import { describe, it, expect } from 'vitest';
import { tsunamiLevelFromKindName, resolveTsunamiByArea, strongestTsunamiFor } from './tsunami';

describe('tsunamiLevelFromKindName', () => {
	it.each([
		['大津波警報', 'major'],
		['津波警報', 'warning'],
		['津波注意報', 'advisory'],
		['津波予報（若干の海面変動）', 'forecast'],
	] as const)('%s → %s', (name, expected) => {
		expect(tsunamiLevelFromKindName(name)).toBe(expected);
	});

	it('解除は none として扱う', () => {
		expect(tsunamiLevelFromKindName('津波注意報解除')).toBe('none');
		expect(tsunamiLevelFromKindName('津波警報解除')).toBe('none');
		expect(tsunamiLevelFromKindName('大津波警報解除')).toBe('none');
	});

	it('「津波の心配なし」は none', () => {
		expect(tsunamiLevelFromKindName('津波予報（津波の心配なし）')).toBe('none');
	});

	it('大津波警報は津波警報より優先して判定される', () => {
		// 「大津波警報」は「津波警報」を部分文字列として含むため判定順が重要
		expect(tsunamiLevelFromKindName('大津波警報')).toBe('major');
	});

	it('undefined・未知の文言 → none', () => {
		expect(tsunamiLevelFromKindName(undefined)).toBe('none');
		expect(tsunamiLevelFromKindName('何らかの情報')).toBe('none');
	});
});

describe('resolveTsunamiByArea', () => {
	function makeDetail(items: Array<{ code?: string; area: string; kind: string }>) {
		return {
			Head: { ReportDateTime: '2026-07-28T18:10:00+09:00' },
			Body: {
				Tsunami: {
					Forecast: {
						Item: items.map((i) => ({
							Area: { Code: i.code, Name: i.area },
							Category: { Kind: { Name: i.kind } },
						})),
					},
				},
			},
		};
	}

	it('予報区コードをキーに発表内容を返す', () => {
		const result = resolveTsunamiByArea(
			makeDetail([{ code: '740', area: '熊本県天草灘沿岸', kind: '津波警報' }])
		);
		expect(result.get('740')).toEqual({
			level: 'warning',
			areaName: '熊本県天草灘沿岸',
			issuedAt: new Date('2026-07-28T18:10:00+09:00').getTime(),
		});
	});

	it('解除された予報区は結果に含めない', () => {
		const result = resolveTsunamiByArea(
			makeDetail([{ code: '740', area: '熊本県天草灘沿岸', kind: '津波注意報解除' }])
		);
		expect(result.size).toBe(0);
	});

	it('同一予報区に複数の記載があれば最も強いレベルを採用する', () => {
		const result = resolveTsunamiByArea(
			makeDetail([
				{ code: '712', area: '有明・八代海', kind: '津波注意報' },
				{ code: '712', area: '有明・八代海', kind: '大津波警報' },
			])
		);
		expect(result.get('712')?.level).toBe('major');
	});

	it('強いレベルが先に来ても弱いレベルで上書きされない', () => {
		const result = resolveTsunamiByArea(
			makeDetail([
				{ code: '712', area: '有明・八代海', kind: '大津波警報' },
				{ code: '712', area: '有明・八代海', kind: '津波注意報' },
			])
		);
		expect(result.get('712')?.level).toBe('major');
	});

	it('予報区コードが無い記載は無視する（誤った地域に付けない）', () => {
		expect(resolveTsunamiByArea(makeDetail([{ area: '未知の沿岸', kind: '津波警報' }])).size).toBe(
			0
		);
	});

	it('予報区が空でも例外を投げない', () => {
		expect(resolveTsunamiByArea({}).size).toBe(0);
	});
});

describe('strongestTsunamiFor', () => {
	const BY_AREA = new Map([
		['712', { level: 'major' as const, areaName: '有明・八代海', issuedAt: 1 }],
		['740', { level: 'advisory' as const, areaName: '熊本県天草灘沿岸', issuedAt: 1 }],
		['320', { level: 'warning' as const, areaName: '伊豆諸島', issuedAt: 1 }],
	]);

	it('地域が持つ予報区のうち最も強いレベルを採用する', () => {
		// 熊本県 = 712（大津波警報）+ 740（津波注意報）
		expect(strongestTsunamiFor(['712', '740'], BY_AREA).level).toBe('major');
	});

	it('順序によらず最強を選ぶ', () => {
		expect(strongestTsunamiFor(['740', '712'], BY_AREA).level).toBe('major');
	});

	it('該当する予報区がなければ none', () => {
		expect(strongestTsunamiFor(['210', '220'], BY_AREA).level).toBe('none');
	});

	it('予報区を持たない内陸の地域は none', () => {
		expect(strongestTsunamiFor([], BY_AREA)).toEqual({
			level: 'none',
			areaName: null,
			issuedAt: null,
		});
	});

	it('離島の予報区は離島地域にのみ乗る', () => {
		// 伊豆諸島(320) は伊豆・小笠原諸島が持ち、東京(312のみ)には乗らない
		expect(strongestTsunamiFor(['320', '321'], BY_AREA).level).toBe('warning');
		expect(strongestTsunamiFor(['312'], BY_AREA).level).toBe('none');
	});
});

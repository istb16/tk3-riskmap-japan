import { describe, it, expect } from 'vitest';
import { REGIONS } from './regions';
import { prefCodeOf } from './types';

/** 北海道は唯一8つの発表官署を持つため、官署単位で分割している。 */
const HOKKAIDO_IDS = [
	'hokkaido-soya',
	'hokkaido-kamikawa',
	'hokkaido-abashiri',
	'hokkaido-tokachi',
	'hokkaido-kushiro',
	'hokkaido-iburi',
	'hokkaido-ishikari',
	'hokkaido-oshima',
];

/** 気象庁が本土と別の一次細分区域に分けている離島。 */
const ISLAND_IDS = [
	'izu-ogasawara',
	'sado',
	'oki',
	'tsushima',
	'goto',
	'tanegashima',
	'amami',
	'daito',
	'miyako',
	'yaeyama',
];

describe('REGIONS', () => {
	it('46都道府県 + 北海道8地域 + 離島10地域 = 64地域が定義されている', () => {
		expect(REGIONS).toHaveLength(64);
	});

	it('すべてのIDが一意である', () => {
		const ids = REGIONS.map((r) => r.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('すべてのフィールドが存在する', () => {
		for (const r of REGIONS) {
			expect(r.id).toBeTruthy();
			expect(r.name).toBeTruthy();
			expect(r.city).toBeTruthy();
			expect(typeof r.lat).toBe('number');
			expect(typeof r.lng).toBe('number');
			expect(r.jmaCode).toMatch(/^\d{6}$/);
			expect(r.class10Codes.length).toBeGreaterThan(0);
		}
	});

	it('緯度が日本の範囲内(24〜46度)である', () => {
		for (const r of REGIONS) {
			expect(r.lat).toBeGreaterThanOrEqual(24);
			expect(r.lat).toBeLessThanOrEqual(46);
		}
	});

	it('経度が日本の範囲内(122〜146度)である', () => {
		for (const r of REGIONS) {
			expect(r.lng).toBeGreaterThanOrEqual(122);
			expect(r.lng).toBeLessThanOrEqual(146);
		}
	});

	it('代表的な都道府県が含まれている', () => {
		const ids = REGIONS.map((r) => r.id);
		expect(ids).toContain('tokyo');
		expect(ids).toContain('osaka');
		expect(ids).toContain('okinawa');
		expect(ids).toContain('aichi');
		expect(ids).toContain('fukuoka');
	});

	it('北海道8地域が含まれている', () => {
		const ids = REGIONS.map((r) => r.id);
		for (const id of HOKKAIDO_IDS) expect(ids).toContain(id);
		// 分割したので「北海道」という単一地域はもう存在しない
		expect(ids).not.toContain('hokkaido');
	});

	it('都道府県そのものでない地域は表示名に所属都道府県を添える', () => {
		const withPref = (id: string) => REGIONS.find((r) => r.id === id)?.name ?? '';
		expect(withPref('izu-ogasawara')).toBe('伊豆・小笠原諸島（東京）');
		expect(withPref('amami')).toBe('奄美（鹿児島）');
		expect(withPref('hokkaido-kushiro')).toBe('釧路・根室（北海道）');
		// 都道府県そのものの地域には付けない
		expect(withPref('tokyo')).toBe('東京');
	});

	it('括弧付きの地域は離島か北海道の各地方だけ', () => {
		for (const r of REGIONS) {
			const hasPref = r.name.includes('（');
			expect(hasPref).toBe(ISLAND_IDS.includes(r.id) || HOKKAIDO_IDS.includes(r.id));
		}
	});

	it('離島10地域が含まれている', () => {
		const ids = REGIONS.map((r) => r.id);
		for (const id of ISLAND_IDS) expect(ids).toContain(id);
	});
});

describe('一次細分区域（class10Codes）', () => {
	it('同じ区域が複数の地域に重複して属さない', () => {
		const all = REGIONS.flatMap((r) => r.class10Codes);
		expect(new Set(all).size).toBe(all.length);
	});

	it('東京は東京地方のみを対象にする（伊豆諸島・小笠原諸島を含めない）', () => {
		const tokyo = REGIONS.find((r) => r.id === 'tokyo');
		expect(tokyo?.class10Codes).toEqual(['130010']);
	});

	it('伊豆・小笠原諸島が東京の離島区域をすべて引き受ける', () => {
		const izu = REGIONS.find((r) => r.id === 'izu-ogasawara');
		expect(izu?.class10Codes).toEqual(['130020', '130030', '130040']);
	});

	it('北海道の16区域すべてがどこかの地域に属する', () => {
		// 分割前は札幌管区の3区域しかカバーしておらず、釧路・根室・十勝の震度が
		// どの地域にも反映されなかった
		const covered = new Set(
			REGIONS.filter((r) => HOKKAIDO_IDS.includes(r.id)).flatMap((r) => r.class10Codes)
		);
		expect(covered.size).toBe(16);
		expect(covered).toContain('014010'); // 根室地方
		expect(covered).toContain('014020'); // 釧路地方
		expect(covered).toContain('014030'); // 十勝地方
		expect(covered).toContain('011000'); // 宗谷地方
	});

	it('北海道の各地方は自分の発表官署だけを見る', () => {
		const offices = REGIONS.filter((r) => HOKKAIDO_IDS.includes(r.id)).map((r) => r.jmaCode);
		expect(new Set(offices).size).toBe(8);
		expect(REGIONS.find((r) => r.id === 'hokkaido-kushiro')?.jmaCode).toBe('014100');
	});

	it('鹿児島は薩摩・大隅のみ、種子島屋久島と奄美は独立している', () => {
		expect(REGIONS.find((r) => r.id === 'kagoshima')?.class10Codes).toEqual(['460010', '460020']);
		expect(REGIONS.find((r) => r.id === 'tanegashima')?.class10Codes).toEqual(['460030']);
		expect(REGIONS.find((r) => r.id === 'amami')?.class10Codes).toEqual(['460040']);
	});

	it('本土と別官署の離島は独自の jmaCode を持つ（本土のコードでは取得できないため）', () => {
		expect(REGIONS.find((r) => r.id === 'amami')?.jmaCode).toBe('460040');
		expect(REGIONS.find((r) => r.id === 'miyako')?.jmaCode).toBe('473000');
		expect(REGIONS.find((r) => r.id === 'yaeyama')?.jmaCode).toBe('474000');
		expect(REGIONS.find((r) => r.id === 'daito')?.jmaCode).toBe('472000');
	});

	it('同一官署を共有する地域は class10Codes で区別される', () => {
		const shared = REGIONS.filter((r) => r.jmaCode === '130000');
		expect(shared.map((r) => r.id)).toEqual(['tokyo', 'izu-ogasawara']);
	});
});

describe('津波予報区（tsunamiAreaCodes）', () => {
	const INLAND_IDS = [
		'tochigi',
		'gunma',
		'saitama',
		'yamanashi',
		'nagano',
		'gifu',
		'shiga',
		'nara',
	];

	it('内陸8県は津波予報区を持たない', () => {
		for (const id of INLAND_IDS) {
			expect(REGIONS.find((r) => r.id === id)?.tsunamiAreaCodes).toEqual([]);
		}
	});

	it('沿岸の地域はすべて津波予報区を持つ', () => {
		for (const r of REGIONS) {
			if (INLAND_IDS.includes(r.id)) continue;
			expect(r.tsunamiAreaCodes.length).toBeGreaterThan(0);
		}
	});

	it('東京湾内湾(312)は千葉・東京・神奈川が共有する', () => {
		for (const id of ['chiba', 'tokyo', 'kanagawa']) {
			expect(REGIONS.find((r) => r.id === id)?.tsunamiAreaCodes).toContain('312');
		}
	});

	it('伊豆諸島(320)・小笠原諸島(321)は離島地域が持つ（東京は持たない）', () => {
		expect(REGIONS.find((r) => r.id === 'izu-ogasawara')?.tsunamiAreaCodes).toEqual(['320', '321']);
		expect(REGIONS.find((r) => r.id === 'tokyo')?.tsunamiAreaCodes).not.toContain('320');
	});

	it('北海道の6予報区すべてがどこかの地方に割り当てられている', () => {
		const covered = new Set(
			REGIONS.filter((r) => HOKKAIDO_IDS.includes(r.id)).flatMap((r) => r.tsunamiAreaCodes)
		);
		// 100 太平洋東部 / 101 中部 / 102 西部 / 110 日本海北部 / 111 南部 / 120 オホーツク海
		expect([...covered].sort()).toEqual(['100', '101', '102', '110', '111', '120']);
	});

	it('奄美(772)・種子島屋久島(771)は離島地域が持つ', () => {
		expect(REGIONS.find((r) => r.id === 'amami')?.tsunamiAreaCodes).toEqual(['772']);
		expect(REGIONS.find((r) => r.id === 'tanegashima')?.tsunamiAreaCodes).toEqual(['771']);
		expect(REGIONS.find((r) => r.id === 'kagoshima')?.tsunamiAreaCodes).toEqual(['770', '773']);
	});
});

describe('prefCodeOf', () => {
	it('jmaCode の先頭2桁を都道府県コードとして返す', () => {
		expect(prefCodeOf({ jmaCode: '130000' })).toBe('13');
		expect(prefCodeOf({ jmaCode: '016000' })).toBe('01');
		expect(prefCodeOf({ jmaCode: '474000' })).toBe('47');
	});

	it('離島も所属都道府県のコードになる', () => {
		const amami = REGIONS.find((r) => r.id === 'amami')!;
		expect(prefCodeOf(amami)).toBe('46');
		const izu = REGIONS.find((r) => r.id === 'izu-ogasawara')!;
		expect(prefCodeOf(izu)).toBe('13');
	});

	it('北海道の各地方はすべて 01 になる', () => {
		for (const id of HOKKAIDO_IDS) {
			expect(prefCodeOf(REGIONS.find((r) => r.id === id)!)).toBe('01');
		}
	});
});

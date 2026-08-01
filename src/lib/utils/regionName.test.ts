import { describe, it, expect } from 'vitest';
import { splitRegionName } from './regionName';
import { REGIONS } from '../regions';

describe('splitRegionName', () => {
	it('括弧付きの地域名を地域名と都道府県に分ける', () => {
		expect(splitRegionName('釧路・根室（北海道）')).toEqual({
			base: '釧路・根室',
			prefecture: '北海道',
		});
		expect(splitRegionName('伊豆・小笠原諸島（東京）')).toEqual({
			base: '伊豆・小笠原諸島',
			prefecture: '東京',
		});
	});

	it('都道府県そのものの地域は prefecture が null', () => {
		expect(splitRegionName('東京')).toEqual({ base: '東京', prefecture: null });
		expect(splitRegionName('鹿児島')).toEqual({ base: '鹿児島', prefecture: null });
	});

	it('半角括弧は分割しない（命名規約は全角）', () => {
		expect(splitRegionName('奄美(鹿児島)')).toEqual({ base: '奄美(鹿児島)', prefecture: null });
	});

	it('括弧が閉じていない・空の場合は分割しない', () => {
		expect(splitRegionName('奄美（鹿児島')).toEqual({ base: '奄美（鹿児島', prefecture: null });
		expect(splitRegionName('奄美（）')).toEqual({ base: '奄美（）', prefecture: null });
	});

	it('実際の64地域すべてで base が空にならない', () => {
		for (const r of REGIONS) {
			const { base, prefecture } = splitRegionName(r.name);
			expect(base).toBeTruthy();
			expect(base).not.toContain('（');
			if (prefecture !== null) expect(prefecture).not.toContain('（');
			// 分割してもつなげれば元に戻る
			expect(prefecture === null ? base : `${base}（${prefecture}）`).toBe(r.name);
		}
	});

	it('括弧付きは18地域（北海道8＋離島10）だけ', () => {
		const withPref = REGIONS.filter((r) => splitRegionName(r.name).prefecture !== null);
		expect(withPref).toHaveLength(18);
	});
});

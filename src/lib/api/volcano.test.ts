import { describe, it, expect } from 'vitest';
import {
	volcanoLevel,
	volcanoLevelFromName,
	resolveVolcanoesByPrefecture,
	applyVolcanoDistanceDecay,
	volcanoDistanceFactor,
	type ResolvedVolcanoAlert,
} from './volcano';

/**
 * コードと警戒レベルの対応は気象庁「VolcanicWarning コード表」に準拠する。
 * <https://xml.kishou.go.jp/tec_material.html> の個別コード表内 地震火山関連コード表.xls シート81
 */
describe('volcanoLevel（公式コード表）', () => {
	it.each([
		['11', 1, true],
		['12', 2, true],
		['13', 3, true],
		['14', 4, true],
		['15', 5, true],
	] as const)('レベル運用火山 コード%s → レベル%i', (code, level, operated) => {
		expect(volcanoLevel(code, undefined)).toEqual({ level, isLevelOperated: operated });
	});

	it.each([
		['21', 1], // 活火山であることに留意
		['22', 2], // 火口周辺危険
		['23', 3], // 入山危険
		['24', 4], // 山麓厳重警戒
		['25', 5], // 居住地域厳重警戒
	] as const)('レベル運用外火山 コード%s → レベル%i相当', (code, level) => {
		expect(volcanoLevel(code, undefined)).toEqual({ level, isLevelOperated: false });
	});

	it.each([
		['35', 1], // 活火山であることに留意（海底火山）
		['36', 2], // 周辺海域警戒
	] as const)('海底火山 コード%s → レベル%i相当', (code, level) => {
		expect(volcanoLevel(code, undefined)).toEqual({ level, isLevelOperated: false });
	});

	it('コードは文言より優先される', () => {
		// コード13（レベル３）が正、文言は矛盾していてもコードに従う
		expect(volcanoLevel('13', 'レベル１（活火山であることに留意）').level).toBe(3);
	});

	it('未知のコード・コード無しは文言から推定する', () => {
		expect(volcanoLevel('99', 'レベル３（入山規制）').level).toBe(3);
		expect(volcanoLevel(undefined, '入山危険')).toEqual({ level: 3, isLevelOperated: false });
	});
});

describe('volcanoLevelFromName（コードが引けない場合のフォールバック）', () => {
	it('全角数字のレベル表記をパースする', () => {
		expect(volcanoLevelFromName('レベル２（火口周辺規制）')).toEqual({
			level: 2,
			isLevelOperated: true,
		});
		expect(volcanoLevelFromName('レベル５（避難）')).toEqual({ level: 5, isLevelOperated: true });
	});

	it('半角数字のレベル表記もパースする', () => {
		expect(volcanoLevelFromName('レベル3（入山規制）').level).toBe(3);
	});

	it('レベル運用外の火山は防災対応から相当レベルに換算する', () => {
		expect(volcanoLevelFromName('火口周辺危険')).toEqual({ level: 2, isLevelOperated: false });
		expect(volcanoLevelFromName('入山危険')).toEqual({ level: 3, isLevelOperated: false });
		expect(volcanoLevelFromName('周辺海域警戒')).toEqual({ level: 2, isLevelOperated: false });
		expect(volcanoLevelFromName('居住地域厳重警戒')).toEqual({ level: 4, isLevelOperated: false });
	});

	it('「高齢者等避難」は「避難」より先に判定される（レベル4）', () => {
		expect(volcanoLevelFromName('高齢者等避難').level).toBe(4);
		expect(volcanoLevelFromName('避難準備').level).toBe(4);
	});

	it('「避難」単独はレベル5相当', () => {
		expect(volcanoLevelFromName('避難').level).toBe(5);
	});

	it('活火山であることに留意 → レベル1相当', () => {
		expect(volcanoLevelFromName('活火山であることに留意').level).toBe(1);
	});

	it('undefined・未知の文言はレベル1にフォールバックする', () => {
		expect(volcanoLevelFromName(undefined)).toEqual({ level: 1, isLevelOperated: false });
		expect(volcanoLevelFromName('未知の警報').level).toBe(1);
	});
});

describe('resolveVolcanoesByPrefecture', () => {
	function makeEntry(opts: {
		cityCodes: string[];
		volcanoName: string;
		levelName: string;
		/** 省略時は文言からの推定経路を通す */
		levelCode?: string;
		volcanoCode?: string;
	}) {
		return {
			reportDatetime: '2021-03-08T14:00:00+09:00',
			eventId: '508',
			areas: opts.cityCodes,
			volcanoInfos: [
				{
					type: '噴火警報・予報（対象火山）',
					items: [
						{
							name: opts.levelName,
							code: opts.levelCode,
							areas: [{ name: opts.volcanoName, code: opts.volcanoCode ?? '508' }],
						},
					],
				},
				{
					type: '噴火警報・予報（対象市町村等）',
					items: [
						{
							name: '火口周辺警報',
							code: '02',
							areas: [{ name: '鹿児島県三島村', code: opts.cityCodes[0] }],
						},
					],
				},
			],
		};
	}

	it('対象市町村コードの先頭2桁で都道府県に割り当てる', () => {
		const result = resolveVolcanoesByPrefecture([
			makeEntry({
				cityCodes: ['4630300'],
				volcanoName: '薩摩硫黄島',
				levelName: 'レベル２（火口周辺規制）',
			}),
		]);
		expect(result.get('46')).toEqual([
			{
				name: '薩摩硫黄島',
				code: '508',
				level: 2,
				levelText: 'レベル２（火口周辺規制）',
				isLevelOperated: true,
			},
		]);
	});

	it('公式コードがあればそれで警戒レベルを決める', () => {
		const result = resolveVolcanoesByPrefecture([
			makeEntry({
				cityCodes: ['4630300'],
				volcanoName: '薩摩硫黄島',
				levelName: 'レベル３（入山規制）',
				levelCode: '13',
			}),
		]);
		expect(result.get('46')?.[0].level).toBe(3);
	});

	it('複数県にまたがる火山は全ての県に割り当てる', () => {
		const result = resolveVolcanoesByPrefecture([
			makeEntry({
				cityCodes: ['4630300', '4521000'],
				volcanoName: '霧島山',
				levelName: 'レベル３（入山規制）',
			}),
		]);
		expect(result.get('46')?.[0].name).toBe('霧島山');
		expect(result.get('45')?.[0].name).toBe('霧島山');
	});

	it('同一県の複数火山をレベル降順で並べる', () => {
		const result = resolveVolcanoesByPrefecture([
			makeEntry({
				cityCodes: ['4630300'],
				volcanoName: '薩摩硫黄島',
				levelName: 'レベル２（火口周辺規制）',
			}),
			makeEntry({
				cityCodes: ['4620100'],
				volcanoName: '桜島',
				levelName: 'レベル３（入山規制）',
			}),
		]);
		const alerts = result.get('46');
		expect(alerts?.map((a) => a.name)).toEqual(['桜島', '薩摩硫黄島']);
		expect(alerts?.[0].level).toBe(3);
	});

	it('同一火山が複数の報に現れても重複しない', () => {
		const entry = makeEntry({
			cityCodes: ['4630300'],
			volcanoName: '薩摩硫黄島',
			levelName: 'レベル２（火口周辺規制）',
		});
		const result = resolveVolcanoesByPrefecture([entry, entry]);
		expect(result.get('46')).toHaveLength(1);
	});

	it('レベル運用外の火山も換算レベルで登録される', () => {
		const result = resolveVolcanoesByPrefecture([
			makeEntry({ cityCodes: ['1342100'], volcanoName: '西之島', levelName: '入山危険' }),
		]);
		expect(result.get('13')?.[0]).toMatchObject({
			name: '西之島',
			level: 3,
			isLevelOperated: false,
		});
	});

	it('対象火山の情報を持たないエントリは無視する', () => {
		const result = resolveVolcanoesByPrefecture([
			{
				areas: ['4630300'],
				volcanoInfos: [{ type: '噴火警報・予報（対象市町村等）', items: [] }],
			},
		]);
		expect(result.size).toBe(0);
	});

	it('上位 areas が無い場合は対象市町村等の情報から都道府県を拾う', () => {
		const result = resolveVolcanoesByPrefecture([
			{
				volcanoInfos: [
					{
						type: '噴火警報・予報（対象火山）',
						items: [{ name: 'レベル３（入山規制）', areas: [{ name: '浅間山', code: '331' }] }],
					},
					{
						type: '噴火警報・予報（対象市町村等）',
						items: [{ name: '火口周辺警報', areas: [{ name: '長野県小諸市', code: '2020800' }] }],
					},
				],
			},
		]);
		expect(result.get('20')?.[0].name).toBe('浅間山');
	});

	it('空配列でも例外を投げない', () => {
		expect(resolveVolcanoesByPrefecture([]).size).toBe(0);
	});
});

describe('volcanoDistanceFactor', () => {
	it('50km以内は満点（係数1.0）', () => {
		expect(volcanoDistanceFactor(0)).toBe(1);
		expect(volcanoDistanceFactor(50)).toBe(1);
	});

	it('300km以上は係数0', () => {
		expect(volcanoDistanceFactor(300)).toBe(0);
		expect(volcanoDistanceFactor(1000)).toBe(0);
	});

	it('50〜300kmは線形に減衰する', () => {
		expect(volcanoDistanceFactor(175)).toBeCloseTo(0.5, 10);
		expect(volcanoDistanceFactor(112.5)).toBeCloseTo(0.75, 10);
		expect(volcanoDistanceFactor(237.5)).toBeCloseTo(0.25, 10);
	});

	it('距離に対して単調減少する', () => {
		let prev = Infinity;
		for (let d = 0; d <= 350; d += 10) {
			const f = volcanoDistanceFactor(d);
			expect(f).toBeLessThanOrEqual(prev);
			prev = f;
		}
	});
});

describe('applyVolcanoDistanceDecay', () => {
	const TOKYO = { lat: 35.6895, lng: 139.6917 };
	const KAGOSHIMA = { lat: 31.5602, lng: 130.5581 };

	const COORDS = new Map([
		['503', { lat: 31.585, lng: 130.657 }], // 桜島（鹿児島市の目前）
		['326', { lat: 27.247, lng: 140.874 }], // 西之島（東京から約1000km南）
		['329', { lat: 24.751, lng: 141.289 }], // 硫黄島（東京から約1200km南）
		['308', { lat: 34.721, lng: 139.398 }], // 伊豆大島（東京から約120km）
	]);

	function alert(code: string, name: string): ResolvedVolcanoAlert {
		return { name, code, level: 3, levelText: 'レベル３（入山規制）', isLevelOperated: true };
	}

	it('代表地点の目前にある火山は満点で残る', () => {
		const [result] = applyVolcanoDistanceDecay([alert('503', '桜島')], KAGOSHIMA, COORDS);
		expect(result.name).toBe('桜島');
		expect(result.distanceFactor).toBe(1);
		expect(result.distanceKm).toBeLessThan(50);
	});

	it('約1000km離れた無人島の火山は係数0で落ちる（東京が常に1位になる問題の対策）', () => {
		const result = applyVolcanoDistanceDecay(
			[alert('326', '西之島'), alert('329', '硫黄島')],
			TOKYO,
			COORDS
		);
		expect(result).toEqual([]);
	});

	it('中距離の火山は部分的な係数で残る（伊豆大島 約120km）', () => {
		const [result] = applyVolcanoDistanceDecay([alert('308', '伊豆大島')], TOKYO, COORDS);
		expect(result.distanceFactor).toBeGreaterThan(0);
		expect(result.distanceFactor).toBeLessThan(1);
	});

	it('同じ都道府県内で距離に応じた差がつく', () => {
		const result = applyVolcanoDistanceDecay(
			[alert('326', '西之島'), alert('308', '伊豆大島')],
			TOKYO,
			COORDS
		);
		expect(result.map((a) => a.name)).toEqual(['伊豆大島']);
	});

	it('座標が不明な火山は都道府県一致を信じて満点で残す', () => {
		const [result] = applyVolcanoDistanceDecay([alert('999', '未登録の火山')], TOKYO, COORDS);
		expect(result.name).toBe('未登録の火山');
		expect(result.distanceKm).toBeNull();
		expect(result.distanceFactor).toBe(1);
	});

	it('返り値から内部用の code が除かれる', () => {
		const [result] = applyVolcanoDistanceDecay([alert('503', '桜島')], KAGOSHIMA, COORDS);
		expect(result).not.toHaveProperty('code');
	});
});

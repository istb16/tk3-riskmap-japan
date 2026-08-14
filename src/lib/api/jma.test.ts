import { describe, it, expect } from 'vitest';
import { activeCodesByClass10, levelsFromCodes, warningName } from './jma';

/**
 * コードと名称の対応は気象庁防災情報XMLフォーマットの
 * 「警報等情報要素コード管理表」（code.WeatherWarning）に準拠する。
 * <https://xml.kishou.go.jp/tec_material.html> の「コード管理表一式」
 */

describe('warningName', () => {
	it.each([
		['02', '暴風雪警報'],
		['03', '大雨警報'],
		['04', '洪水警報'],
		['05', '暴風警報'],
		['06', '大雪警報'],
		['07', '波浪警報'],
		['08', '高潮警報'],
		['09', '土砂災害警報'],
		['10', '大雨注意報'],
		['12', '大雪注意報'],
		['13', '風雪注意報'],
		['14', '雷注意報'],
		['15', '強風注意報'],
		['16', '波浪注意報'],
		['17', '融雪注意報'],
		['18', '洪水注意報'],
		['19', '高潮注意報'],
		['20', '濃霧注意報'],
		['21', '乾燥注意報'],
		['22', 'なだれ注意報'],
		['23', '低温注意報'],
		['24', '霜注意報'],
		['25', '着氷注意報'],
		['26', '着雪注意報'],
		['27', 'その他の注意報'],
		['29', '土砂災害注意報'],
		['32', '暴風雪特別警報'],
		['33', '大雨特別警報'],
		['35', '暴風特別警報'],
		['36', '大雪特別警報'],
		['37', '波浪特別警報'],
		['38', '高潮特別警報'],
		['39', '土砂災害特別警報'],
		['43', '大雨危険警報'],
		['48', '高潮危険警報'],
		['49', '土砂災害危険警報'],
	])('コード %s → %s', (code, name) => {
		expect(warningName(code)).toBe(name);
	});

	it('未知のコードは名称を捏造せずコード番号を明示する', () => {
		// 公式表で「未定・予約」のコード。将来運用開始されたらここに落ちる
		expect(warningName('42')).toBe('気象注意報（コード42）');
		expect(warningName('99')).toBe('気象注意報（コード99）');
	});
});

describe('activeCodesByClass10', () => {
	// 2026-08-14 の実レスポンス（千葉県・銚子地方気象台）を縮約したフィクスチャ。
	// 電文は現象群ごとに分かれており（VPWW55=洪水系 / VPWW56=大雨・土砂災害系）、
	// 同じ区域の現況が複数電文にまたがる。
	const bulletins = [
		{
			warning: {
				class10Items: [
					{ areaCode: '120010', kinds: [{ code: '10', status: '継続' }] },
					{ areaCode: '120020', kinds: [{ status: '発表警報・注意報はなし' }] },
					{ areaCode: '120030', kinds: [{ status: '発表警報・注意報はなし' }] },
				],
			},
		},
		{
			warning: {
				class10Items: [
					{ areaCode: '120010', kinds: [{ code: '49', status: '継続' }] },
					{ areaCode: '120020', kinds: [{ code: '29', status: '継続' }] },
					{ areaCode: '120030', kinds: [{ code: '29', status: '発表' }] },
				],
			},
		},
		{
			warning: {
				class10Items: [
					{ areaCode: '120010', kinds: [{ code: '15', status: '解除' }] },
					{ areaCode: '120030', kinds: [{ code: '16', status: '継続' }] },
				],
			},
		},
	];

	it('複数電文にまたがる同一区域の警報を合算する', () => {
		const result = activeCodesByClass10(bulletins);
		expect(result['120010']?.sort()).toEqual(['10', '49']);
		expect(result['120030']?.sort()).toEqual(['16', '29']);
	});

	it('「発表」と「継続」だけを発令中と数える', () => {
		const result = activeCodesByClass10(bulletins);
		// 120010 の強風注意報(15)は解除なので入らない
		expect(result['120010']).not.toContain('15');
		expect(result['120030']).toContain('29');
	});

	it('「発表警報・注意報はなし」（codeなし）の区域は索引に現れない', () => {
		const result = activeCodesByClass10([bulletins[0]]);
		expect(result['120020']).toBeUndefined();
		expect(result['120030']).toBeUndefined();
	});

	it('対象外の区域コードは混入しない', () => {
		const result = activeCodesByClass10(bulletins);
		expect(Object.keys(result).sort()).toEqual(['120010', '120020', '120030']);
	});

	it('複数電文に同じコードがあっても1回だけ数える', () => {
		const dup = [bulletins[1], bulletins[1]];
		expect(activeCodesByClass10(dup)['120010']).toEqual(['49']);
	});

	it('warning や class10Items を持たない電文があっても落ちない', () => {
		expect(activeCodesByClass10([{}, { warning: {} }])).toEqual({});
	});
});

describe('levelsFromCodes', () => {
	it('発令なし → 全カテゴリ none', () => {
		const { alertLevel, categoryLevels } = levelsFromCodes([]);
		expect(alertLevel).toBe('none');
		expect(categoryLevels).toEqual({
			rain: 'none',
			snow: 'none',
			wind: 'none',
			coast: 'none',
			temperature: 'none',
			other: 'none',
		});
	});

	it('解除コード(00)は何も引き上げない', () => {
		const { alertLevel, categoryLevels } = levelsFromCodes(['00']);
		expect(alertLevel).toBe('none');
		expect(categoryLevels.rain).toBe('none');
	});

	describe('カテゴリ割り当て', () => {
		it('大雨警報(03) → rain のみ warning', () => {
			const { alertLevel, categoryLevels } = levelsFromCodes(['03']);
			expect(alertLevel).toBe('warning');
			expect(categoryLevels.rain).toBe('warning');
			expect(categoryLevels.wind).toBe('none');
			expect(categoryLevels.snow).toBe('none');
		});

		it('大雨特別警報(33) → rain が special', () => {
			expect(levelsFromCodes(['33']).categoryLevels.rain).toBe('special');
		});

		it('暴風警報(05) → wind のみ warning', () => {
			const { categoryLevels } = levelsFromCodes(['05']);
			expect(categoryLevels.wind).toBe('warning');
			expect(categoryLevels.rain).toBe('none');
		});

		it('大雪警報(06) → snow', () => {
			expect(levelsFromCodes(['06']).categoryLevels.snow).toBe('warning');
		});

		it('洪水・雷・土砂災害は rain カテゴリに含める', () => {
			expect(levelsFromCodes(['04']).categoryLevels.rain).toBe('warning');
			expect(levelsFromCodes(['14']).categoryNames.rain).toBe('雷注意報');
			expect(levelsFromCodes(['29']).categoryLevels.rain).toBe('advisory');
			expect(levelsFromCodes(['09']).categoryLevels.rain).toBe('warning');
		});

		it('波浪・高潮は coast カテゴリ', () => {
			expect(levelsFromCodes(['07']).categoryLevels.coast).toBe('warning');
			expect(levelsFromCodes(['08']).categoryLevels.coast).toBe('warning');
			expect(levelsFromCodes(['16']).categoryLevels.coast).toBe('advisory');
			expect(levelsFromCodes(['19']).categoryLevels.coast).toBe('advisory');
		});

		it('波浪注意報(16)は snow / wind を引き上げない', () => {
			// 旧実装は 16 を「風雪注意報」としており、8月の東京に「大雪注意報」が計上されていた
			const { categoryLevels } = levelsFromCodes(['16']);
			expect(categoryLevels.coast).toBe('advisory');
			expect(categoryLevels.snow).toBe('none');
			expect(categoryLevels.wind).toBe('none');
		});

		it('低温・霜注意報は temperature カテゴリ', () => {
			expect(levelsFromCodes(['23']).categoryLevels.temperature).toBe('advisory');
			expect(levelsFromCodes(['24']).categoryNames.temperature).toBe('霜注意報');
		});

		it('濃霧・乾燥・着氷・その他は other カテゴリ', () => {
			expect(levelsFromCodes(['20']).categoryNames.other).toBe('濃霧注意報');
			expect(levelsFromCodes(['21']).categoryNames.other).toBe('乾燥注意報');
			expect(levelsFromCodes(['25']).categoryNames.other).toBe('着氷注意報');
			expect(levelsFromCodes(['27']).categoryLevels.other).toBe('advisory');
		});

		it('なだれ・融雪・着雪は snow カテゴリ', () => {
			expect(levelsFromCodes(['22']).categoryLevels.snow).toBe('advisory');
			expect(levelsFromCodes(['17']).categoryLevels.snow).toBe('advisory');
			expect(levelsFromCodes(['26']).categoryLevels.snow).toBe('advisory');
		});
	});

	describe('複合警報', () => {
		it('暴風雪警報(02)は wind と snow の両カテゴリに入る', () => {
			const { categoryLevels } = levelsFromCodes(['02']);
			expect(categoryLevels.wind).toBe('warning');
			expect(categoryLevels.snow).toBe('warning');
			expect(categoryLevels.rain).toBe('none');
		});

		it('暴風雪特別警報(32)は wind と snow の両方が special', () => {
			const { categoryLevels } = levelsFromCodes(['32']);
			expect(categoryLevels.wind).toBe('special');
			expect(categoryLevels.snow).toBe('special');
		});

		it('風雪注意報(13)は wind と snow の両カテゴリに入る', () => {
			const { categoryLevels } = levelsFromCodes(['13']);
			expect(categoryLevels.wind).toBe('advisory');
			expect(categoryLevels.snow).toBe('advisory');
		});
	});

	describe('危険警報（警戒レベル4相当）', () => {
		it('大雨危険警報(43) → rain が danger', () => {
			expect(levelsFromCodes(['43']).categoryLevels.rain).toBe('danger');
		});

		it('高潮危険警報(48) → coast が danger', () => {
			expect(levelsFromCodes(['48']).categoryLevels.coast).toBe('danger');
		});

		it('土砂災害危険警報(49) → rain が danger', () => {
			expect(levelsFromCodes(['49']).categoryLevels.rain).toBe('danger');
		});

		it('危険警報は警報より強く特別警報より弱い', () => {
			expect(levelsFromCodes(['03', '43']).categoryLevels.rain).toBe('danger');
			expect(levelsFromCodes(['43', '33']).categoryLevels.rain).toBe('special');
		});
	});

	describe('カテゴリごとの正式名称', () => {
		it('発令中の警報の正式名称を返す', () => {
			expect(levelsFromCodes(['20']).categoryNames.other).toBe('濃霧注意報');
			expect(levelsFromCodes(['03']).categoryNames.rain).toBe('大雨警報');
		});

		it('未発令のカテゴリは空文字', () => {
			expect(levelsFromCodes(['03']).categoryNames.snow).toBe('');
			expect(levelsFromCodes([]).categoryNames.rain).toBe('');
		});

		it('同一カテゴリでは最も強い警報の名称を採用する', () => {
			expect(levelsFromCodes(['10', '03']).categoryNames.rain).toBe('大雨警報');
			expect(levelsFromCodes(['03', '10']).categoryNames.rain).toBe('大雨警報');
			expect(levelsFromCodes(['10', '33']).categoryNames.rain).toBe('大雨特別警報');
		});

		it('複合警報は両カテゴリに名称が入る', () => {
			const { categoryNames } = levelsFromCodes(['02']);
			expect(categoryNames.wind).toBe('暴風雪警報');
			expect(categoryNames.snow).toBe('暴風雪警報');
		});
	});

	describe('生命危険度の低い注意報は重みを下げる', () => {
		it('雷・濃霧・乾燥・霜・着氷はスコア上「早期注意情報」相当として扱う', () => {
			// 気象庁の区分は注意報のままだが、屋内にいる人の生命は脅かされないため
			for (const code of ['14', '20', '21', '24', '25']) {
				const { alertLevel } = levelsFromCodes([code]);
				expect(alertLevel).toBe('early');
			}
		});

		it('表示上の名称は正式な注意報名のまま', () => {
			expect(levelsFromCodes(['20']).categoryNames.other).toBe('濃霧注意報');
			expect(warningName('20')).toBe('濃霧注意報');
		});

		it('大雨注意報など避難行動に直結する注意報は下げない', () => {
			expect(levelsFromCodes(['10']).categoryLevels.rain).toBe('advisory');
			expect(levelsFromCodes(['22']).categoryLevels.snow).toBe('advisory');
			expect(levelsFromCodes(['23']).categoryLevels.temperature).toBe('advisory');
		});

		it('同一カテゴリに両方あれば重い方が残る（雷注意報 + 大雨注意報）', () => {
			expect(levelsFromCodes(['14', '10']).categoryLevels.rain).toBe('advisory');
		});
	});

	describe('レベルの集約', () => {
		it('同一カテゴリに複数の警報があれば最も強いレベルを採る', () => {
			expect(levelsFromCodes(['10', '03']).categoryLevels.rain).toBe('warning');
			expect(levelsFromCodes(['03', '10']).categoryLevels.rain).toBe('warning');
		});

		it('異なるカテゴリのレベルは独立して保持される', () => {
			const { alertLevel, categoryLevels } = levelsFromCodes(['33', '15']);
			expect(categoryLevels.rain).toBe('special');
			expect(categoryLevels.wind).toBe('advisory');
			expect(alertLevel).toBe('special');
		});

		it('alertLevel は全カテゴリ中の最高レベル', () => {
			expect(levelsFromCodes(['10', '16', '15']).alertLevel).toBe('advisory');
			expect(levelsFromCodes(['10', '05']).alertLevel).toBe('warning');
			expect(levelsFromCodes(['10', '05', '48']).alertLevel).toBe('danger');
			expect(levelsFromCodes(['10', '05', '37']).alertLevel).toBe('special');
		});

		it('未知のコードは other カテゴリの注意報として扱う', () => {
			const { alertLevel, categoryLevels } = levelsFromCodes(['99']);
			expect(categoryLevels.other).toBe('advisory');
			expect(alertLevel).toBe('advisory');
		});
	});
});

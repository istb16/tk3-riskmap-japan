import { describe, it, expect } from 'vitest';
import {
	parseShindo,
	parseEpicenter,
	mergeQuakeEntries,
	summarizeByRegion,
	createMunicipalityResolver,
} from './jmaQuake';

/** 市区町村コードを持たない＝都道府県単位にフォールバックする地域キー。 */
const byPref = (prefCode: string) => ({ prefCode, cityCodes: [] });

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 1, 0, 0, 0);

function isoDaysAgo(days: number): string {
	return new Date(NOW - days * DAY_MS).toISOString();
}

describe('parseShindo', () => {
	it.each([
		['1', '1'],
		['4', '4'],
		['5-', '5-'],
		['5+', '5+'],
		['6-', '6-'],
		['6+', '6+'],
		['7', '7'],
	] as const)('%s → %s', (raw, expected) => {
		expect(parseShindo(raw)).toBe(expected);
	});

	it('速報値の 5@（震度5弱以上と推定）は 5弱として扱う', () => {
		expect(parseShindo('5@')).toBe('5-');
	});

	it('速報値の 6@ は 6弱として扱う', () => {
		expect(parseShindo('6@')).toBe('6-');
	});

	it('空文字・undefined・不正値 → null', () => {
		expect(parseShindo('')).toBeNull();
		expect(parseShindo(undefined)).toBeNull();
		expect(parseShindo(null)).toBeNull();
		expect(parseShindo('8')).toBeNull();
		expect(parseShindo('震度3')).toBeNull();
	});
});

describe('parseEpicenter', () => {
	it('深さ付きの座標をパースする', () => {
		expect(parseEpicenter('+32.6+130.7-10000/')).toEqual({
			lat: 32.6,
			lng: 130.7,
			depthKm: 10,
		});
	});

	it('深さは絶対値をkmに変換する', () => {
		expect(parseEpicenter('+35.0+140.0-50000/').depthKm).toBe(50);
	});

	it('深さが省略された座標も扱える', () => {
		expect(parseEpicenter('+35.0+140.0/')).toEqual({ lat: 35.0, lng: 140.0, depthKm: null });
	});

	it('南半球・西経の符号を扱える', () => {
		expect(parseEpicenter('-10.5-070.2-30000/')).toEqual({
			lat: -10.5,
			lng: -70.2,
			depthKm: 30,
		});
	});

	it('undefined・不正な文字列 → 全てnull', () => {
		expect(parseEpicenter(undefined)).toEqual({ lat: null, lng: null, depthKm: null });
		expect(parseEpicenter('不正')).toEqual({ lat: null, lng: null, depthKm: null });
	});
});

describe('mergeQuakeEntries', () => {
	it('評価期間(14日)より古い地震は除外する', () => {
		const merged = mergeQuakeEntries(
			[
				{ eid: 'old', at: isoDaysAgo(15), int: [{ code: '13', maxi: '4' }] },
				{ eid: 'new', at: isoDaysAgo(1), int: [{ code: '13', maxi: '3' }] },
			],
			NOW
		);
		expect(merged).toHaveLength(1);
		expect(merged[0].shindoByPref.get('13')).toBe('3');
	});

	it('1週間前の地震はまだ評価対象に含める', () => {
		const merged = mergeQuakeEntries(
			[{ eid: 'week-old', at: isoDaysAgo(8), int: [{ code: '13', maxi: '4' }] }],
			NOW
		);
		expect(merged).toHaveLength(1);
	});

	it('同一 eid の複数報をマージし、都道府県ごとに最大震度を採用する', () => {
		// 震度速報（第1報）で震度4、震源・震度情報（第2報）で震度5強が判明したケース
		const merged = mergeQuakeEntries(
			[
				{ eid: 'e1', at: isoDaysAgo(1), mag: '6.0', int: [{ code: '13', maxi: '5+' }] },
				{ eid: 'e1', at: isoDaysAgo(1), int: [{ code: '13', maxi: '4' }] },
			],
			NOW
		);
		expect(merged).toHaveLength(1);
		expect(merged[0].shindoByPref.get('13')).toBe('5+');
	});

	it('複数報にまたがる震源情報を補完する（新しい報を優先）', () => {
		const merged = mergeQuakeEntries(
			[
				{ eid: 'e1', at: isoDaysAgo(1), anm: '熊本県熊本地方', int: [{ code: '43', maxi: '3' }] },
				{ eid: 'e1', at: isoDaysAgo(1), mag: '5.5', cod: '+32.6+130.7-10000/' },
			],
			NOW
		);
		expect(merged[0].place).toBe('熊本県熊本地方');
		expect(merged[0].magnitude).toBe(5.5);
		expect(merged[0].epicenterLat).toBe(32.6);
		expect(merged[0].depthKm).toBe(10);
	});

	it('別の eid は別の地震として扱う', () => {
		const merged = mergeQuakeEntries(
			[
				{ eid: 'e1', at: isoDaysAgo(1), int: [{ code: '13', maxi: '3' }] },
				{ eid: 'e2', at: isoDaysAgo(2), int: [{ code: '13', maxi: '2' }] },
			],
			NOW
		);
		expect(merged).toHaveLength(2);
	});

	it('複数都道府県の震度をそれぞれ保持する', () => {
		const merged = mergeQuakeEntries(
			[
				{
					eid: 'e1',
					at: isoDaysAgo(1),
					int: [
						{ code: '43', maxi: '6+' },
						{ code: '42', maxi: '4' },
						{ code: '40', maxi: '2' },
					],
				},
			],
			NOW
		);
		expect(merged[0].shindoByPref.get('43')).toBe('6+');
		expect(merged[0].shindoByPref.get('42')).toBe('4');
		expect(merged[0].shindoByPref.get('40')).toBe('2');
	});

	it('eid・at が欠けたエントリは無視する', () => {
		const merged = mergeQuakeEntries(
			[
				{ at: isoDaysAgo(1), int: [{ code: '13', maxi: '4' }] },
				{ eid: 'e1', int: [{ code: '13', maxi: '4' }] },
			],
			NOW
		);
		expect(merged).toHaveLength(0);
	});

	it('震度情報を持たない報（震源に関する情報）も地震としては保持する', () => {
		const merged = mergeQuakeEntries([{ eid: 'e1', at: isoDaysAgo(1), mag: '4.0' }], NOW);
		expect(merged).toHaveLength(1);
		expect(merged[0].shindoByPref.size).toBe(0);
	});
});

describe('summarizeByRegion', () => {
	it('時間減衰後のスコアが最大の地震を選ぶ（規模最大ではない）', () => {
		// 12日前の震度6強(75×0.05≒4) より 直後の震度5弱(20×1.0=20) を選ぶ
		const merged = mergeQuakeEntries(
			[
				{ eid: 'big-old', at: isoDaysAgo(12), mag: '7.0', int: [{ code: '13', maxi: '6+' }] },
				{ eid: 'small-new', at: isoDaysAgo(0), mag: '5.0', int: [{ code: '13', maxi: '5-' }] },
			],
			NOW
		);
		const [summary] = summarizeByRegion(merged, [byPref('13')], NOW);
		expect(summary.strongest?.shindo).toBe('5-');
		expect(summary.strongest?.magnitude).toBe(5.0);
	});

	it('同時刻なら震度が高い方を選ぶ', () => {
		const merged = mergeQuakeEntries(
			[
				{ eid: 'a', at: isoDaysAgo(1), int: [{ code: '13', maxi: '3' }] },
				{ eid: 'b', at: isoDaysAgo(1), int: [{ code: '13', maxi: '5+' }] },
			],
			NOW
		);
		const [summary] = summarizeByRegion(merged, [byPref('13')], NOW);
		expect(summary.strongest?.shindo).toBe('5+');
	});

	it('群発性は直近7日間だけを数える（評価期間14日より短い）', () => {
		const merged = mergeQuakeEntries(
			[
				{ eid: 'a', at: isoDaysAgo(1), int: [{ code: '13', maxi: '1' }] },
				{ eid: 'a', at: isoDaysAgo(1), int: [{ code: '13', maxi: '2' }] },
				{ eid: 'b', at: isoDaysAgo(2), int: [{ code: '13', maxi: '1' }] },
				{ eid: 'c', at: isoDaysAgo(3), int: [{ code: '13', maxi: '1' }] },
				// 10日前は評価期間内だが群発性のカウントには入らない
				{ eid: 'd', at: isoDaysAgo(10), int: [{ code: '13', maxi: '1' }] },
			],
			NOW
		);
		const [summary] = summarizeByRegion(merged, [byPref('13')], NOW);
		expect(summary.recentQuakeCount).toBe(3);
	});

	it('その都道府県で観測がなければ strongest は null・回数0', () => {
		const merged = mergeQuakeEntries(
			[{ eid: 'a', at: isoDaysAgo(1), int: [{ code: '43', maxi: '4' }] }],
			NOW
		);
		const [summary] = summarizeByRegion(merged, [byPref('13')], NOW);
		expect(summary.strongest).toBeNull();
		expect(summary.recentQuakeCount).toBe(0);
	});

	it('地域キーの順序どおりに結果を返す', () => {
		const merged = mergeQuakeEntries(
			[
				{
					eid: 'a',
					at: isoDaysAgo(1),
					int: [
						{ code: '43', maxi: '6-' },
						{ code: '13', maxi: '2' },
					],
				},
			],
			NOW
		);
		const summaries = summarizeByRegion(merged, [byPref('13'), byPref('43')], NOW);
		expect(summaries[0].strongest?.shindo).toBe('2');
		expect(summaries[1].strongest?.shindo).toBe('6-');
	});
});

describe('summarizeByRegion 市区町村単位の震度', () => {
	/** 東京都：東京地方（23区）と 伊豆諸島 を別地域として扱うケース */
	const TOKYO_MAIN = { prefCode: '13', cityCodes: ['13101', '13102'] }; // 千代田区・中央区
	const IZU = { prefCode: '13', cityCodes: ['13361', '13402'] }; // 大島町・八丈町

	const quake = (cityShindo: Array<[string, string]>, prefMaxi: string) =>
		mergeQuakeEntries(
			[
				{
					eid: 'e1',
					at: isoDaysAgo(0),
					mag: '6.0',
					int: [
						{
							code: '13',
							maxi: prefMaxi,
							city: cityShindo.map(([code, maxi]) => ({ code, maxi })),
						},
					],
				},
			],
			NOW
		);

	it('市区町村単位の震度を地域ごとに切り分ける', () => {
		// 伊豆諸島で震度5強、23区は震度2。都道府県の最大は5強
		const merged = quake(
			[
				['1336100', '5+'],
				['1310100', '2'],
			],
			'5+'
		);
		const [main, izu] = summarizeByRegion(merged, [TOKYO_MAIN, IZU], NOW);
		expect(main.strongest?.shindo).toBe('2');
		expect(izu.strongest?.shindo).toBe('5+');
	});

	it('地域内の複数市区町村では最大震度を採用する', () => {
		const merged = quake(
			[
				['1336100', '3'],
				['1340200', '5-'],
			],
			'5-'
		);
		const [, izu] = summarizeByRegion(merged, [TOKYO_MAIN, IZU], NOW);
		expect(izu.strongest?.shindo).toBe('5-');
	});

	it('市区町村データがある報では、該当がない地域は観測なしとして扱う', () => {
		// 伊豆諸島のみ揺れた地震。23区に都道府県最大値(5強)を持ち込んではいけない
		const merged = quake([['1336100', '5+']], '5+');
		const [main, izu] = summarizeByRegion(merged, [TOKYO_MAIN, IZU], NOW);
		expect(main.strongest).toBeNull();
		expect(main.recentQuakeCount).toBe(0);
		expect(izu.strongest?.shindo).toBe('5+');
	});

	it('市区町村コードを持たない地域は都道府県の最大震度で補う', () => {
		// area.json が取得できず cityCodes が空になった場合でも震度をゼロにしない
		const merged = quake([['1336100', '5+']], '5+');
		const noCities = { prefCode: '13', cityCodes: [] };
		expect(summarizeByRegion(merged, [noCities], NOW)[0].strongest?.shindo).toBe('5+');
	});

	it('市区町村データが一切ない報（震度速報）は都道府県の最大震度で補う', () => {
		const merged = mergeQuakeEntries(
			[{ eid: 'e1', at: isoDaysAgo(0), int: [{ code: '13', maxi: '4' }] }],
			NOW
		);
		const [main, izu] = summarizeByRegion(merged, [TOKYO_MAIN, IZU], NOW);
		expect(main.strongest?.shindo).toBe('4');
		expect(izu.strongest?.shindo).toBe('4');
	});

	it('市の地理的分割は5桁コードで自動的に吸収される', () => {
		// area.json は釧路市を 0120601/0120602 に分けるが、地震情報は 0120600 で報じる
		const merged = mergeQuakeEntries(
			[
				{
					eid: 'e1',
					at: isoDaysAgo(0),
					int: [{ code: '01', maxi: '4', city: [{ code: '0120600', maxi: '4' }] }],
				},
			],
			NOW
		);
		const kushiro = { prefCode: '01', cityCodes: ['01206'] };
		expect(summarizeByRegion(merged, [kushiro], NOW)[0].strongest?.shindo).toBe('4');
	});

	it('別の地域の市区町村コードには反応しない', () => {
		const merged = quake([['1336100', '5+']], '5+');
		const other = { prefCode: '43', cityCodes: ['43213'] };
		expect(summarizeByRegion(merged, [other], NOW)[0].strongest).toBeNull();
	});

	it('観測回数も地域単位で数える', () => {
		const merged = [
			...quake([['1336100', '1']], '1'),
			...mergeQuakeEntries(
				[
					{
						eid: 'e2',
						at: isoDaysAgo(1),
						int: [{ code: '13', maxi: '2', city: [{ code: '1310100', maxi: '2' }] }],
					},
				],
				NOW
			),
		];
		const [main, izu] = summarizeByRegion(merged, [TOKYO_MAIN, IZU], NOW);
		expect(izu.recentQuakeCount).toBe(1);
		expect(main.recentQuakeCount).toBe(1);
	});
});

describe('createMunicipalityResolver（政令指定都市の行政区）', () => {
	// area.json 相当の自治体コード（5桁）。政令市は市単位でしか存在しない
	const MUNICIPALITIES = [
		'01100', // 札幌市
		'01202', // 函館市
		'01206', // 釧路市
		'01217', // 江別市
		'13101', // 千代田区（特別区は区そのものが自治体）
		'13361', // 大島町
		'22100', // 静岡市
		'22130', // 浜松市
		'27100', // 大阪市
		'27140', // 堺市
		'27202', // 岸和田市
	];
	const resolve = createMunicipalityResolver(MUNICIPALITIES);

	it('自治体コードとして存在すればそのまま返す', () => {
		expect(resolve('0121700')).toBe('01217');
		expect(resolve('1310100')).toBe('13101');
	});

	it('市の分割コードは5桁に落として一致する', () => {
		expect(resolve('0120601')).toBe('01206');
		expect(resolve('0120602')).toBe('01206');
		expect(resolve('0120600')).toBe('01206');
	});

	it('政令指定都市の行政区は親市に解決される', () => {
		expect(resolve('0110100')).toBe('01100'); // 札幌市中央区
		expect(resolve('0111000')).toBe('01100'); // 札幌市清田区（接頭辞パターンから外れる）
		expect(resolve('2310100')).toBe('23101'); // 未知の県は自分自身
	});

	it('コードが親市の直後に連番でない政令市も正しく解決する', () => {
		// 浜松市(22130)の区は 22138〜。接頭辞で丸めると静岡市(22100)になってしまう
		expect(resolve('2213800')).toBe('22130');
		expect(resolve('2214000')).toBe('22130');
	});

	it('同一県に複数の政令市があっても取り違えない', () => {
		// 大阪市(27100)の区は 27102〜27128、堺市(27140)の区は 27141〜27147
		expect(resolve('2712800')).toBe('27100'); // 大阪市中央区
		expect(resolve('2714400')).toBe('27140'); // 堺市西区（名前照合だと大阪市に誤マッチする）
		expect(resolve('2714700')).toBe('27140');
	});

	it('政令市より小さいコードは他県の自治体に流れない', () => {
		// 01 の最小自治体コードは 01100。それ未満は解決先がないので自分自身を返す
		expect(resolve('0100100')).toBe('01001');
	});

	it('該当県に自治体が無ければ自分自身を返す', () => {
		expect(resolve('9910000')).toBe('99100');
	});

	it('解決結果が地域の照合に反映される（札幌市の区から震度を得る）', () => {
		const merged = mergeQuakeEntries(
			[
				{
					eid: 'e1',
					at: isoDaysAgo(0),
					int: [{ code: '01', maxi: '4', city: [{ code: '0111000', maxi: '4' }] }],
				},
			],
			NOW
		);
		const sapporo = { prefCode: '01', cityCodes: ['01100'] };
		const [summary] = summarizeByRegion(merged, [sapporo], NOW, resolve);
		expect(summary.strongest?.shindo).toBe('4');
	});
});

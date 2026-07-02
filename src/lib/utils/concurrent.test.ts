import { describe, it, expect } from 'vitest';
import { runWithConcurrency } from './concurrent';

describe('runWithConcurrency', () => {
	it('全件を処理し順序を保つ', async () => {
		const result = await runWithConcurrency([1, 2, 3, 4, 5], async (n) => n * 2, 3);
		expect(result).toEqual([2, 4, 6, 8, 10]);
	});

	it('空配列は即座に空配列を返す', async () => {
		const result = await runWithConcurrency<number, number>([], async (n) => n, 5);
		expect(result).toEqual([]);
	});

	it('例外をスローした項目は null になり他は継続する', async () => {
		const result = await runWithConcurrency(
			[1, 2, 3],
			async (n) => {
				if (n === 2) throw new Error('fail');
				return n * 10;
			},
			3
		);
		expect(result).toEqual([10, null, 30]);
	});

	it('全件が失敗しても全て null を返す', async () => {
		const result = await runWithConcurrency(
			[1, 2, 3],
			async () => {
				throw new Error('always fails');
			},
			2
		);
		expect(result).toEqual([null, null, null]);
	});

	it('maxConcurrent が items.length を超えても正常動作する', async () => {
		const result = await runWithConcurrency([1, 2], async (n) => n * 3, 100);
		expect(result).toEqual([3, 6]);
	});

	it('index 引数が正しく渡る', async () => {
		const indices: number[] = [];
		await runWithConcurrency(
			['a', 'b', 'c'],
			async (_item, i) => {
				indices.push(i);
				return i;
			},
			1
		);
		expect(indices.sort((a, b) => a - b)).toEqual([0, 1, 2]);
	});

	it('maxConcurrent=1 でシリアル実行される', async () => {
		const order: number[] = [];
		await runWithConcurrency(
			[10, 20, 30],
			async (n) => {
				order.push(n);
				return n;
			},
			1
		);
		expect(order).toEqual([10, 20, 30]);
	});
});

/**
 * 最大同時実行数を制限しながら非同期処理を並列実行するユーティリティ。
 * items を maxConcurrent 個ずつのワーカーで処理し、失敗した項目は null を返す。
 */
export async function runWithConcurrency<T, R>(
	items: T[],
	fn: (item: T, index: number) => Promise<R | null>,
	maxConcurrent: number
): Promise<(R | null)[]> {
	const results: (R | null)[] = new Array(items.length).fill(null);
	let cursor = 0;

	async function worker(): Promise<void> {
		while (true) {
			// cursor++ はシングルスレッドで同期的に実行されるため競合しない
			const i = cursor++;
			if (i >= items.length) break;
			try {
				results[i] = await fn(items[i], i);
			} catch {
				results[i] = null;
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(maxConcurrent, items.length) }, () => worker()));
	return results;
}

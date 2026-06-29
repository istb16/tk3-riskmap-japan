/**
 * `Promise.allSettled` の結果を扱う共通ヘルパー。
 * 拒否されたPromiseを握りつぶし、成功値だけを取り出す処理を共通化する。
 */

/** fulfilled な結果に絞り込む型ガード（`.filter(isFulfilled)` で配列を安全にナローイング）。 */
export function isFulfilled<T>(result: PromiseSettledResult<T>): result is PromiseFulfilledResult<T> {
	return result.status === 'fulfilled';
}

/** fulfilled なら値を、rejected なら null を返す。 */
export function valueOrNull<T>(result: PromiseSettledResult<T>): T | null {
	return result.status === 'fulfilled' ? result.value : null;
}

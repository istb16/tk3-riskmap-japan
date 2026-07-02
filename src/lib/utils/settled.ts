/** fulfilled なら値を、rejected なら null を返す。 */
export function valueOrNull<T>(result: PromiseSettledResult<T>): T | null {
	return result.status === 'fulfilled' ? result.value : null;
}

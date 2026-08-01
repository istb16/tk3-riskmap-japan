/** 1日のミリ秒数。 */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** ある時刻からの経過日数（小数）。未来の時刻を渡すと負になる。 */
export function ageInDays(timeMs: number, now: number = Date.now()): number {
	return (now - timeMs) / DAY_MS;
}

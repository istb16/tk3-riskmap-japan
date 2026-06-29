/**
 * 全API共通のJSON取得ヘルパー。
 * `fetch` → ステータス検査 → 型付きJSONパースの定型処理を1か所に集約する。
 */
export async function fetchJson<T>(url: string, label: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, init);
	if (!res.ok) throw new Error(`${label} fetch failed: ${res.status}`);
	return (await res.json()) as T;
}

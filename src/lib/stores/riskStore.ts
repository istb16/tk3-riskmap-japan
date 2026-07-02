import { writable, derived } from 'svelte/store';
import type { RegionRisk } from '../types';
import { REGIONS } from '../regions';
import { calculateAllRegionRisks } from '../services/riskCalculator';

export const regions = writable<RegionRisk[]>([]);
export const loading = writable(false);
export const lastUpdated = writable<number | null>(null);
export const error = writable<string | null>(null);
export const selectedRegion = writable<RegionRisk | null>(null);

export const rankedRegions = derived(regions, ($r) =>
	[...$r].sort((a, b) => b.riskScore - a.riskScore)
);

let refreshTimer: ReturnType<typeof setInterval> | null = null;

export async function refreshAll() {
	loading.set(true);
	error.set(null);

	try {
		const { regions: data, failedApis } = await calculateAllRegionRisks(REGIONS);
		regions.set(data);
		lastUpdated.set(Date.now());
		error.set(
			failedApis.length > 0 ? `一部データの取得に失敗しました（${failedApis.join('・')}）` : null
		);
	} catch {
		error.set('データ取得に失敗しました');
	} finally {
		loading.set(false);
	}
}

export function startAutoRefresh(intervalMs = 5 * 60 * 1000) {
	if (refreshTimer) clearInterval(refreshTimer);
	refreshAll();
	refreshTimer = setInterval(refreshAll, intervalMs);
}

export function stopAutoRefresh() {
	if (refreshTimer) {
		clearInterval(refreshTimer);
		refreshTimer = null;
	}
}

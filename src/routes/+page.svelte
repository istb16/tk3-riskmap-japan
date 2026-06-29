<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { top10, rankedRegions, loading, lastUpdated, error, selectedRegion, startAutoRefresh, stopAutoRefresh } from '$lib/stores/riskStore';
	import type { Map as LeafletMap, Marker } from 'leaflet';

	let mapEl: HTMLDivElement = $state()!;
	let map: LeafletMap | null = null;
	let markers: Marker[] = [];
	let activeTab: 'ranking' | 'map' = $state('ranking');

	function scoreColor(score: number): string {
		if (score >= 61) return '#ef4444';
		if (score >= 31) return '#f59e0b';
		return '#22c55e';
	}

	function scoreBg(score: number): string {
		if (score >= 61) return 'bg-danger';
		if (score >= 31) return 'bg-warning';
		return 'bg-safe';
	}

	function scoreLabel(score: number): string {
		if (score >= 61) return '危険';
		if (score >= 31) return '注意';
		return '安全';
	}

	function riskIcon(type: string): string {
		const icons: Record<string, string> = {
			weather: '🌧️', earthquake: '🏔️', heat: '🔥', air: '💨'
		};
		return icons[type] ?? '⚠️';
	}

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
	}

	async function initMap() {
		if (typeof window === 'undefined') return;
		const L = (await import('leaflet')).default;
		await import('leaflet/dist/leaflet.css');

		if (map) { map.remove(); map = null; }

		map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: true }).setView([36.5, 136.0], 5);

		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution: '© OpenStreetMap contributors',
			maxZoom: 18
		}).addTo(map);

		updateMarkers(L);
	}

	function updateMarkers(L: typeof import('leaflet')): void {
		markers.forEach((m) => m.remove());
		markers = [];

		if (!map) return;
		const currentMap = map;

		$rankedRegions.forEach((region) => {
			const color = scoreColor(region.riskScore);
			const icon = L.divIcon({
				className: '',
				html: `<div style="
					width:40px;height:40px;border-radius:50%;
					background:${color};border:3px solid white;
					box-shadow:0 2px 8px rgba(0,0,0,0.4);
					display:flex;align-items:center;justify-content:center;
					color:white;font-weight:bold;font-size:11px;
					cursor:pointer;
				">${region.riskScore}</div>`,
				iconSize: [40, 40],
				iconAnchor: [20, 20]
			});

			const marker = L.marker([region.lat, region.lng], { icon })
				.addTo(currentMap)
				.on('click', () => selectedRegion.set(region));

			markers.push(marker);
		});
	}

	$effect(() => {
		if (activeTab === 'map' && mapEl && !map) {
			initMap();
		}
	});

	$effect(() => {
		if (map && $rankedRegions.length > 0) {
			import('leaflet').then(({ default: L }) => updateMarkers(L));
		}
	});

	function shareTwitter() {
		const text = `今、日本で最も危険な地域は「${$top10[0]?.name ?? ''}」！スコア${$top10[0]?.riskScore ?? 0}（${$top10[0]?.reasons[0] ?? ''}）\n#日本危険マップ #リアルタイム防災`;
		const url = encodeURIComponent(location.href);
		window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${url}`, '_blank');
	}

	onMount(() => {
		startAutoRefresh(5 * 60 * 1000);
	});

	onDestroy(() => {
		stopAutoRefresh();
		if (map) map.remove();
	});
</script>

<svelte:head>
	<title>日本リアルタイム危険マップ</title>
</svelte:head>

<div class="app">
	<!-- Header -->
	<header>
		<div class="header-inner">
			<div class="title-group">
				<span class="pulse-dot"></span>
				<h1>日本リアルタイム危険マップ</h1>
			</div>
			<div class="header-meta">
				{#if $loading}
					<span class="updating">更新中...</span>
				{:else if $lastUpdated}
					<span class="updated-at">最終更新 {formatTime($lastUpdated)}</span>
				{/if}
				<button class="share-btn" onclick={shareTwitter}>𝕏 シェア</button>
			</div>
		</div>
	</header>

	<!-- Tab Nav -->
	<nav class="tab-nav">
		<button class="tab-btn" class:active={activeTab === 'ranking'} onclick={() => activeTab = 'ranking'}>
			📊 危険ランキング
		</button>
		<button class="tab-btn" class:active={activeTab === 'map'} onclick={() => activeTab = 'map'}>
			🗺️ 地図ビュー
		</button>
	</nav>

	<!-- Error Banner -->
	{#if $error}
		<div class="error-banner">{$error}</div>
	{/if}

	<!-- Loading State -->
	{#if $loading && $top10.length === 0}
		<div class="loading-screen">
			<div class="spinner"></div>
			<p>全国15地域のデータを取得中...</p>
			<p class="loading-sub">気象 / 地震 / 大気汚染データを統合しています</p>
		</div>
	{/if}

	<!-- Ranking Tab -->
	{#if activeTab === 'ranking'}
		<main class="ranking-view">
			{#if $top10.length > 0}
				<!-- Top card -->
				<div class="top-alert {scoreBg($top10[0].riskScore)}">
					<div class="top-rank">⚠️ #1 最高危険地域</div>
					<div class="top-name">{$top10[0].name}</div>
					<div class="top-score">{$top10[0].riskScore}<span class="score-unit">/100</span></div>
					<div class="top-reasons">
						{#each $top10[0].reasons as reason}
							<span class="reason-chip">{reason}</span>
						{/each}
					</div>
				</div>

				<!-- Ranking list -->
				<ol class="rank-list">
					{#each $top10 as region, i}
						<li class="rank-item-wrap">
						<button
							class="rank-item"
							onclick={() => selectedRegion.set(region)}
						>
							<div class="rank-num" style="color:{scoreColor(region.riskScore)}">
								{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
							</div>
							<div class="rank-info">
								<div class="rank-name">{region.name}</div>
								<div class="rank-reasons">
									{#each region.reasons.slice(0, 2) as r}
										<span>{r}</span>
									{/each}
								</div>
								<div class="rank-types">
									{#each region.riskTypes as t}
										<span class="type-badge">{riskIcon(t)}</span>
									{/each}
								</div>
							</div>
							<div class="rank-score-wrap">
								<div class="rank-score" style="color:{scoreColor(region.riskScore)}">{region.riskScore}</div>
								<div class="rank-label" style="color:{scoreColor(region.riskScore)}">{scoreLabel(region.riskScore)}</div>
								<div class="score-bar-bg">
									<div class="score-bar-fill" style="width:{region.riskScore}%;background:{scoreColor(region.riskScore)}"></div>
								</div>
							</div>
						</button>
						</li>
					{/each}
				</ol>
			{/if}
		</main>
	{/if}

	<!-- Map Tab -->
	{#if activeTab === 'map'}
		<div class="map-view">
			<div bind:this={mapEl} class="leaflet-map"></div>
			<div class="map-legend">
				<span class="legend-item"><span class="dot" style="background:#22c55e"></span>安全(0-30)</span>
				<span class="legend-item"><span class="dot" style="background:#f59e0b"></span>注意(31-60)</span>
				<span class="legend-item"><span class="dot" style="background:#ef4444"></span>危険(61-100)</span>
			</div>
		</div>
	{/if}

	<!-- Detail Panel -->
	{#if $selectedRegion}
		<div class="detail-overlay" role="dialog" aria-modal="true">
			<button
				class="detail-backdrop"
				onclick={() => selectedRegion.set(null)}
				onkeydown={(e) => e.key === 'Escape' && selectedRegion.set(null)}
				aria-label="閉じる"
			></button>
			<div class="detail-panel" role="document">
				<button class="close-btn" onclick={() => selectedRegion.set(null)}>✕</button>

				<div class="detail-header" style="border-color:{scoreColor($selectedRegion.riskScore)}">
					<h2>{$selectedRegion.name}</h2>
					<div class="detail-score" style="color:{scoreColor($selectedRegion.riskScore)}">
						{$selectedRegion.riskScore}<span>/100</span>
					</div>
					<div class="detail-badge" style="background:{scoreColor($selectedRegion.riskScore)}">
						{scoreLabel($selectedRegion.riskScore)}
					</div>
				</div>

				<div class="detail-section">
					<h3>危険理由</h3>
					<ul class="detail-reasons">
						{#each $selectedRegion.reasons as r}
							<li>{r}</li>
						{/each}
					</ul>
				</div>

				{#if $selectedRegion.details.weather}
					<div class="detail-section">
						<h3>🌤️ 気象データ</h3>
						<div class="detail-grid">
							<div class="detail-item">
								<span class="detail-label">気温</span>
								<span class="detail-val">{$selectedRegion.details.weather.temperature.toFixed(1)}℃</span>
							</div>
							<div class="detail-item">
								<span class="detail-label">降水量</span>
								<span class="detail-val">{$selectedRegion.details.weather.precipitation.toFixed(1)}mm</span>
							</div>
							<div class="detail-item">
								<span class="detail-label">風速</span>
								<span class="detail-val">{$selectedRegion.details.weather.windSpeed.toFixed(0)}km/h</span>
							</div>
							<div class="detail-item">
								<span class="detail-label">警報</span>
								<span class="detail-val">{$selectedRegion.details.weather.alertLevel === 'none' ? 'なし' : $selectedRegion.details.weather.alertLevel}</span>
							</div>
						</div>
					</div>
				{/if}

				{#if $selectedRegion.details.earthquake?.magnitude}
					<div class="detail-section">
						<h3>🏔️ 地震データ（7日以内）</h3>
						<div class="detail-grid">
							<div class="detail-item">
								<span class="detail-label">マグニチュード</span>
								<span class="detail-val">M{$selectedRegion.details.earthquake.magnitude.toFixed(1)}</span>
							</div>
							<div class="detail-item">
								<span class="detail-label">深さ</span>
								<span class="detail-val">{$selectedRegion.details.earthquake.depth?.toFixed(0) ?? '不明'}km</span>
							</div>
						</div>
					</div>
				{/if}

				{#if $selectedRegion.details.air?.pm25 !== null && $selectedRegion.details.air?.pm25 !== undefined}
					<div class="detail-section">
						<h3>💨 大気汚染</h3>
						<div class="detail-grid">
							<div class="detail-item">
								<span class="detail-label">PM2.5</span>
								<span class="detail-val">{$selectedRegion.details.air.pm25.toFixed(1)}μg/m³</span>
							</div>
						</div>
					</div>
				{/if}

				<div class="detail-footer">
					<span>データソース: Open-Meteo / USGS / OpenAQ</span>
					<span>更新: {formatTime($selectedRegion.updatedAt)}</span>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	:global(*) {
		box-sizing: border-box;
		margin: 0;
		padding: 0;
	}

	:global(body) {
		font-family: -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif;
		background: #0f172a;
		color: #f1f5f9;
		min-height: 100vh;
	}

	.app {
		max-width: 600px;
		margin: 0 auto;
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	/* Header */
	header {
		background: #1e293b;
		border-bottom: 1px solid #334155;
		padding: 12px 16px;
		position: sticky;
		top: 0;
		z-index: 100;
	}
	.header-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.title-group {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.pulse-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #ef4444;
		animation: pulse 1.5s infinite;
		flex-shrink: 0;
	}
	@keyframes pulse {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.5; transform: scale(1.3); }
	}
	h1 {
		font-size: 14px;
		font-weight: 700;
		color: #f1f5f9;
		white-space: nowrap;
	}
	.header-meta {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.updating { font-size: 11px; color: #94a3b8; animation: pulse 1s infinite; }
	.updated-at { font-size: 11px; color: #64748b; }

	.share-btn {
		background: #1d9bf0;
		color: white;
		border: none;
		padding: 5px 12px;
		border-radius: 20px;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.share-btn:hover { background: #1a8cd8; }

	/* Tab Nav */
	.tab-nav {
		display: flex;
		background: #1e293b;
		border-bottom: 1px solid #334155;
	}
	.tab-btn {
		flex: 1;
		padding: 12px;
		border: none;
		background: transparent;
		color: #64748b;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		transition: all 0.2s;
	}
	.tab-btn.active {
		color: #f1f5f9;
		border-bottom-color: #ef4444;
	}

	/* Error */
	.error-banner {
		background: #7f1d1d;
		color: #fca5a5;
		padding: 8px 16px;
		font-size: 13px;
		text-align: center;
	}

	/* Loading */
	.loading-screen {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 60px 20px;
		gap: 12px;
		color: #94a3b8;
	}
	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid #334155;
		border-top-color: #ef4444;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	.loading-sub { font-size: 12px; color: #475569; }

	/* Top Alert */
	.top-alert {
		margin: 12px;
		border-radius: 12px;
		padding: 20px;
		text-align: center;
	}
	.bg-danger { background: linear-gradient(135deg, #7f1d1d, #991b1b); border: 2px solid #ef4444; }
	.bg-warning { background: linear-gradient(135deg, #78350f, #92400e); border: 2px solid #f59e0b; }
	.bg-safe { background: linear-gradient(135deg, #14532d, #166534); border: 2px solid #22c55e; }

	.top-rank { font-size: 12px; color: #fca5a5; font-weight: 600; margin-bottom: 4px; }
	.top-name { font-size: 28px; font-weight: 800; margin-bottom: 4px; }
	.top-score { font-size: 56px; font-weight: 900; line-height: 1; color: white; }
	.score-unit { font-size: 20px; font-weight: 400; color: rgba(255,255,255,0.7); }
	.top-reasons {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		justify-content: center;
		margin-top: 12px;
	}
	.reason-chip {
		background: rgba(0,0,0,0.3);
		border: 1px solid rgba(255,255,255,0.2);
		padding: 3px 10px;
		border-radius: 20px;
		font-size: 12px;
	}

	/* Rank List */
	.rank-list {
		list-style: none;
		padding: 0 12px 80px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.rank-item-wrap { list-style: none; }

	.rank-item {
		background: #1e293b;
		border: 1px solid #334155;
		border-radius: 10px;
		padding: 12px;
		display: flex;
		align-items: center;
		gap: 12px;
		cursor: pointer;
		transition: background 0.15s;
		width: 100%;
		text-align: left;
		color: inherit;
		font: inherit;
	}
	.rank-item:hover { background: #273549; }
	.rank-num { font-size: 20px; min-width: 36px; text-align: center; }
	.rank-info { flex: 1; min-width: 0; }
	.rank-name { font-size: 16px; font-weight: 700; }
	.rank-reasons {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: 2px;
	}
	.rank-reasons span { font-size: 11px; color: #94a3b8; }
	.rank-types { display: flex; gap: 4px; margin-top: 4px; }
	.type-badge { font-size: 14px; }
	.rank-score-wrap { text-align: right; min-width: 60px; }
	.rank-score { font-size: 24px; font-weight: 900; }
	.rank-label { font-size: 11px; font-weight: 600; }
	.score-bar-bg {
		height: 3px;
		background: #334155;
		border-radius: 2px;
		margin-top: 4px;
		overflow: hidden;
	}
	.score-bar-fill {
		height: 100%;
		border-radius: 2px;
		transition: width 0.5s;
	}

	/* Map */
	.map-view {
		flex: 1;
		position: relative;
		display: flex;
		flex-direction: column;
	}
	.leaflet-map {
		flex: 1;
		min-height: calc(100vh - 120px);
	}
	.map-legend {
		position: absolute;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(15,23,42,0.9);
		border: 1px solid #334155;
		border-radius: 20px;
		padding: 8px 16px;
		display: flex;
		gap: 12px;
		z-index: 1000;
		font-size: 12px;
	}
	.legend-item { display: flex; align-items: center; gap: 4px; }
	.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }

	/* Detail Panel */
	.detail-overlay {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}
	.detail-backdrop {
		position: absolute;
		inset: 0;
		background: rgba(0,0,0,0.6);
		border: none;
		cursor: pointer;
	}
	.detail-panel {
		background: #1e293b;
		width: 100%;
		max-width: 600px;
		border-radius: 20px 20px 0 0;
		padding: 20px;
		max-height: 85vh;
		overflow-y: auto;
		position: relative;
		z-index: 1;
	}
	.close-btn {
		position: absolute;
		top: 16px;
		right: 16px;
		background: #334155;
		border: none;
		color: #94a3b8;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		cursor: pointer;
		font-size: 14px;
	}
	.detail-header {
		border-left: 4px solid;
		padding-left: 12px;
		margin-bottom: 16px;
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.detail-header h2 { font-size: 22px; font-weight: 800; }
	.detail-score { font-size: 32px; font-weight: 900; }
	.detail-score span { font-size: 14px; color: #64748b; }
	.detail-badge {
		color: white;
		padding: 2px 10px;
		border-radius: 12px;
		font-size: 12px;
		font-weight: 700;
	}
	.detail-section { margin-bottom: 16px; }
	.detail-section h3 { font-size: 13px; color: #94a3b8; margin-bottom: 8px; font-weight: 600; }
	.detail-reasons { list-style: none; display: flex; flex-direction: column; gap: 4px; }
	.detail-reasons li {
		background: #0f172a;
		padding: 6px 10px;
		border-radius: 6px;
		font-size: 13px;
	}
	.detail-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.detail-item {
		background: #0f172a;
		padding: 8px 10px;
		border-radius: 6px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.detail-label { font-size: 11px; color: #64748b; }
	.detail-val { font-size: 15px; font-weight: 600; }
	.detail-footer {
		display: flex;
		justify-content: space-between;
		font-size: 11px;
		color: #475569;
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid #334155;
	}

	/* Ranking view */
	.ranking-view { flex: 1; overflow-y: auto; }
</style>

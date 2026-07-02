<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { rankedRegions, loading, lastUpdated, error, selectedRegion, startAutoRefresh, stopAutoRefresh } from '$lib/stores/riskStore';
	import { formatDateTime } from '$lib/services/riskCalculator';
	import type { JmaWarningArea } from '$lib/types';
	import type { Map as LeafletMap, Marker } from 'leaflet';

	let mapEl: HTMLDivElement = $state()!;
	let map: LeafletMap | null = null;
	let markers: Marker[] = [];
	let activeTab: 'ranking' | 'map' = $state('ranking');
	let mapInitialized = false;

	let jmaTooltip = $state<{ x: number; y: number; areas: JmaWarningArea[] } | null>(null);

	function showJmaTooltip(e: MouseEvent, areas: JmaWarningArea[]) {
		const x = Math.max(8, Math.min(e.clientX + 12, window.innerWidth - 334));
		const y = Math.max(8, Math.min(e.clientY + 12, window.innerHeight - 120));
		jmaTooltip = { x, y, areas };
	}
	function hideJmaTooltip() { jmaTooltip = null; }

	const SEISMO_POINTS = '0,14 18,14 23,7 28,21 33,14 55,14 60,3 65,25 70,12 75,20 80,14 110,14 115,9 120,19 125,14 160,14 165,5 170,23 175,8 180,22 185,14 215,14 220,12 225,16 230,14 260,14 265,4 270,24 275,11 280,17 285,14 315,14 320,8 325,20 330,14 365,14 370,6 375,22 380,10 385,18 390,14 420,14 425,9 430,19 435,14 460,14 465,3 470,25 475,8 480,20 485,14 510,14 515,11 520,17 525,14 555,14 560,7 565,21 570,14 590,14 600,14';

	let waveColor = $derived(scoreColor($rankedRegions[0]?.riskScore ?? 0));

	function scoreColor(score: number): string {
		if (score >= 61) return 'var(--danger)';
		if (score >= 31) return 'var(--caution)';
		return 'var(--safe)';
	}

	const RISK_TYPE: Record<string, { emoji: string; label: string }> = {
		weather:    { emoji: '🌧️', label: '気象' },
		earthquake: { emoji: '🏔️', label: '地震' },
		heat:       { emoji: '🔥', label: '熱波' },
		air:        { emoji: '💨', label: '大気' }
	};
	const riskTypeEmoji = (t: string) => RISK_TYPE[t]?.emoji ?? '⚠️';
	const riskTypeLabel = (t: string) => RISK_TYPE[t]?.label ?? '警報';

	function scoreLabel(score: number): string {
		if (score >= 61) return '危険';
		if (score >= 31) return '注意';
		return '安全';
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
			if (region.riskScore === 0) return;
			const color = scoreColor(region.riskScore);
			const icon = L.divIcon({
				className: '',
				html: `<div style="
					width:40px;height:40px;border-radius:50%;
					background:${color};border:2px solid rgba(255,255,255,0.25);
					box-shadow:0 2px 8px rgba(0,0,0,0.25);
					display:flex;align-items:center;justify-content:center;
					color:#ffffff;font-weight:700;font-size:12px;font-family:monospace;
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

	async function ensureMapInit() {
		if (mapInitialized || !mapEl) return;
		try {
			mapInitialized = true;
			await initMap();
		} catch {
			mapInitialized = false;
		}
	}

	$effect(() => {
		if (activeTab === 'map' && mapEl) {
			ensureMapInit().then(() => {
				requestAnimationFrame(() => map?.invalidateSize());
			});
		}
	});

	$effect(() => {
		// $rankedRegions を条件の前に読み取ることで、map が null でも依存関係として追跡させる
		const currentRegions = $rankedRegions;
		if (map && currentRegions.length > 0) {
			import('leaflet').then(({ default: L }) => updateMarkers(L));
		}
	});

	function shareTwitter() {
		const text = `今、日本で最も危険な都道府県は「${$rankedRegions[0]?.name ?? ''}」！スコア${$rankedRegions[0]?.riskScore ?? 0}（${$rankedRegions[0]?.reasons[0] ?? ''}）\n#日本危険マップ #リアルタイム防災`;
		const url = encodeURIComponent(location.href);
		window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${url}`, '_blank');
	}

	onMount(() => {
		startAutoRefresh(5 * 60 * 1000);
		const mq = window.matchMedia('(min-width: 1024px)');
		if (mq.matches) ensureMapInit();
		mq.addEventListener('change', (e) => { if (e.matches) ensureMapInit(); });
	});

	onDestroy(() => {
		stopAutoRefresh();
		if (map) map.remove();
	});
</script>

<svelte:head>
	<title>JAPAN RISK MAP</title>
</svelte:head>

<div class="app">
	<!-- Header -->
	<header>
		<div class="header-inner">
			<div class="header-left">
				<span class="live-badge">LIVE</span>
				<h1>JAPAN RISK MAP</h1>
			</div>
			<div class="header-right">
				{#if $loading}
					<span class="status-text blink">更新中</span>
				{:else if $lastUpdated}
					<span class="status-text">{formatTime($lastUpdated)}</span>
				{/if}
				<button class="share-btn" onclick={shareTwitter}>𝕏 シェア</button>
			</div>
		</div>
		<!-- Seismograph strip — signature element, color reflects max danger level -->
		<div class="seismo-wrap" aria-hidden="true">
			<div class="seismo-inner">
				<svg viewBox="0 0 600 28" preserveAspectRatio="none" class="seismo-svg">
					<polyline style="stroke:{waveColor}" class="seismo-line" points={SEISMO_POINTS} />
				</svg>
				<svg viewBox="0 0 600 28" preserveAspectRatio="none" class="seismo-svg">
					<polyline style="stroke:{waveColor}" class="seismo-line" points={SEISMO_POINTS} />
				</svg>
			</div>
		</div>
	</header>

	<!-- Tab Nav (hidden on desktop, both panels always rendered) -->
	<nav class="tab-nav">
		<button class="tab-btn" class:active={activeTab === 'ranking'} onclick={() => activeTab = 'ranking'}>
			ランキング
		</button>
		<button class="tab-btn" class:active={activeTab === 'map'} onclick={() => activeTab = 'map'}>
			地図
		</button>
	</nav>

	<!-- Error Banner -->
	{#if $error}
		<div class="error-banner">{$error}</div>
	{/if}

	<!-- Main Content Area -->
	<div class="content-area">

		<!-- Ranking Panel -->
		<section class="ranking-panel" class:tab-active={activeTab === 'ranking'}>
			{#if $loading && $rankedRegions.length === 0}
				<div class="loading-screen">
					<div class="spinner"></div>
					<p>全国データを取得中</p>
					<p class="loading-sub">気象 / 地震 / 大気質データを統合しています</p>
				</div>
			{/if}

			{#if $rankedRegions.length > 0}
				{@const top = $rankedRegions[0]}
				<!-- Top Alert Banner -->
				<div class="top-alert" style="background:{scoreColor(top.riskScore)}">
					<div class="top-rank">⚠️ #1 最高危険地域</div>
					<div class="top-name">{top.name}</div>
					<div class="top-score">{top.riskScore}<span class="score-unit">/100</span></div>
					{#if top.reasons.length > 0}
						<div class="top-reasons">
							{#each top.reasons as r}<span class="reason-chip">{r}</span>{/each}
						</div>
					{/if}
				</div>

				<!-- Rank List -->
				<ol class="rank-list">
					{#each $rankedRegions as city, i}
						<li>
							<button class="rank-item" onclick={() => selectedRegion.set(city)}>
								<div class="rank-num" style="color:{scoreColor(city.riskScore)}">
									{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
								</div>
								<div class="rank-info">
									<div class="rank-name-row">
										<span class="rank-name">{city.name}</span>
										{#if city.riskTypes.length > 0}
											<span class="rank-types">
												{#each city.riskTypes as t}
													<span class="type-badge">{riskTypeEmoji(t)}</span>
												{/each}
											</span>
										{/if}
										{#if city.details.jma && city.details.jma.areas.length > 0}
											<span
												class="jma-alert-badge"
												role="button"
												tabindex="0"
												aria-label="気象庁警報あり"
												onmouseenter={(e) => showJmaTooltip(e, city.details.jma!.areas)}
												onmouseleave={hideJmaTooltip}
											>⚠</span>
										{/if}
									</div>
									{#if city.reasons.length > 0}
										<div class="rank-reasons">
											{#each city.reasons as r}<span>{r}</span>{/each}
										</div>
									{/if}
								</div>
								<div class="rank-score-wrap">
									<div class="rank-score" style="color:{scoreColor(city.riskScore)}">{city.riskScore}</div>
									<div class="rank-label" style="color:{scoreColor(city.riskScore)}">{scoreLabel(city.riskScore)}</div>
									<div class="score-bar-bg">
										<div class="score-bar-fill" style="width:{city.riskScore}%;background:{scoreColor(city.riskScore)}"></div>
									</div>
								</div>
							</button>
						</li>
					{/each}
				</ol>
			{/if}
		</section>

		<!-- Map Panel -->
		<div class="map-panel" class:tab-active={activeTab === 'map'}>
			<div bind:this={mapEl} class="leaflet-map"></div>
			<div class="map-legend">
				<span class="legend-item"><span class="legend-dot" style="background:#16A34A"></span>安全 0–30</span>
				<span class="legend-item"><span class="legend-dot" style="background:#B45309"></span>注意 31–60</span>
				<span class="legend-item"><span class="legend-dot" style="background:#DC2626"></span>危険 61–100</span>
			</div>
		</div>

	</div>

	<!-- Detail Panel (fixed overlay) -->
	{#if $selectedRegion}
		<div class="detail-overlay" role="dialog" aria-modal="true">
			<button
				class="detail-backdrop"
				onclick={() => selectedRegion.set(null)}
				onkeydown={(e) => e.key === 'Escape' && selectedRegion.set(null)}
				aria-label="閉じる"
			></button>
			<div class="detail-panel" role="document">
				<button class="close-btn" onclick={() => selectedRegion.set(null)} aria-label="閉じる">✕</button>

				<div class="detail-header">
					<div class="detail-score-block">
						<div class="detail-score" style="color:{scoreColor($selectedRegion.riskScore)}">{$selectedRegion.riskScore}</div>
						<div class="detail-score-label" style="color:{scoreColor($selectedRegion.riskScore)}">{scoreLabel($selectedRegion.riskScore)}</div>
					</div>
					<div class="detail-title-block">
						<h2 class="detail-city">{$selectedRegion.name}</h2>
						<div class="detail-types">
							{#each $selectedRegion.riskTypes as t}
								<span class="type-tag">{riskTypeEmoji(t)} {riskTypeLabel(t)}</span>
							{/each}
						</div>
					</div>
				</div>

				{#if $selectedRegion.details.jma && $selectedRegion.details.jma.areas.length > 0}
					<div class="jma-alert-section">
						<div class="jma-alert-header">
							<span class="jma-alert-icon">⚠</span>
							<span class="jma-alert-title">気象庁 警報・注意報</span>
						</div>
						{#each $selectedRegion.details.jma.areas as area}
							<div class="jma-area-row">
								<span class="jma-area-name">{area.name}</span>
								<div class="jma-chips">
									{#each area.warnings as w}
										<span class="jma-chip" class:jma-chip-special={w.includes('特別警報')} class:jma-chip-warning={!w.includes('特別警報') && w.includes('警報')}>{w}</span>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				{/if}

				{#if $selectedRegion.scoreItems.length > 0}
					<div class="detail-section">
						<h3 class="section-label">スコア内訳</h3>
						<div class="breakdown-table">
							{#each $selectedRegion.scoreItems as item}
								<div class="breakdown-row">
									<span class="breakdown-label">{item.label}</span>
									<span class="breakdown-pts">+{item.points}</span>
								</div>
								{#if item.note}
									<div class="breakdown-note">{item.note}</div>
								{/if}
							{/each}
							<div class="breakdown-total">
								<span class="breakdown-total-label">合計</span>
								<span class="breakdown-total-val" style="color:{scoreColor($selectedRegion.riskScore)}">
									{#if $selectedRegion.rawScore > $selectedRegion.riskScore}
										{$selectedRegion.rawScore} → {$selectedRegion.riskScore}<small>（上限100）</small>
									{:else}
										{$selectedRegion.riskScore}
									{/if}
								</span>
							</div>
						</div>
					</div>
				{:else}
					<p class="no-risk-note">現在、危険情報はありません</p>
				{/if}

				<div class="detail-section">
					<h3 class="section-label">観測データ</h3>
					<div class="obs-grid">
						{#if $selectedRegion.details.weather}
							<div class="obs-cell">
								<span class="obs-label">🌡 気温</span>
								<span class="obs-val">{$selectedRegion.details.weather.temperature.toFixed(1)}<small>℃</small></span>
							</div>
							<div class="obs-cell">
								<span class="obs-label">🌧 降水量</span>
								<span class="obs-val">{$selectedRegion.details.weather.precipitation.toFixed(1)}<small>mm</small></span>
							</div>
							<div class="obs-cell">
								<span class="obs-label">💨 風速</span>
								<span class="obs-val">{$selectedRegion.details.weather.windSpeed.toFixed(0)}<small>km/h</small></span>
							</div>
						{/if}
						{#if $selectedRegion.details.air?.pm25 !== null && $selectedRegion.details.air?.pm25 !== undefined}
							<div class="obs-cell">
								<span class="obs-label">🌫 PM2.5</span>
								<span class="obs-val">{$selectedRegion.details.air.pm25.toFixed(1)}<small>μg/m³</small></span>
							</div>
						{/if}
					</div>
					{#if $selectedRegion.details.earthquake?.magnitude}
						<div class="eq-card">
							<div class="eq-row">
								<span class="eq-label">🏔 地震</span>
								<span class="eq-mag">M{$selectedRegion.details.earthquake.magnitude.toFixed(1)}</span>
								<span class="eq-info">深さ {$selectedRegion.details.earthquake.depth?.toFixed(0) ?? '—'}km</span>
								{#if $selectedRegion.details.earthquake.distanceKm !== null}
									<span class="eq-info">震源 {Math.round($selectedRegion.details.earthquake.distanceKm ?? 0)}km</span>
								{/if}
							</div>
							{#if $selectedRegion.details.earthquake.time}
								<span class="eq-time">{formatDateTime($selectedRegion.details.earthquake.time)}</span>
							{/if}
						</div>
					{/if}
				</div>

				<div class="detail-footer">
					<span>気象庁 / Open-Meteo / USGS</span>
					<span>{formatTime($selectedRegion.updatedAt)}</span>
				</div>
			</div>
		</div>
	{/if}

	{#if jmaTooltip}
		<div
			class="jma-fixed-tooltip"
			style="left:{jmaTooltip.x}px; top:{jmaTooltip.y}px;"
		>
			{#each jmaTooltip.areas as area}
				<div class="jma-tooltip-area">
					<span class="jma-tooltip-name">{area.name}</span>
					<div class="jma-tooltip-warnings">
						{#each area.warnings as w}
							<span class="jma-tooltip-chip">{w}</span>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	/* ─── Design tokens ─── */
	:root {
		--bg:         #F0F4F8;
		--surface:    #FFFFFF;
		--surface-hi: #E5EDF6;
		--border:     #C8D8E8;
		--border-hi:  #A0BAD0;
		--safe:       #16A34A;
		--caution:    #B45309;
		--danger:     #DC2626;
		--text:       #0A1828;
		--text-2:     #445E78;
		--text-dim:   #8AAABE;
		--live:       #1666CC;
		--mono:       'Courier New', 'SF Mono', 'Consolas', monospace;
	}

	:global(*) { box-sizing: border-box; margin: 0; padding: 0; }

	:global(body) {
		font-family: -apple-system, 'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic UI', sans-serif;
		background: var(--bg);
		color: var(--text);
		min-height: 100vh;
	}

	/* ─── App shell ─── */
	.app {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	/* ─── Header ─── */
	header {
		background: var(--surface);
		border-bottom: 1px solid var(--border);
		position: sticky;
		top: 0;
		z-index: 200;
	}

	.header-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 16px;
		gap: 12px;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
	}

	.live-badge {
		font-family: var(--mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.12em;
		color: var(--live);
		border: 1px solid var(--live);
		padding: 2px 5px;
		border-radius: 2px;
		flex-shrink: 0;
		animation: blink 2s steps(1) infinite;
	}

	@keyframes blink {
		0%, 49% { opacity: 1; }
		50%, 100% { opacity: 0.3; }
	}

	h1 {
		font-size: 14px;
		font-weight: 700;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		letter-spacing: -0.01em;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-shrink: 0;
	}

	.status-text {
		font-family: var(--mono);
		font-size: 11px;
		color: var(--text-2);
	}

	.blink { animation: blink 1s steps(1) infinite; }

	.share-btn {
		background: transparent;
		border: 1px solid var(--border-hi);
		color: var(--text-2);
		padding: 5px 12px;
		border-radius: 4px;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s;
		white-space: nowrap;
	}
	.share-btn:hover { border-color: var(--text-2); color: var(--text); }
	.share-btn:focus-visible { outline: 2px solid var(--live); outline-offset: 2px; }

	/* ─── Seismograph strip ─── */
	.seismo-wrap {
		height: 26px;
		overflow: hidden;
		background: var(--bg);
		border-top: 1px solid var(--border);
	}

	.seismo-inner {
		display: flex;
		width: 200%;
		height: 100%;
		animation: seismo-scroll 18s linear infinite;
	}

	@media (prefers-reduced-motion: reduce) {
		.seismo-inner { animation: none; }
	}

	@keyframes seismo-scroll {
		from { transform: translateX(0); }
		to   { transform: translateX(-50%); }
	}

	.seismo-svg {
		width: 50%;
		height: 26px;
		flex-shrink: 0;
	}

	.seismo-line {
		fill: none;
		stroke-width: 1.5px;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition: stroke 1.2s ease;
	}

	/* ─── Tab Nav (mobile only; hidden on desktop) ─── */
	.tab-nav {
		display: flex;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
	}

	.tab-btn {
		flex: 1;
		padding: 11px;
		border: none;
		background: transparent;
		color: var(--text-2);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		transition: color 0.15s, border-color 0.15s;
		letter-spacing: 0.02em;
	}
	.tab-btn.active { color: var(--text); border-bottom-color: var(--live); }
	.tab-btn:focus-visible { outline: 2px solid var(--live); outline-offset: -2px; }

	/* ─── Error ─── */
	.error-banner {
		background: #FEE2E2;
		color: #991B1B;
		padding: 8px 16px;
		font-size: 13px;
		text-align: center;
		border-bottom: 1px solid #FECACA;
	}

	/* ─── Content area: mobile = single column, desktop = side by side ─── */
	.content-area {
		flex: 1;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	/* ─── Ranking panel ─── */
	.ranking-panel {
		display: none;
		flex-direction: column;
		overflow-y: auto;
	}
	.ranking-panel.tab-active { display: flex; }

	/* ─── Map panel ─── */
	.map-panel {
		display: none;
		flex-direction: column;
		position: relative;
	}
	.map-panel.tab-active { display: flex; flex: 1; }

	/* ─── Desktop layout ─── */
	@media (min-width: 1024px) {
		.tab-nav { display: none; }

		.content-area {
			flex-direction: row;
		}

		.ranking-panel {
			display: flex !important;
			width: clamp(340px, 32vw, 480px);
			flex-shrink: 0;
			border-right: 1px solid var(--border);
			overflow-y: auto;
		}

		.map-panel {
			display: flex !important;
			flex: 1;
			min-width: 0;
		}

		.leaflet-map {
			height: 100% !important;
			min-height: unset !important;
		}
	}

	/* ─── Loading ─── */
	.loading-screen {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 60px 20px;
		gap: 12px;
		color: var(--text-2);
		flex: 1;
	}

	.spinner {
		width: 36px;
		height: 36px;
		border: 2px solid var(--border);
		border-top-color: var(--live);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	.loading-sub { font-size: 12px; color: var(--text-dim); }

	/* ─── Top Alert Banner ─── */
	.top-alert {
		margin: 12px 12px 4px;
		padding: 18px 16px 16px;
		border-radius: 12px;
		text-align: center;
		color: #fff;
	}

	.top-rank {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.06em;
		opacity: 0.9;
		margin-bottom: 6px;
	}

	.top-name {
		font-size: 36px;
		font-weight: 900;
		letter-spacing: -0.03em;
		line-height: 1.1;
		font-feature-settings: "palt" 1;
		margin-bottom: 4px;
	}

	.top-score {
		font-family: var(--mono);
		font-size: 64px;
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.04em;
		margin-bottom: 12px;
	}

	.score-unit {
		font-size: 0.35em;
		font-weight: 400;
		opacity: 0.7;
		letter-spacing: 0;
	}

	.top-reasons {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		justify-content: center;
	}

	.reason-chip {
		background: rgba(0, 0, 0, 0.25);
		padding: 4px 12px;
		border-radius: 20px;
		font-size: 12px;
		font-weight: 600;
	}

	/* ─── Rank list ─── */
	.rank-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px 12px 16px;
	}

	.rank-item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		cursor: pointer;
		color: var(--text);
		font: inherit;
		text-align: left;
		transition: background 0.15s;
	}
	.rank-item:hover { background: var(--surface-hi); }
	.rank-item:focus-visible { outline: 2px solid var(--live); outline-offset: -2px; }

	.rank-num {
		font-family: var(--mono);
		font-size: 18px;
		font-weight: 700;
		min-width: 34px;
		text-align: center;
		flex-shrink: 0;
		letter-spacing: -0.01em;
	}

	.rank-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.rank-name-row {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.rank-name {
		font-size: 18px;
		font-weight: 800;
		letter-spacing: -0.01em;
		font-feature-settings: "palt" 1;
	}

	.rank-reasons {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.rank-reasons span {
		font-size: 11px;
		color: var(--text-2);
		line-height: 1.4;
	}

	.rank-types {
		display: flex;
		gap: 2px;
		align-items: center;
	}

	.type-badge { font-size: 14px; }

	.rank-score-wrap {
		flex-shrink: 0;
		text-align: right;
		min-width: 56px;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
	}

	.rank-score {
		font-family: var(--mono);
		font-size: 28px;
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.03em;
		font-variant-numeric: tabular-nums;
	}

	.rank-label {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.05em;
	}

	.score-bar-bg {
		width: 56px;
		height: 3px;
		background: var(--border);
		border-radius: 2px;
		overflow: hidden;
		margin-top: 2px;
	}

	.score-bar-fill {
		height: 100%;
		border-radius: 2px;
		transition: width 0.6s ease;
	}

	/* ─── Map ─── */
	.leaflet-map {
		flex: 1;
		min-height: calc(100svh - 150px);
		width: 100%;
	}

	.map-legend {
		position: absolute;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(255, 255, 255, 0.95);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 7px 14px;
		display: flex;
		gap: 14px;
		z-index: 1000;
		font-family: var(--mono);
		font-size: 11px;
		color: var(--text-2);
		white-space: nowrap;
	}

	.legend-item { display: flex; align-items: center; gap: 5px; }
	.legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

	/* ─── Detail Panel ─── */
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
		background: rgba(0, 0, 0, 0.7);
		border: none;
		cursor: pointer;
	}

	.detail-panel {
		background: var(--surface);
		border: 1px solid var(--border);
		border-bottom: none;
		width: 100%;
		max-width: 640px;
		border-radius: 12px 12px 0 0;
		padding: 20px 16px;
		max-height: 85vh;
		overflow-y: auto;
		position: relative;
		z-index: 1;
	}

	.close-btn {
		position: absolute;
		top: 14px;
		right: 14px;
		background: var(--surface-hi);
		border: 1px solid var(--border);
		color: var(--text-2);
		width: 28px;
		height: 28px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.close-btn:hover { color: var(--text); }
	.close-btn:focus-visible { outline: 2px solid var(--live); outline-offset: 2px; }

	.detail-header {
		display: flex;
		align-items: flex-start;
		gap: 14px;
		padding-bottom: 16px;
		margin-bottom: 16px;
		border-bottom: 1px solid var(--border);
	}

	.detail-score-block { flex-shrink: 0; text-align: center; }

	.detail-score {
		font-family: var(--mono);
		font-size: 52px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		letter-spacing: -0.04em;
	}

	.detail-score-label {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-align: center;
		margin-top: 2px;
	}

	.detail-title-block { flex: 1; min-width: 0; }

	.detail-city {
		font-size: 28px;
		font-weight: 900;
		letter-spacing: -0.02em;
		font-feature-settings: "palt" 1;
		margin-bottom: 6px;
	}

	.detail-types { display: flex; gap: 5px; flex-wrap: wrap; }

	.detail-section { margin-bottom: 14px; }

	.section-label {
		font-family: var(--mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.12em;
		color: var(--text-dim);
		text-transform: uppercase;
		margin-bottom: 7px;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	/* ─── Score breakdown ─── */
	.breakdown-table {
		border: 1px solid var(--border);
		border-radius: 6px;
		overflow: hidden;
	}

	.breakdown-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		padding: 6px 12px;
		border-bottom: 1px solid var(--border);
		gap: 8px;
		background: var(--surface);
	}

	.breakdown-label {
		font-size: 13px;
		color: var(--text);
		flex: 1;
		min-width: 0;
	}

	.breakdown-pts {
		font-family: var(--mono);
		font-size: 13px;
		font-weight: 700;
		color: #1d4ed8;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.breakdown-note {
		padding: 2px 12px 5px;
		font-size: 11px;
		color: var(--text-dim);
		border-bottom: 1px solid var(--border);
		background: var(--surface-hi);
		font-style: italic;
	}

	.breakdown-total {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 12px;
		background: var(--surface-hi);
		border-top: 1px solid var(--border-hi);
	}

	.breakdown-total-label {
		font-family: var(--mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.1em;
		color: var(--text-dim);
		text-transform: uppercase;
	}

	.breakdown-total-val {
		font-family: var(--mono);
		font-size: 18px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
	}

	.breakdown-total-val small {
		font-size: 10px;
		font-weight: 400;
		color: var(--text-dim);
		margin-left: 3px;
		letter-spacing: 0;
	}

	.detail-footer {
		display: flex;
		justify-content: space-between;
		font-family: var(--mono);
		font-size: 10px;
		color: var(--text-dim);
		padding-top: 10px;
		border-top: 1px solid var(--border);
		margin-top: 4px;
	}

	/* ─── JMA alert badge in rank list ─── */
	.jma-alert-badge {
		font-size: 13px;
		color: #B45309;
		cursor: default;
		line-height: 1;
		user-select: none;
	}

	/* ─── JMA fixed tooltip ─── */
	.jma-fixed-tooltip {
		position: fixed;
		background: #1e293b;
		color: #e2e8f0;
		border: 1px solid #334155;
		border-radius: 8px;
		padding: 10px 14px;
		z-index: 9999;
		max-width: 320px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
		pointer-events: none;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.jma-tooltip-area { display: flex; flex-direction: column; gap: 5px; }

	.jma-tooltip-name {
		font-size: 11px;
		font-weight: 700;
		color: #94a3b8;
		letter-spacing: 0.02em;
	}

	.jma-tooltip-warnings { display: flex; flex-wrap: wrap; gap: 3px; }

	.jma-tooltip-chip {
		font-size: 11px;
		font-weight: 600;
		background: #FDE68A;
		color: #78350F;
		border-radius: 3px;
		padding: 2px 7px;
	}

	/* ─── JMA alert section in detail panel ─── */
	.jma-alert-section {
		background: #FFFBEB;
		border: 1px solid #FDE68A;
		border-radius: 8px;
		padding: 12px;
		margin-bottom: 14px;
	}

	.jma-alert-header {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 10px;
	}

	.jma-alert-icon { font-size: 14px; }

	.jma-alert-title {
		font-size: 11px;
		font-weight: 700;
		color: #92400E;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.jma-area-row {
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding: 6px 0;
	}

	.jma-area-row + .jma-area-row {
		border-top: 1px solid rgba(253, 230, 138, 0.6);
	}

	.jma-area-name {
		font-size: 12px;
		font-weight: 700;
		color: #78350F;
	}

	.jma-chips { display: flex; flex-wrap: wrap; gap: 4px; }

	.jma-chip {
		font-size: 11px;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 3px;
		background: #FEF3C7;
		color: #92400E;
		border: 1px solid #FDE68A;
	}

	.jma-chip-special {
		background: #FEE2E2;
		color: #991B1B;
		border-color: #FECACA;
	}

	.jma-chip-warning {
		background: #FEF3C7;
		color: #92400E;
		border-color: #FDE68A;
	}

	/* ─── 観測データ grid ─── */
	.obs-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 5px;
		margin-bottom: 5px;
	}

	.obs-cell {
		background: var(--bg);
		border: 1px solid var(--border);
		padding: 9px 11px;
		border-radius: 6px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.obs-label {
		font-size: 11px;
		color: var(--text-2);
	}

	.obs-val {
		font-size: 20px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.obs-val small {
		font-size: 11px;
		font-weight: 400;
		color: var(--text-2);
		margin-left: 1px;
	}

	/* ─── 地震カード ─── */
	.eq-card {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.eq-row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.eq-label {
		font-size: 12px;
		font-weight: 700;
		color: var(--text-2);
	}

	.eq-mag {
		font-family: var(--mono);
		font-size: 22px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--danger);
		letter-spacing: -0.02em;
	}

	.eq-info {
		font-size: 12px;
		color: var(--text-2);
	}

	.eq-time {
		font-family: var(--mono);
		font-size: 11px;
		color: var(--text-dim);
	}

	/* ─── no risk note ─── */
	.no-risk-note {
		font-size: 13px;
		color: var(--text-dim);
		text-align: center;
		padding: 10px 0 14px;
	}

	/* ─── Tablet tweaks ─── */
	@media (min-width: 640px) {
		h1 { font-size: 15px; }
		.top-alert { margin: 14px 14px 6px; }
		.rank-list { padding: 8px 14px 16px; gap: 8px; }
	}
</style>

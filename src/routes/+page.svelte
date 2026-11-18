<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import {
		rankedRegions,
		loading,
		lastUpdated,
		error,
		selectedRegion,
		startAutoRefresh,
		stopAutoRefresh,
	} from '#lib/stores/riskStore.ts';
	import { formatDateTime } from '#lib/services/riskCalculator.ts';
	import {
		SHINDO_LABELS,
		TSUNAMI_LABELS,
		riskBand,
		RISK_BANDS,
		SWARM_WINDOW_DAYS,
	} from '#lib/services/scoringRules.ts';
	import { pinnedIds, togglePinned } from '#lib/stores/pinnedStore.ts';
	import PinIcon from '#lib/components/PinIcon.svelte';
	import { buildLabel, formatBuildTime, BUILD_TIME } from '#lib/utils/buildInfo.ts';
	import { getWeatherLabel } from '#lib/api/weather.ts';
	import { splitRegionName } from '#lib/utils/regionName.ts';
	import { buildSearchIndex, matchesSearch, normalizeForSearch } from '#lib/utils/regionFilter.ts';
	import { REGIONS } from '#lib/regions.ts';
	import type { JmaWarningArea, RegionRisk } from '#lib/types.ts';
	import type { Map as LeafletMap, Marker } from 'leaflet';

	let mapEl: HTMLDivElement = $state()!;
	let map: LeafletMap | null = null;
	let markers: Marker[] = [];
	let activeTab: 'ranking' | 'map' = $state('ranking');
	let mapInitialized = false;
	/**
	 * 破棄済みか。地図の初期化は動的 import を挟み、`invalidateSize` は
	 * `requestAnimationFrame` 越しに走るので、どちらも破棄後に完了しうる。
	 * 破棄後の Leaflet インスタンスに触ると内部状態が消えていて例外になる
	 * （`_leaflet_pos` の undefined 参照）。
	 */
	let destroyed = false;

	let jmaTooltip = $state<{ x: number; y: number; areas: JmaWarningArea[] } | null>(null);

	function showJmaTooltip(e: MouseEvent, areas: JmaWarningArea[]) {
		const x = Math.max(8, Math.min(e.clientX + 12, window.innerWidth - 334));
		const y = Math.max(8, Math.min(e.clientY + 12, window.innerHeight - 120));
		jmaTooltip = { x, y, areas };
	}
	function hideJmaTooltip() {
		jmaTooltip = null;
	}

	const SEISMO_POINTS =
		'0,14 18,14 23,7 28,21 33,14 55,14 60,3 65,25 70,12 75,20 80,14 110,14 115,9 120,19 125,14 160,14 165,5 170,23 175,8 180,22 185,14 215,14 220,12 225,16 230,14 260,14 265,4 270,24 275,11 280,17 285,14 315,14 320,8 325,20 330,14 365,14 370,6 375,22 380,10 385,18 390,14 420,14 425,9 430,19 435,14 460,14 465,3 470,25 475,8 480,20 485,14 510,14 515,11 520,17 525,14 555,14 560,7 565,21 570,14 590,14 600,14';

	// 帯の定義は scoringRules.ts（気象庁の警戒レベルに対応）に集約している
	const scoreColor = (score: number) => `var(${riskBand(score).colorVar})`;

	/**
	 * 凡例。マーカーと同じ比率でドットの大小をつけ、サイズが危険度を表すことを凡例自体で示す。
	 * 帯の範囲・色・サイズはすべて RISK_BANDS から導く（UIに数値を持たせない）。
	 */
	const legendItems = RISK_BANDS.map((band, i) => ({
		label: band.label,
		colorVar: band.colorVar,
		dotPx: Math.round(band.markerSizePx / 4),
		// RISK_BANDS は高い順なので、ひとつ上の帯の下限-1 がこの帯の上限になる
		range: i === 0 ? `${band.min}–100` : `${band.min}–${RISK_BANDS[i - 1].min - 1}`,
	})).reverse();

	let waveColor = $derived(scoreColor($rankedRegions[0]?.riskScore ?? 0));

	// 地域フィルタ。順位番号は絞り込み前に確定させてから絞る —— 番号は全国順位を指すので、
	// 絞り込みで振り直してはいけない（スコアは絶対尺度なので、23点の地域に🥇が付くと
	// 「注意」の色なのに1位という矛盾した表示になる）。
	const SEARCH_INDEX = buildSearchIndex(REGIONS);
	let filterQuery = $state('');
	let normalizedQuery = $derived(normalizeForSearch(filterQuery));
	let rankedWithRank = $derived($rankedRegions.map((region, i) => ({ region, rank: i + 1 })));
	let visibleRanked = $derived(
		rankedWithRank.filter(({ region }) => matchesSearch(SEARCH_INDEX, region.id, normalizedQuery))
	);
	let filtering = $derived(normalizedQuery !== '');

	/**
	 * お気に入り（ピン留め）セクション。
	 *
	 * `visibleRanked` から絞るので、(1) スコア降順が自然に保たれ、
	 * (2) 絞り込みが自動でお気に入りにも効く（件数表示と画面の行数を一致させるため）。
	 *
	 * 空のときのヒントを出す条件が `!filtering` を含むのが重要 —— 絞り込みで0件になった
	 * ときにヒントを出すと、ユーザーには「ピン留めが消えた」と読める。
	 */
	let pinnedRanked = $derived(visibleRanked.filter(({ region }) => $pinnedIds.has(region.id)));
	let showPinHint = $derived($pinnedIds.size === 0 && !filtering);

	// 密度の判断は帯が持っている（UIに閾値を書かない）。理由は RiskBand.rowExpanded を参照
	const isCompactRow = (score: number) => !riskBand(score).rowExpanded;

	// ラベルは2か所（行の title・詳細パネルの文字）で同じものを出す
	const pinActionLabel = (pinned: boolean) => (pinned ? 'お気に入りから外す' : 'お気に入りに追加');

	/**
	 * ピンの押下。お気に入りセクション側で「外す」を押すと、その行ごと
	 * 押したボタンが消えるのでフォーカスが `<body>` に落ちる —— キーボード・読み上げの
	 * 利用者は現在位置を失い、次の Tab が文書の先頭から再開してしまう。
	 * 同じ地域のピンは全国リストに残っているので、そこへ移す。
	 */
	async function handlePinClick(id: string, inFavorites: boolean) {
		const wasPinned = $pinnedIds.has(id);
		togglePinned(id);
		if (!inFavorites || !wasPinned) return;
		await tick();
		document.querySelector<HTMLElement>(`.pin-btn[data-region-id="${CSS.escape(id)}"]`)?.focus();
	}

	const RISK_TYPE: Record<string, { emoji: string; label: string }> = {
		weather: { emoji: '🌧️', label: '気象' },
		snow: { emoji: '❄️', label: '大雪' },
		earthquake: { emoji: '🏔️', label: '地震' },
		tsunami: { emoji: '🌊', label: '津波' },
		volcano: { emoji: '🌋', label: '火山' },
		heat: { emoji: '🔥', label: '熱波' },
		cold: { emoji: '🥶', label: '寒波' },
		air: { emoji: '💨', label: '大気' },
	};
	const riskTypeEmoji = (t: string) => RISK_TYPE[t]?.emoji ?? '⚠️';
	const riskTypeLabel = (t: string) => RISK_TYPE[t]?.label ?? '警報';

	const scoreLabel = (score: number) => riskBand(score).label;

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
	}

	async function initMap() {
		if (typeof window === 'undefined') return;
		const L = (await import('leaflet')).default;
		await import('leaflet/dist/leaflet.css');

		if (map) {
			map.remove();
			map = null;
		}

		map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: true }).setView([36.5, 136.0], 5);

		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution: '© OpenStreetMap contributors',
			maxZoom: 18,
		}).addTo(map);

		updateMarkers(L, visibleRanked);
	}

	function updateMarkers(
		L: typeof import('leaflet'),
		targets: { region: RegionRisk; rank: number }[]
	): void {
		markers.forEach((m) => m.remove());
		markers = [];

		if (!map) return;
		const currentMap = map;

		// 絞り込みは地図にも効かせる（デスクトップではランキングと地図が横に並んで同時に
		// 見えるため、リストが8件で地図が64マーカーだと同じ画面で食い違う）。
		// ズーム・中心は触らない —— フィルタは1打鍵ごとに変わるので fitBounds を掛けると
		// 変換途中に地図が日本全国を飛び回る。
		targets.forEach(({ region }) => {
			if (region.riskScore === 0) return;
			const band = riskBand(region.riskScore);
			const size = band.markerSizePx;
			const icon = L.divIcon({
				className: '',
				html: `<div style="
					width:${size}px;height:${size}px;border-radius:50%;
					background:var(${band.colorVar});border:2px solid var(--marker-ring);
					box-shadow:0 2px 8px var(--marker-shadow);
					display:flex;align-items:center;justify-content:center;
					color:var(--on-risk);font-weight:700;font-size:${band.markerFontPx}px;font-family:var(--tk-font-mono);
					cursor:pointer;
				">${region.riskScore}</div>`,
				iconSize: [size, size],
				iconAnchor: [size / 2, size / 2],
			});

			const marker = L.marker([region.lat, region.lng], {
				icon,
				// Leaflet の既定の重なり順は緯度（南が上）なので、危険度で明示的に上書きする。
				// 関東は中心間が画面上4.9pxしか離れておらず円が重なるため、
				// これがないと小さい平穏の円が大きい危険の円の上に乗る。
				zIndexOffset: region.riskScore * 1000,
			})
				.addTo(currentMap)
				.on('click', () => selectedRegion.set(region));

			markers.push(marker);
		});
	}

	async function ensureMapInit() {
		// destroyed の確認が必要 —— initMap は動的 import を待つので、
		// 破棄後に完了して外れた DOM の上に地図を作ってしまいうる
		if (mapInitialized || destroyed || !mapEl) return;
		try {
			mapInitialized = true;
			await initMap();
			if (destroyed && map) {
				map.remove();
				map = null;
			}
		} catch {
			mapInitialized = false;
		}
	}

	$effect(() => {
		if (activeTab === 'map' && mapEl) {
			ensureMapInit().then(() => {
				requestAnimationFrame(() => {
					if (!destroyed) map?.invalidateSize();
				});
			});
		}
	});

	$effect(() => {
		// 依存関係として追跡させるため、条件の前に読み取る（map が null のときも必要）。
		// 描画対象は絞り込み後、貼り直しの判定はデータ取得済みかどうかで行う ——
		// フィルタが0件のときも updateMarkers を通さないと、前のマーカーが地図に残る。
		const currentRegions = visibleRanked;
		const dataLoaded = $rankedRegions.length > 0;
		if (map && dataLoaded) {
			import('leaflet').then(({ default: L }) => updateMarkers(L, currentRegions));
		}
	});

	function shareTwitter() {
		const text = `今、日本で最も危険な地域は「${$rankedRegions[0]?.name ?? ''}」！スコア${$rankedRegions[0]?.riskScore ?? 0}（${$rankedRegions[0]?.reasons[0] ?? ''}）\n#日本危険マップ #リアルタイム防災`;
		const url = encodeURIComponent(location.href);
		window.open(
			`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${url}`,
			'_blank'
		);
	}

	onMount(() => {
		startAutoRefresh(5 * 60 * 1000);
		const mq = window.matchMedia('(min-width: 1024px)');
		if (mq.matches) ensureMapInit();
		mq.addEventListener('change', (e) => {
			if (e.matches) ensureMapInit();
		});
	});

	onDestroy(() => {
		destroyed = true;
		stopAutoRefresh();
		if (map) {
			map.remove();
			// null に戻すのが要点。remove() 済みのインスタンスを参照に残すと
			// 遅れて走る `map?.invalidateSize()` が中身の消えた地図に触って例外になる
			map = null;
		}
	});
</script>

<svelte:head>
	<title>JAPAN RISK MAP</title>
</svelte:head>

<!--
	地域名の描画。都道府県そのものでない地域（北海道8地方・離島10地域）は
	「釧路・根室（北海道）」のように所属都道府県を添えているので、括弧部分を一段落として描く。
	ランキング・トップバナー・詳細パネルの3か所で同じ見え方にするため snippet にしている。
-->
{#snippet regionName(name: string)}{@const parts =
		splitRegionName(name)}{parts.base}{#if parts.prefecture}<span class="name-pref"
			>（{parts.prefecture}）</span
		>{/if}{/snippet}

<!--
	ランキングの1行。お気に入りセクションと全国リストで同じものを描くため snippet にしている。

	`<li>` の中で行ボタンとピンボタンを**兄弟**にしているのが要点。
	`.rank-item` 自体が `<button>` なので中にピンを置くと `<button>` の入れ子になり
	不正なHTMLになる。兄弟なら (1) HTMLとして正しく、(2) クリックのバブリングが
	そもそも起きないので stopPropagation が不要、(3) Tab 順が 行 → ピン と自然になる。

	`inFavorites` はお気に入りセクション側の行かどうか。コンパクト表示はお気に入りでしか
	起こらないのでフラグは1つで足り、密度と「どちらのセクションか」が食い違うこともない。
	コンパクト行は理由文・警報バッジ・スコアバーを落として1行にする
	（「実家は今日も平穏」の確認に理由文は要らない）。危険度が上がると自動で展開されるので、
	地図マーカーと同じ「サイズ＝危険度」の文法になる。
-->
{#snippet rankRow(city: RegionRisk, rank: number, inFavorites: boolean)}
	{@const pinned = $pinnedIds.has(city.id)}
	{@const compact = inFavorites && isCompactRow(city.riskScore)}
	<li class="rank-row" class:rank-row-compact={compact}>
		<button
			class="rank-item"
			class:rank-item-compact={compact}
			onclick={() => selectedRegion.set(city)}
		>
			<div class="rank-num" style="color:{scoreColor(city.riskScore)}">
				{rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`}
			</div>
			<div class="rank-info">
				<div class="rank-name-row">
					<span class="rank-name">{@render regionName(city.name)}</span>
					{#if city.riskTypes.length > 0}
						<span class="rank-types">
							{#each city.riskTypes as t (t)}
								<span class="type-badge">{riskTypeEmoji(t)}</span>
							{/each}
						</span>
					{/if}
					{#if !compact && city.details.jma && city.details.jma.areas.length > 0}
						<!--
							ホバーで区域別の警報を出す補助表示。`role="button"` と `tabindex` は付けない ——
							付けるとキーボードでフォーカスできるのに開く手段がない罠になり、
							しかも `<button>`（行）の中の対話要素という不正な入れ子にもなる。
							同じ内容は行を開いた詳細パネルに全部出るので、キーボードでも到達できる。
						-->
						<span
							class="jma-alert-badge"
							aria-hidden="true"
							onmouseenter={(e) => showJmaTooltip(e, city.details.jma!.areas)}
							onmouseleave={hideJmaTooltip}>⚠</span
						>
					{/if}
				</div>
				{#if !compact && city.reasons.length > 0}
					<div class="rank-reasons">
						{#each city.reasons as r, i (i)}<span>{r}</span>{/each}
					</div>
				{/if}
			</div>
			<div class="rank-score-wrap">
				<div class="rank-score" style="color:{scoreColor(city.riskScore)}">
					{city.riskScore}
				</div>
				<div class="rank-label" style="color:{scoreColor(city.riskScore)}">
					{scoreLabel(city.riskScore)}
				</div>
				{#if !compact}
					<div class="score-bar-bg">
						<div
							class="score-bar-fill"
							style="width:{city.riskScore}%;background:{scoreColor(city.riskScore)}"
						></div>
					</div>
				{/if}
			</div>
		</button>
		<!--
			`aria-pressed` を付けるので、読み上げ名は状態に依存させない ——
			「お気に入りから外す」を名前にすると、留まっているとき
			「熊本をお気に入りから外す、押されています」と二重否定になって読める。
			状態は `aria-pressed` が運び、名前は対象だけを指す。
			`title` は状態依存のままでよい（マウス利用者へのヒントで、読み上げ名にはならない）。
		-->
		<button
			class="pin-btn"
			class:pin-on={pinned}
			data-region-id={city.id}
			onclick={() => handlePinClick(city.id, inFavorites)}
			aria-pressed={pinned}
			aria-label="{city.name}のお気に入り"
			title={pinActionLabel(pinned)}
		>
			<PinIcon filled={pinned} />
		</button>
	</li>
{/snippet}

<div class="app" class:map-tab={activeTab === 'map'}>
	<!-- Header -->
	<header class="app-header">
		<div class="tk-header">
			<div class="tk-header__home">
				<img class="tk-header__icon" src="/icon.svg" alt="" width="32" height="32" />
				<h1 class="tk-header__name">JAPAN RISK MAP</h1>
				<!--
					ビルド情報。どのデプロイが公開されているかを画面から判別するために出す。
					ヘッダー右のデータ取得時刻（`Updated:`）とは別物なので、
					こちらはサイト名の直後に置き、日付だけを出して役割を分ける。
				-->
				<span class="build-info" title="ビルド日時（JST）: {formatBuildTime(BUILD_TIME)}">
					{buildLabel()}
				</span>
			</div>
			<div class="tk-header__end">
				<span class="live-badge">LIVE</span>
				{#if $loading}
					<span class="status-text blink">更新中</span>
				{:else if $lastUpdated}
					<span class="status-text" title="データ取得時刻">Updated: {formatTime($lastUpdated)}</span
					>
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
		<button
			class="tab-btn"
			class:active={activeTab === 'ranking'}
			onclick={() => (activeTab = 'ranking')}
		>
			ランキング
		</button>
		<button class="tab-btn" class:active={activeTab === 'map'} onclick={() => (activeTab = 'map')}>
			地図
		</button>
	</nav>

	<!-- Error Banner -->
	{#if $error}
		<div class="error-banner">{$error}</div>
	{/if}

	<!--
		地域フィルタ。両パネルの外に置いている —— 絞り込みは地図にも効くので、入力欄は
		どちらか一方のパネルの持ち物ではない。ranking-panel の中に置くと、モバイルで
		地図タブに切り替えたときに入力欄ごと消えるのにフィルタは効いたままになり、
		マーカーが少ない理由も解除する手段も画面から失われる。
	-->
	<div class="filter-bar">
		<div class="filter-field">
			<span class="filter-icon" aria-hidden="true">🔍</span>
			<input
				class="filter-input"
				type="search"
				bind:value={filterQuery}
				placeholder="地域名で絞り込む（例: 北海道 / くしろ）"
				aria-label="地域名で絞り込む"
				onkeydown={(e) => e.key === 'Escape' && (filterQuery = '')}
			/>
			{#if filtering}
				<button class="filter-clear" onclick={() => (filterQuery = '')} aria-label="絞り込みを解除"
					>✕</button
				>
			{/if}
		</div>
		<!--
			件数は常に出す。変換途中で件数が 64 → 12 → 1 と連続的に動くのが見えていれば、
			0件になっても「入力の途中」だと分かる。
			ただしデータ取得前は何も言わない —— `visibleRanked` が空なのは絞り込みの結果ではなく
			まだ何も無いからで、空の入力欄の隣で「該当なし」と出るのは嘘になる。
			なお数えているのは「該当した地域数」で、画面の行数ではない
			（ピン留めした地域は上下に重複して出るため一致しない）。
		-->
		<span class="filter-count" aria-live="polite">
			{#if $rankedRegions.length === 0}
				&nbsp;
			{:else if visibleRanked.length === 0}
				該当なし
			{:else}
				{visibleRanked.length}地域
			{/if}
		</span>
	</div>

	<!-- Main Content Area -->
	<div class="content-area">
		<!-- Ranking Panel -->
		<section class="ranking-panel" class:tab-active={activeTab === 'ranking'}>
			{#if $loading && $rankedRegions.length === 0}
				<div class="loading-screen">
					<div class="spinner"></div>
					<p>全国データを取得中</p>
					<p class="loading-sub">
						{REGIONS.length}地域の気象 / 地震 / 津波 / 火山 / 大気質を統合しています
					</p>
				</div>
			{/if}

			{#if $rankedRegions.length > 0}
				{@const top = $rankedRegions[0]}
				<!-- Top Alert Banner -->
				<div class="top-alert" style="background:{scoreColor(top.riskScore)}">
					<div class="top-rank">⚠️ #1 最高危険地域</div>
					<div class="top-name">{@render regionName(top.name)}</div>
					<div class="top-score">{top.riskScore}<span class="score-unit">/100</span></div>
					{#if top.reasons.length > 0}
						<div class="top-reasons">
							{#each top.reasons as r, i (i)}<span class="reason-chip">{r}</span>{/each}
						</div>
					{/if}
				</div>

				<!--
					お気に入り（ピン留め）セクション。rank-list の上に置いているので、画面最上部が
					一番安全という「上にあるほど危険」の反転が起きる。これを許容できるのは、
					バナー（すぐ上）が絞り込みにもピンにも影響されず常に全国1位を出し続けるため
					—— 押し出されるのは「1位の行」であって「1位の情報」ではない。

					ピン留めした地域は下の全国リストからは抜かない。抜くと順位に欠番ができ
					（#7 → #9 → #10）、さらにピンを外したときに行が64行のどこか遠くへワープして
					操作の結果が画面から消える。
				-->
				{#if pinnedRanked.length > 0}
					<div class="section-head">
						<span class="section-icon" aria-hidden="true">📌</span>
						<h2 class="section-title">お気に入り</h2>
						<span class="section-count">{pinnedRanked.length}</span>
					</div>
					<ol class="rank-list">
						{#each pinnedRanked as { region: city, rank } (city.id)}
							{@render rankRow(city, rank, true)}
						{/each}
					</ol>
					<hr class="section-sep" />
				{:else if showPinHint}
					<!--
						空のときだけ出すヒント。未ピンのピンは薄いグレーなので、これがないと
						機能に気づかれない（使われなければ価値が0の機能）。
						「一度見たら出さない」フラグを持つ必要はない —— 1件でもピンすれば
						空でなくなるので自動的に消える。
						絞り込みで0件のときは出さない（`showPinHint` の `!filtering`）——
						出すと「ピン留めが消えた」と読める。
					-->
					<p class="pin-hint">
						<span aria-hidden="true">📌</span> 行のピンを押すと、気になる地域をここに固定できます
					</p>
					<hr class="section-sep" />
				{/if}

				<!--
					全国リスト側の見出しは無条件で出す。お気に入りセクションの有無で出し入れすると、
					「ピンはあるが絞り込みで全部外れた」状態で見出しが消え、リストがバナーの直下に
					貼り付く（両側にラベルがあってこそセパレータが「区切り」として読める）。
				-->
				<div class="section-head">
					<h2 class="section-title">全国ランキング</h2>
				</div>

				<!--
					Rank List。番号は絞り込み前に確定した全国順位（rank）を使う。
					メダルも全国3位以内にだけ付く —— 絞り込み内で振り直すと、スコア23点の地域に
					🥇が付いて「注意」の黄色と矛盾する。
					「北海道内で何位か」は並び順が既に答えているので番号を振り直す必要はない。
				-->
				<ol class="rank-list">
					{#each visibleRanked as { region: city, rank } (city.id)}
						{@render rankRow(city, rank, false)}
					{/each}
				</ol>
				<!--
					0件は失敗ではなく入力の途中なので、静かな1行に留める。
					アイコン付きの空状態にすると打鍵ごとに画面が跳ねる。
				-->
				{#if visibleRanked.length === 0}
					<p class="rank-empty">「{filterQuery}」に一致する地域がありません</p>
				{/if}
			{/if}
		</section>

		<!-- Map Panel -->
		<div class="map-panel" class:tab-active={activeTab === 'map'}>
			<div bind:this={mapEl} class="leaflet-map"></div>
			<div class="map-legend">
				{#each legendItems as item (item.label)}
					<span class="legend-item">
						<span
							class="legend-dot"
							style="background:var({item.colorVar}); width:{item.dotPx}px; height:{item.dotPx}px"
						></span>{item.label}
						{item.range}
					</span>
				{/each}
			</div>
		</div>
	</div>

	<!-- Detail Panel (fixed overlay) -->
	{#if $selectedRegion}
		{@const detailPinned = $pinnedIds.has($selectedRegion.id)}
		<div class="detail-overlay" role="dialog" aria-modal="true">
			<button
				class="detail-backdrop"
				onclick={() => selectedRegion.set(null)}
				onkeydown={(e) => e.key === 'Escape' && selectedRegion.set(null)}
				aria-label="閉じる"
			></button>
			<div class="detail-panel" role="document">
				<button class="close-btn" onclick={() => selectedRegion.set(null)} aria-label="閉じる"
					>✕</button
				>

				<div class="detail-header">
					<div class="detail-score-block">
						<div class="detail-score" style="color:{scoreColor($selectedRegion.riskScore)}">
							{$selectedRegion.riskScore}
						</div>
						<div class="detail-score-label" style="color:{scoreColor($selectedRegion.riskScore)}">
							{scoreLabel($selectedRegion.riskScore)}
						</div>
					</div>
					<div class="detail-title-block">
						<div class="detail-title-row">
							<h2 class="detail-city">{@render regionName($selectedRegion.name)}</h2>
							<!--
								ラベル付きのピン。ここに文字を置けることが本当の価値 ——
								行のピンは単色のアイコンだけなので「押すと何が起きるか」を語らない。
								この文言がその辞書になる。
								右上（✕ の隣）には置かない。閉じるボタンの隣接位置に別の操作を置くと
								「外すつもりが閉じた」「閉じるつもりが留めた」が起きる。
							-->
							<!--
								ここは `aria-pressed` を付けない —— 見えている文字が状態そのものを
								語っているので、状態依存のラベルに `aria-pressed` を重ねると
								「お気に入りから外す、押されています」と読める。
							-->
							<button
								class="detail-pin-btn"
								class:pin-on={detailPinned}
								onclick={() => togglePinned($selectedRegion!.id)}
							>
								<PinIcon filled={detailPinned} size={14} />
								{pinActionLabel(detailPinned)}
							</button>
						</div>
						<div class="detail-types">
							{#each $selectedRegion.riskTypes as t (t)}
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
						{#each $selectedRegion.details.jma.areas as area (area.name)}
							<div class="jma-area-row">
								<span class="jma-area-name">{area.name}</span>
								<div class="jma-chips">
									{#each area.warnings as w (w)}
										<span
											class="jma-chip"
											class:jma-chip-special={w.includes('特別警報')}
											class:jma-chip-danger={w.includes('危険警報')}
											class:jma-chip-warning={!w.includes('特別警報') &&
												!w.includes('危険警報') &&
												w.includes('警報')}>{w}</span
										>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				{/if}

				{#if $selectedRegion.details.tsunami && $selectedRegion.details.tsunami.level !== 'none'}
					<div class="hazard-section hazard-tsunami">
						<span class="hazard-icon">🌊</span>
						<div class="hazard-body">
							<span class="hazard-title"
								>{TSUNAMI_LABELS[$selectedRegion.details.tsunami.level]}</span
							>
							{#if $selectedRegion.details.tsunami.areaName}
								<span class="hazard-sub">{$selectedRegion.details.tsunami.areaName}</span>
							{/if}
						</div>
					</div>
				{/if}

				{#if $selectedRegion.details.volcano && $selectedRegion.details.volcano.alerts.length > 0}
					<div class="hazard-section hazard-volcano">
						<span class="hazard-icon">🌋</span>
						<div class="hazard-body">
							<span class="hazard-title">噴火警報</span>
							{#each $selectedRegion.details.volcano.alerts as alert (alert.name)}
								<span class="hazard-sub">{alert.name} — {alert.levelText}</span>
							{/each}
						</div>
					</div>
				{/if}

				{#if $selectedRegion.scoreItems.length > 0}
					<div class="detail-section">
						<h3 class="section-label">スコア内訳</h3>
						<div class="breakdown-table">
							{#each $selectedRegion.scoreItems as item, i (i)}
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
								<span
									class="breakdown-total-val"
									style="color:{scoreColor($selectedRegion.riskScore)}"
								>
									{#if $selectedRegion.rawScore > $selectedRegion.riskScore}
										{$selectedRegion.rawScore} → {$selectedRegion.riskScore}<small
											>（上限100）</small
										>
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
							{@const w = $selectedRegion.details.weather}
							<div class="obs-cell">
								<span class="obs-label">🌡 気温</span>
								<span class="obs-val">{w.temperature.toFixed(1)}<small>℃</small></span>
							</div>
							<div class="obs-cell">
								<span class="obs-label">🥵 体感温度</span>
								<span class="obs-val">{w.apparentTemperature.toFixed(1)}<small>℃</small></span>
							</div>
							<div class="obs-cell">
								<span class="obs-label">🌧 降水量</span>
								<span class="obs-val">{w.precipitation.toFixed(1)}<small>mm/h</small></span>
							</div>
							<div class="obs-cell">
								<span class="obs-label">💨 風速 / 突風</span>
								<span class="obs-val"
									>{w.windSpeed.toFixed(0)}<small>/{w.windGusts.toFixed(0)} km/h</small></span
								>
							</div>
							{#if w.snowfall > 0}
								<div class="obs-cell">
									<span class="obs-label">🌨 降雪量</span>
									<span class="obs-val">{w.snowfall.toFixed(1)}<small>cm/h</small></span>
								</div>
							{/if}
							{#if w.snowDepthCm > 0}
								<div class="obs-cell">
									<span class="obs-label">❄ 積雪深</span>
									<span class="obs-val">{w.snowDepthCm.toFixed(0)}<small>cm</small></span>
								</div>
							{/if}
							<div class="obs-cell">
								<span class="obs-label">☁ 天気</span>
								<span class="obs-val obs-val-text">{getWeatherLabel(w.weatherCode)}</span>
							</div>
						{/if}
						{#if $selectedRegion.details.air?.pm25 !== null && $selectedRegion.details.air?.pm25 !== undefined}
							<div class="obs-cell">
								<span class="obs-label">🌫 PM2.5</span>
								<span class="obs-val"
									>{$selectedRegion.details.air.pm25.toFixed(1)}<small>μg/m³</small></span
								>
							</div>
						{/if}
					</div>
					{#if $selectedRegion.details.earthquake?.shindo || $selectedRegion.details.earthquake?.recentQuakeCount}
						{@const eq = $selectedRegion.details.earthquake}
						<div class="eq-card">
							<div class="eq-row">
								<span class="eq-label">🏔 地震</span>
								{#if eq.shindo}
									<span class="eq-shindo">{SHINDO_LABELS[eq.shindo]}</span>
									{#if eq.shindoSource === 'estimated'}
										<span class="eq-badge">推定値</span>
									{/if}
								{/if}
								{#if eq.magnitude !== null}
									<span class="eq-info">M{eq.magnitude.toFixed(1)}</span>
								{/if}
								{#if eq.depth !== null}
									<span class="eq-info">深さ {eq.depth.toFixed(0)}km</span>
								{/if}
								{#if eq.distanceKm !== null}
									<span class="eq-info">震源 {Math.round(eq.distanceKm)}km</span>
								{/if}
							</div>
							{#if eq.place}
								<span class="eq-info">{eq.place}</span>
							{/if}
							<div class="eq-row">
								{#if eq.time}
									<span class="eq-time">{formatDateTime(eq.time)}</span>
								{/if}
								{#if eq.recentQuakeCount > 0}
									<span class="eq-time">{SWARM_WINDOW_DAYS}日間の観測 {eq.recentQuakeCount}回</span>
								{/if}
							</div>
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
		<div class="jma-fixed-tooltip" style="left:{jmaTooltip.x}px; top:{jmaTooltip.y}px;">
			{#each jmaTooltip.areas as area (area.name)}
				<div class="jma-tooltip-area">
					<span class="jma-tooltip-name">{area.name}</span>
					<div class="jma-tooltip-warnings">
						{#each area.warnings as w (w)}
							<span class="jma-tooltip-chip">{w}</span>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<footer class="tk-footer">
		<a href="https://tk3.biz/">tk3.biz</a>
	</footer>
</div>

<style>
	/* 色の変数は src/app.css（アプリ固有）と tk-base.css（--tk-*）にある */

	:global(*) {
		box-sizing: border-box;
		margin: 0;
		padding: 0;
	}

	:global(body) {
		min-height: 100vh;
	}

	/* ─── App shell ─── */
	.app {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	/* ─── Header（共通の .tk-header に地震計の帯を足して上に固定する） ─── */
	.app-header {
		position: sticky;
		top: 0;
		z-index: 200;
		background: var(--tk-surface);
		border-bottom: 1px solid var(--tk-line);
	}

	.app-header .tk-header {
		border-block-end: none;
	}

	.live-badge {
		font-family: var(--tk-font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.12em;
		color: var(--tk-blue);
		border: 1px solid var(--tk-blue);
		padding: 2px 5px;
		border-radius: 2px;
		flex-shrink: 0;

		/* 点滅は動きを減らす設定のときは付けない（地震計の帯と同じ扱い） */
		@media (prefers-reduced-motion: no-preference) {
			animation: blink 2s steps(1) infinite;
		}
	}

	@keyframes blink {
		0%,
		49% {
			opacity: 1;
		}
		50%,
		100% {
			opacity: 0.3;
		}
	}

	.status-text {
		font-family: var(--tk-font-mono);
		font-size: 11px;
		color: var(--tk-body);
		white-space: nowrap;
	}

	/**
	 * サイト名の右に添えるバージョンとビルド日。開発・運用側の情報で、閲覧者が読むべき
	 * ものではないのでハザード表示と競合しないよう最小・控えめな色（--tk-muted）にする
	 * （それでも文字として 4.5:1 は保つ）。
	 * `flex-shrink: 0` はタイトルの ellipsis に食われないため。
	 * 狭い画面では隠す —— 幅を食ってタイトルやデータ取得時刻を押し出すほどの価値はない
	 * （デプロイの確認はデスクトップで行う）。
	 */
	.build-info {
		font-family: var(--tk-font-mono);
		font-size: 10px;
		color: var(--tk-muted);
		white-space: nowrap;
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 599px) {
		.build-info {
			display: none;
		}
	}

	/*
	 * 狭い画面ではサイト名を切らさないことを優先する。LIVE の印は落とし（データ取得時刻が
	 * 同じことを語る）、余白とサイト名の文字を少し詰める。
	 */
	@media (max-width: 419px) {
		.live-badge {
			display: none;
		}

		.app-header .tk-header {
			gap: 8px;
			padding-inline: 12px;
		}

		.app-header .tk-header__name {
			font-size: 1rem;
		}
	}

	.blink {
		@media (prefers-reduced-motion: no-preference) {
			animation: blink 1s steps(1) infinite;
		}
	}

	.share-btn {
		background: transparent;
		border: 1px solid var(--tk-line-strong);
		color: var(--tk-body);
		padding: 5px 12px;
		border-radius: 4px;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		transition:
			border-color 0.15s,
			color 0.15s;
		white-space: nowrap;
	}
	.share-btn:hover {
		border-color: var(--tk-body);
		color: var(--tk-ink);
	}
	.share-btn:focus-visible {
		outline: 2px solid var(--tk-blue);
		outline-offset: 2px;
	}

	/* ─── Seismograph strip ─── */
	.seismo-wrap {
		height: 26px;
		overflow: hidden;
		background: var(--tk-bg);
		border-top: 1px solid var(--tk-line);
	}

	.seismo-inner {
		display: flex;
		width: 200%;
		height: 100%;
		animation: seismo-scroll 18s linear infinite;
	}

	@media (prefers-reduced-motion: reduce) {
		.seismo-inner {
			animation: none;
		}
	}

	@keyframes seismo-scroll {
		from {
			transform: translateX(0);
		}
		to {
			transform: translateX(-50%);
		}
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
		background: var(--tk-surface);
		border-bottom: 1px solid var(--tk-line);
	}

	/* 地域フィルタ。両パネルの外にあるので横幅いっぱい（絞り込みは地図にも効く） */
	.filter-bar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		background: var(--tk-surface);
		border-bottom: 1px solid var(--tk-line);
	}

	.filter-field {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 10px;
		background: var(--tk-bg);
		border: 1px solid var(--tk-line-strong);
		border-radius: 8px;
	}

	/* 入力欄そのものの枠は消しているので、フォーカスの印は囲みの側に出す */
	.filter-field:focus-within {
		border-color: var(--tk-blue);
		outline: 1px solid var(--tk-blue);
	}

	.filter-icon {
		font-size: 13px;
		opacity: 0.6;
		flex-shrink: 0;
	}

	.filter-input {
		flex: 1;
		min-width: 0;
		padding: 8px 0;
		border: none;
		background: transparent;
		color: var(--tk-ink);
		/* 16px 未満にすると iOS Safari がフォーカス時にページを勝手にズームする。
			プレースホルダが末尾で切れるのは許容し、ズームを避けるほうを採る */
		font-size: 16px;
		font-family: inherit;
	}

	.filter-input:focus {
		outline: none;
	}

	/* type=search の既定の×は表示が環境依存なので消して、自前のボタンに揃える */
	.filter-input::-webkit-search-cancel-button {
		display: none;
	}

	.filter-clear {
		flex-shrink: 0;
		border: none;
		background: transparent;
		color: var(--tk-body);
		font-size: 13px;
		cursor: pointer;
		padding: 4px;
		line-height: 1;
	}

	.filter-clear:hover {
		color: var(--tk-ink);
	}

	.filter-count {
		flex-shrink: 0;
		font-size: 12px;
		font-weight: 700;
		color: var(--tk-body);
		font-variant-numeric: tabular-nums;
	}

	.rank-empty {
		padding: 20px 12px;
		text-align: center;
		font-size: 13px;
		color: var(--tk-body);
	}

	.tab-btn {
		flex: 1;
		padding: 11px;
		border: none;
		background: transparent;
		color: var(--tk-body);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		transition:
			color 0.15s,
			border-color 0.15s;
		letter-spacing: 0.02em;
	}
	.tab-btn.active {
		color: var(--tk-ink);
		border-bottom-color: var(--tk-blue);
	}
	.tab-btn:focus-visible {
		outline: 2px solid var(--tk-blue);
		outline-offset: -2px;
	}

	/* ─── Error ─── */
	.error-banner {
		background: var(--severe-chip-bg);
		color: var(--tk-danger);
		padding: 8px 16px;
		font-size: 13px;
		text-align: center;
		border-bottom: 1px solid var(--severe-line);
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
	.ranking-panel.tab-active {
		display: flex;
	}

	/* ─── Map panel ─── */
	.map-panel {
		display: none;
		flex-direction: column;
		position: relative;
	}
	.map-panel.tab-active {
		display: flex;
		flex: 1;
	}

	/*
	 * モバイルの地図タブも画面の高さに収める。地図の高さを「画面 − 決め打ちの値」にすると、
	 * ヘッダー・タブ・絞り込み欄の実際の高さとずれて、地図の下端（凡例）が画面の外に出る。
	 * 残りの高さを flex で地図に渡せば、上に何が並んでも下端は画面内に来る。
	 * ランキングのタブはこれまでどおりページごとスクロールする。
	 */
	@media (max-width: 1023px) {
		.app.map-tab {
			height: 100dvh;
		}

		.app.map-tab .content-area {
			min-height: 0;
		}

		.app.map-tab .leaflet-map {
			min-height: 240px;
		}
	}

	/* ─── Desktop layout ─── */
	@media (min-width: 1024px) {
		.tab-nav {
			display: none;
		}

		/*
		 * 画面の高さに収める。min-height のままだと、ランキング（64地域）の高さで
		 * content-area ごと伸び、横に並ぶ地図も数千px になって凡例（地図の下端）が
		 * 画面の外へ出る。高さを決めて、ランキングだけを中でスクロールさせる。
		 */
		.app {
			height: 100dvh;
		}

		.content-area {
			flex-direction: row;
			min-height: 0;
		}

		.ranking-panel {
			display: flex !important;
			width: clamp(340px, 32vw, 480px);
			flex-shrink: 0;
			border-right: 1px solid var(--tk-line);
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
		color: var(--tk-body);
		flex: 1;
	}

	.spinner {
		width: 36px;
		height: 36px;
		border: 2px solid var(--tk-line);
		border-top-color: var(--tk-blue);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.loading-sub {
		font-size: 12px;
		color: var(--tk-muted);
	}

	/* ─── Top Alert Banner ─── */
	.top-alert {
		margin: 12px 12px 4px;
		padding: 18px 16px 16px;
		border-radius: 12px;
		text-align: center;
		color: var(--on-risk);
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
		font-feature-settings: 'palt' 1;
		margin-bottom: 4px;
	}

	.top-score {
		font-family: var(--tk-font-mono);
		font-size: 64px;
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.04em;
		margin-bottom: 12px;
	}

	.score-unit {
		font-size: 0.35em;
		font-weight: 400;
		/* 薄くしすぎると警戒（橙）の帯の上で 4.5:1 を割る。0.92 が4つの帯すべてで届く上限 */
		opacity: 0.92;
		letter-spacing: 0;
	}

	.top-reasons {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		justify-content: center;
	}

	.reason-chip {
		background: var(--on-risk-chip);
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

	/**
	 * 1行の外枠。行ボタンとピンボタンを横に並べる。
	 * ピンは上端揃え —— 展開行では視覚的に右上に来る。コンパクト行は1行なので単に右端。
	 *
	 * 縦の余白を `--row-pad-y` として行が公開し、中の行ボタンとピンボタンの両方が読む。
	 * ピンは行の「4列目」なので1行目の高さに合わせる必要があり、この値を持たないと
	 * 行の padding を変えたときにアイコンだけ静かにずれる。
	 */
	.rank-row {
		display: flex;
		align-items: flex-start;
		gap: 4px;
		--row-pad-y: 12px;
	}

	.rank-row-compact {
		--row-pad-y: 7px;
	}

	.rank-item {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: var(--row-pad-y) 14px;
		background: var(--tk-surface);
		border: 1px solid var(--tk-line);
		border-radius: 10px;
		cursor: pointer;
		color: var(--tk-ink);
		font: inherit;
		text-align: left;
		transition: background 0.15s;
	}
	.rank-item:hover {
		background: var(--tk-surface-2);
	}
	.rank-item:focus-visible {
		outline: 2px solid var(--tk-blue);
		outline-offset: -2px;
	}

	/**
	 * お気に入りの「警戒」帯未満の行。理由文・警報バッジ・スコアバーを落としたうえで
	 * 文字を詰めて1行に収める（縦の余白は `--row-pad-y`）。
	 * 危険度が上がると自動で展開行に戻る。
	 */
	.rank-item-compact .rank-score {
		font-size: 20px;
	}
	.rank-item-compact .rank-name {
		font-size: 16px;
	}

	/**
	 * ピンボタン。未ピンは輪郭だけ・控えめな色（--tk-muted。図形として地に 3:1 以上）、
	 * ホバー・フォーカスで濃くし、ピン済みは塗って色を付ける。
	 * 単色（currentColor）なので、危険度の4色ともタイプバッジの絵文字とも競合しない。
	 *
	 * タップ領域は 44px（iOS の指針）を幅で確保し、高さは `align-self: stretch` で
	 * 行いっぱい（最小でもコンパクト行の54px）になる。
	 * アイコン自体は行の1行目に合わせるため上端に寄せる。
	 */
	.pin-btn {
		flex-shrink: 0;
		width: 44px;
		align-self: stretch;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: var(--row-pad-y) 0 0;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 10px;
		color: var(--tk-muted);
		cursor: pointer;
		transition:
			color 0.15s,
			background 0.15s;
	}

	.pin-btn:hover {
		color: var(--tk-ink);
		background: var(--tk-surface-2);
	}

	.pin-btn:focus-visible {
		outline: 2px solid var(--tk-blue);
		outline-offset: -2px;
		color: var(--tk-ink);
	}

	.pin-btn.pin-on {
		color: var(--tk-blue);
	}

	/* ─── セクション見出し（お気に入り / 全国ランキング） ─── */
	.section-head {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 14px 14px 2px;
	}

	.section-icon {
		font-size: 13px;
	}

	.section-title {
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.08em;
		color: var(--tk-body);
	}

	.section-count {
		font-family: var(--tk-font-mono);
		font-size: 11px;
		font-weight: 700;
		color: var(--tk-body);
		background: var(--tk-surface-2);
		border-radius: 10px;
		padding: 1px 7px;
		font-variant-numeric: tabular-nums;
	}

	.section-sep {
		border: none;
		border-top: 1px solid var(--tk-line);
		margin: 10px 14px 0;
	}

	/**
	 * お気に入りが空のときだけ出すヒント。未ピンのピンは薄いので、これがないと
	 * 機能に気づかれない。1件でもピンすれば空でなくなるので自動的に消える。
	 */
	.pin-hint {
		padding: 14px 14px 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--tk-body);
	}

	.rank-num {
		font-family: var(--tk-font-mono);
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
		font-feature-settings: 'palt' 1;
	}

	/**
	 * 都道府県そのものでない地域に添える所属都道府県（「釧路・根室（北海道）」の括弧部分）。
	 * 地域名が主題・都道府県は文脈なので一段落として描く。
	 * em 指定なのでランキング・トップバナー・詳細パネルの3か所で同じ比率になる。
	 * 色は指定せず opacity で落とす —— 明るい背景の一覧と、危険度色で塗られた
	 * トップバナー（白文字）の両方で成立させるため。
	 */
	.name-pref {
		font-size: 0.7em;
		font-weight: 700;
		letter-spacing: 0;
		opacity: 0.65;
	}

	.rank-reasons {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.rank-reasons span {
		font-size: 11px;
		color: var(--tk-body);
		line-height: 1.4;
	}

	.rank-types {
		display: flex;
		gap: 2px;
		align-items: center;
	}

	.type-badge {
		font-size: 14px;
	}

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
		font-family: var(--tk-font-mono);
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
		background: var(--tk-line);
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
		background: var(--map-bg);
	}

	/*
	 * 地図の配色。タイル（OpenStreetMap）は明るい絵しかないので、暗い配色では
	 * 反転して暗くする（--map-tile-filter）。マーカーはタイルの外なので反転されない。
	 * Leaflet の操作部品と出典表記も面の色に合わせる。
	 */
	.leaflet-map :global(.leaflet-tile-pane) {
		filter: var(--map-tile-filter);
	}

	.leaflet-map :global(.leaflet-bar a) {
		background-color: var(--tk-surface);
		color: var(--tk-ink);
		border-bottom-color: var(--tk-line);
	}

	.leaflet-map :global(.leaflet-bar a:hover),
	.leaflet-map :global(.leaflet-bar a:focus-visible) {
		background-color: var(--tk-surface-2);
	}

	.leaflet-map :global(.leaflet-bar a.leaflet-disabled) {
		background-color: var(--tk-surface-2);
		color: var(--tk-muted);
	}

	.leaflet-map :global(.leaflet-control-attribution) {
		background: var(--map-overlay-bg);
		color: var(--tk-body);
	}

	.leaflet-map :global(.leaflet-control-attribution a) {
		color: var(--tk-blue);
	}

	.map-legend {
		position: absolute;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--map-overlay-bg);
		border: 1px solid var(--tk-line);
		border-radius: 4px;
		padding: 7px 14px;
		display: flex;
		gap: 14px;
		z-index: 1000;
		font-family: var(--tk-font-mono);
		font-size: 11px;
		color: var(--tk-body);
		white-space: nowrap;
	}

	/* 狭い画面では地図の幅に収まるよう、項目の単位で折り返す */
	@media (max-width: 599px) {
		.map-legend {
			flex-wrap: wrap;
			justify-content: center;
			row-gap: 4px;
			width: max-content;
			max-width: calc(100% - 24px);
		}
	}

	.legend-item {
		white-space: nowrap;
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.legend-dot {
		/* サイズはマーカーと同じ比率で算出してインラインで与える */
		border-radius: 50%;
		flex-shrink: 0;
	}

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
		background: var(--backdrop);
		border: none;
		cursor: pointer;
	}

	.detail-panel {
		background: var(--tk-surface);
		border: 1px solid var(--tk-line);
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
		background: var(--tk-surface-2);
		border: 1px solid var(--tk-line);
		color: var(--tk-body);
		width: 28px;
		height: 28px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.close-btn:hover {
		color: var(--tk-ink);
	}
	.close-btn:focus-visible {
		outline: 2px solid var(--tk-blue);
		outline-offset: 2px;
	}

	.detail-header {
		display: flex;
		align-items: flex-start;
		gap: 14px;
		padding-bottom: 16px;
		margin-bottom: 16px;
		border-bottom: 1px solid var(--tk-line);
	}

	.detail-score-block {
		flex-shrink: 0;
		text-align: center;
	}

	.detail-score {
		font-family: var(--tk-font-mono);
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

	.detail-title-block {
		flex: 1;
		min-width: 0;
	}

	.detail-title-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
		/* ✕（close-btn）は右上に絶対配置されているので、その分だけ空けておく */
		padding-right: 34px;
	}

	/**
	 * 詳細パネルのピン。ここだけラベル付きにしている ——
	 * 行の単色アイコンが何をするものかを、この文言が教える辞書になる。
	 */
	.detail-pin-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 6px 12px;
		background: var(--tk-surface-2);
		border: 1px solid var(--tk-line);
		border-radius: 20px;
		color: var(--tk-body);
		font: inherit;
		font-size: 12px;
		font-weight: 700;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.detail-pin-btn:hover {
		color: var(--tk-ink);
	}

	.detail-pin-btn:focus-visible {
		outline: 2px solid var(--tk-blue);
		outline-offset: 2px;
	}

	.detail-pin-btn.pin-on {
		color: var(--tk-blue);
		border-color: var(--tk-blue);
	}

	.detail-city {
		font-size: 28px;
		font-weight: 900;
		letter-spacing: -0.02em;
		font-feature-settings: 'palt' 1;
		margin-bottom: 6px;
	}

	.detail-types {
		display: flex;
		gap: 5px;
		flex-wrap: wrap;
	}

	.detail-section {
		margin-bottom: 14px;
	}

	.section-label {
		font-family: var(--tk-font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.12em;
		color: var(--tk-muted);
		text-transform: uppercase;
		margin-bottom: 7px;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	/* ─── Score breakdown ─── */
	.breakdown-table {
		border: 1px solid var(--tk-line);
		border-radius: 6px;
		overflow: hidden;
	}

	.breakdown-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		padding: 6px 12px;
		border-bottom: 1px solid var(--tk-line);
		gap: 8px;
		background: var(--tk-surface);
	}

	.breakdown-label {
		font-size: 13px;
		color: var(--tk-ink);
		flex: 1;
		min-width: 0;
	}

	.breakdown-pts {
		font-family: var(--tk-font-mono);
		font-size: 13px;
		font-weight: 700;
		color: var(--tk-blue);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.breakdown-note {
		padding: 2px 12px 5px;
		font-size: 11px;
		color: var(--tk-muted);
		border-bottom: 1px solid var(--tk-line);
		background: var(--tk-surface-2);
		font-style: italic;
	}

	.breakdown-total {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 12px;
		background: var(--tk-surface-2);
		border-top: 1px solid var(--tk-line-strong);
	}

	.breakdown-total-label {
		font-family: var(--tk-font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.1em;
		color: var(--tk-muted);
		text-transform: uppercase;
	}

	.breakdown-total-val {
		font-family: var(--tk-font-mono);
		font-size: 18px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
	}

	.breakdown-total-val small {
		font-size: 10px;
		font-weight: 400;
		color: var(--tk-muted);
		margin-left: 3px;
		letter-spacing: 0;
	}

	.detail-footer {
		display: flex;
		justify-content: space-between;
		font-family: var(--tk-font-mono);
		font-size: 10px;
		color: var(--tk-muted);
		padding-top: 10px;
		border-top: 1px solid var(--tk-line);
		margin-top: 4px;
	}

	/* ─── JMA alert badge in rank list ─── */
	.jma-alert-badge {
		font-size: 13px;
		color: var(--warn-icon);
		cursor: default;
		line-height: 1;
		user-select: none;
	}

	/* ─── JMA fixed tooltip ─── */
	.jma-fixed-tooltip {
		position: fixed;
		background: var(--tooltip-bg);
		color: var(--tooltip-text);
		border: 1px solid var(--tooltip-line);
		border-radius: 8px;
		padding: 10px 14px;
		z-index: 9999;
		max-width: 320px;
		box-shadow: 0 4px 20px var(--tooltip-shadow);
		pointer-events: none;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.jma-tooltip-area {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.jma-tooltip-name {
		font-size: 11px;
		font-weight: 700;
		color: var(--tooltip-sub);
		letter-spacing: 0.02em;
	}

	.jma-tooltip-warnings {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
	}

	.jma-tooltip-chip {
		font-size: 11px;
		font-weight: 600;
		background: var(--warn-chip-bg);
		color: var(--warn-chip-text);
		border-radius: 3px;
		padding: 2px 7px;
	}

	/* ─── JMA alert section in detail panel ─── */
	.jma-alert-section {
		background: var(--warn-bg);
		border: 1px solid var(--warn-line);
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

	.jma-alert-icon {
		font-size: 14px;
	}

	.jma-alert-title {
		font-size: 11px;
		font-weight: 700;
		color: var(--warn-text);
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
		border-top: 1px solid var(--warn-line);
	}

	.jma-area-name {
		font-size: 12px;
		font-weight: 700;
		color: var(--warn-text-strong);
	}

	.jma-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.jma-chip {
		font-size: 11px;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 3px;
		background: var(--warn-chip-bg);
		color: var(--warn-chip-text);
		border: 1px solid var(--warn-chip-line);
	}

	.jma-chip-special {
		background: var(--severe-chip-bg);
		color: var(--severe-text);
		border-color: var(--severe-line);
	}

	.jma-chip-warning {
		background: var(--warn-chip-bg);
		color: var(--warn-chip-text);
		border-color: var(--warn-chip-line);
	}

	/* 危険警報（警戒レベル4相当）— 警報と特別警報の中間 */
	.jma-chip-danger {
		background: var(--danger-chip-bg);
		color: var(--danger-chip-text);
		border-color: var(--danger-chip-line);
	}

	/* ─── 観測データ grid ─── */
	.obs-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 5px;
		margin-bottom: 5px;
	}

	.obs-cell {
		background: var(--tk-bg);
		border: 1px solid var(--tk-line);
		padding: 9px 11px;
		border-radius: 6px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.obs-label {
		font-size: 11px;
		color: var(--tk-body);
	}

	.obs-val {
		font-size: 20px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.obs-val small {
		font-size: 11px;
		font-weight: 400;
		color: var(--tk-body);
		margin-left: 1px;
	}

	.obs-val-text {
		font-size: 16px;
	}

	/* ─── 津波・火山の警報セクション ─── */
	.hazard-section {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		border-radius: 8px;
		padding: 11px 13px;
		margin-bottom: 12px;
		border: 1px solid;
	}

	.hazard-tsunami {
		background: var(--tsunami-bg);
		border-color: var(--tsunami-line);
	}

	.hazard-volcano {
		background: var(--severe-bg);
		border-color: var(--severe-line);
	}

	.hazard-icon {
		font-size: 18px;
		line-height: 1.2;
		flex-shrink: 0;
	}

	.hazard-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.hazard-title {
		font-size: 14px;
		font-weight: 800;
		letter-spacing: -0.01em;
	}

	.hazard-tsunami .hazard-title {
		color: var(--tsunami-text);
	}

	.hazard-volcano .hazard-title {
		color: var(--severe-text);
	}

	.hazard-sub {
		font-size: 12px;
		color: var(--tk-body);
		line-height: 1.4;
	}

	/* ─── 地震カード ─── */
	.eq-card {
		background: var(--tk-bg);
		border: 1px solid var(--tk-line);
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
		color: var(--tk-body);
	}

	.eq-shindo {
		font-size: 22px;
		font-weight: 800;
		color: var(--danger);
		letter-spacing: -0.02em;
		font-feature-settings: 'palt' 1;
	}

	.eq-badge {
		font-size: 10px;
		font-weight: 700;
		color: var(--tk-body);
		border: 1px solid var(--tk-line-strong);
		border-radius: 3px;
		padding: 1px 5px;
		letter-spacing: 0.04em;
	}

	.eq-info {
		font-size: 12px;
		color: var(--tk-body);
	}

	.eq-time {
		font-family: var(--tk-font-mono);
		font-size: 11px;
		color: var(--tk-muted);
	}

	/* ─── no risk note ─── */
	.no-risk-note {
		font-size: 13px;
		color: var(--tk-muted);
		text-align: center;
		padding: 10px 0 14px;
	}

	/* ─── Tablet tweaks ─── */
	@media (min-width: 640px) {
		.top-alert {
			margin: 14px 14px 6px;
		}
		.rank-list {
			padding: 8px 14px 16px;
			gap: 8px;
		}
	}
</style>

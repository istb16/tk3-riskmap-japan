<script lang="ts">
	// 共通の土台（tk3 apps base）を先に、アプリ固有の色をその後に読み込む
	import '#lib/styles/tk-base.css';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<!-- Google tag (gtag.js) -->
	<script async src="https://www.googletagmanager.com/gtag/js?id=G-FPG4BRYYFK"></script>
	<script>
		window.dataLayer = window.dataLayer || [];
		function gtag() {
			dataLayer.push(arguments);
		}
		gtag('js', new Date());
		gtag('config', 'G-FPG4BRYYFK');
	</script>
</svelte:head>

{@render children()}

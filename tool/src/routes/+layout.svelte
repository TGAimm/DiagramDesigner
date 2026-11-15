<script lang="ts">
	import '../app.css';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { design } from '#lib/client/store.svelte.ts';
	import { theme } from '#lib/client/theme.svelte.ts';
	import { themeCss } from '#lib/theme/tokens.ts';
	import DiagnosticsPanel from '#lib/components/DiagnosticsPanel.svelte';
	import SettingsPanel from '#lib/components/SettingsPanel.svelte';
	import type { ChangedEvent } from '#lib/server/vite-plugin.ts';

	let { children } = $props();
	let showDiagnostics = $state(false);
	let showSettings = $state(false);

	const errors = $derived(design.diagnostics.filter((d) => d.severity === 'error').length);
	const warnings = $derived(design.diagnostics.length - errors);

	onMount(() => {
		// Subscribe before loading; the store queues events behind the initial load.
		import.meta.hot?.on('sdv:changed', (ev: ChangedEvent) => design.onExternalChange(ev));
		design.load().then(() => theme.init(design.config.theme));
		if (import.meta.env.DEV) (window as unknown as { __sdv: typeof design }).__sdv = design;
	});
</script>

<svelte:head>
	<title>System Design Viewer</title>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- generated from static tokens -->
	{@html `<style>${themeCss()}</style>`}
</svelte:head>

<div class="app">
	<header class="topbar">
		<a class="brand" href={resolve('/')}>System Design Viewer</a>
		<span class="spacer"></span>
		<button
			class="diag"
			class:has-errors={errors > 0}
			aria-pressed={showDiagnostics}
			onclick={() => (showDiagnostics = !showDiagnostics)}
			title="Diagnostics"
			data-testid="diagnostics-toggle"
		>
			<span class="err">● {errors}</span>
			<span class="warn">▲ {warnings}</span>
		</button>
		<button
			class="icon"
			onclick={() => theme.toggle()}
			title="Toggle theme"
			aria-label="Toggle theme"
		>
			{theme.current === 'dark' ? '☀' : '☾'}
		</button>
		<button
			class="icon"
			aria-expanded={showSettings}
			aria-pressed={showSettings}
			onclick={() => (showSettings = !showSettings)}
			title="Settings"
			aria-label="Settings"
			data-testid="settings-toggle"
		>
			<!-- Gear: Lucide "settings" (ISC). -->
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				style="display: block"
				><path
					d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
				/><circle cx="12" cy="12" r="3" /></svg
			>
		</button>
	</header>
	{#if showSettings}
		<SettingsPanel onclose={() => (showSettings = false)} />
	{/if}
	<main>
		{#if design.loadError}
			<p class="load-error">Could not load the design: {design.loadError}</p>
		{:else if design.loaded}
			{@render children()}
		{:else}
			<p class="muted loading">Loading design…</p>
		{/if}
	</main>
	{#if showDiagnostics}
		<DiagnosticsPanel onclose={() => (showDiagnostics = false)} />
	{/if}
</div>

<style>
	.app {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100vh;
	}
	.topbar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		border-bottom: 1px solid var(--ui-border);
		background: var(--ui-panel);
		min-height: 44px;
	}
	.brand {
		font-weight: 700;
		color: var(--ui-text);
		text-decoration: none;
	}
	.spacer {
		flex: 1;
	}
	.diag {
		display: flex;
		gap: 8px;
	}
	.diag .err {
		color: var(--ui-muted);
	}
	.diag.has-errors .err {
		color: var(--ui-danger);
		font-weight: 600;
	}
	.diag .warn {
		color: var(--ui-warn);
	}
	main {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.loading,
	.load-error {
		padding: 24px;
	}
	.load-error {
		color: var(--ui-danger);
	}
</style>

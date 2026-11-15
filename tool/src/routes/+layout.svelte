<script lang="ts">
	import '../app.css';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { CircleX, Moon, Settings, Sun, TriangleAlert } from '@lucide/svelte';
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
			<span class="err"><CircleX size={14} />{errors}</span>
			<span class="warn"><TriangleAlert size={14} />{warnings}</span>
		</button>
		<button
			class="icon"
			onclick={() => theme.toggle()}
			title="Toggle theme"
			aria-label="Toggle theme"
		>
			{#if theme.current === 'dark'}<Sun size={16} />{:else}<Moon size={16} />{/if}
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
			<Settings size={16} />
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
		/* 30px controls, so the bar is 45px and they land on whole pixels. */
		padding: 7px 12px;
		border-bottom: 1px solid var(--ui-border);
		background: var(--ui-panel);
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
		align-items: center;
		gap: 8px;
		height: 30px;
	}
	.diag span {
		display: flex;
		align-items: center;
		gap: 4px;
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

<script lang="ts">
	import '../app.css';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { CircleX, Moon, Search, Settings, Sun, TriangleAlert } from '@lucide/svelte';
	import { design } from '#lib/client/store.svelte.ts';
	import { search } from '#lib/client/search.svelte.ts';
	import { theme } from '#lib/client/theme.svelte.ts';
	import { themeCss } from '#lib/theme/tokens.ts';
	import DiagnosticsPanel from '#lib/components/DiagnosticsPanel.svelte';
	import SettingsPanel from '#lib/components/SettingsPanel.svelte';
	import ScenarioControls from '#lib/components/ScenarioControls.svelte';
	import FlagsMenu from '#lib/components/FlagsMenu.svelte';
	import LandscapeMenu from '#lib/components/LandscapeMenu.svelte';
	import OpenFolderDialog from '#lib/components/OpenFolderDialog.svelte';
	import StartScreen from '#lib/components/StartScreen.svelte';
	import { landscapes } from '#lib/client/landscapes.svelte.ts';
	import type { ChangedEvent } from '#lib/server/vite-plugin.ts';

	let { children } = $props();
	let showDiagnostics = $state(false);
	let showSettings = $state(false);

	const errors = $derived(design.diagnostics.filter((d) => d.severity === 'error').length);
	const warnings = $derived(design.diagnostics.length - errors);
	const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
	/** A landscape is open. Without the landscape routes (the static build) the snapshot is it. */
	const open = $derived(design.landscape !== null || !landscapes.available);

	onMount(() => {
		// Subscribe before loading; the store queues events behind the initial load.
		import.meta.hot?.on('sdv:changed', (ev: ChangedEvent) => design.onExternalChange(ev));
		import.meta.hot?.on('sdv:landscape', () => landscapes.onServerSwitch());
		// Landscapes first, so a closed landscape shows the start screen, not an empty canvas.
		void landscapes
			.refresh()
			.then(() => design.load())
			.then(() => theme.init(design.config.theme));
		if (import.meta.env.DEV) (window as unknown as { __sdv: typeof design }).__sdv = design;
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if (!(mac ? e.metaKey : e.ctrlKey)) return;
		const key = e.key.toLowerCase();
		if (key === 'k' && open) {
			e.preventDefault();
			search.open = !search.open;
		} else if (key === 'o' && landscapes.available) {
			e.preventDefault();
			landscapes.menuOpen = false;
			landscapes.dialogOpen = true;
		}
	}}
/>

<svelte:head>
	<title>System Design Viewer</title>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- generated from static tokens -->
	{@html `<style>${themeCss()}</style>`}
</svelte:head>

<div class="app">
	<header class="topbar">
		<a class="brand" href={resolve('/')}>System Design Viewer</a>
		{#if landscapes.available}<LandscapeMenu {mac} />{/if}
		{#if design.loaded && open}<FlagsMenu /><ScenarioControls />{/if}
		<span class="spacer"></span>
		<button
			class="find"
			disabled={!open}
			aria-expanded={search.open}
			aria-pressed={search.open}
			onclick={() => (search.open = !search.open)}
			title="Search the landscape"
			data-testid="search-toggle"
		>
			<Search size={14} />Search<kbd>{mac ? '⌘K' : 'Ctrl K'}</kbd>
		</button>
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
		{:else if design.loaded && !open}
			<StartScreen {mac} />
		{:else if design.loaded}
			{@render children()}
		{:else}
			<p class="muted loading">Loading design…</p>
		{/if}
	</main>
	{#if showDiagnostics}
		<DiagnosticsPanel onclose={() => (showDiagnostics = false)} />
	{/if}
	{#if landscapes.dialogOpen}
		<OpenFolderDialog />
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
	.find {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 240px;
		height: 30px;
		color: var(--ui-muted);
	}
	.find kbd {
		margin-left: auto;
		font: inherit;
		font-size: 11px;
		line-height: 16px;
		padding: 0 5px;
		border: 1px solid var(--ui-border);
		background: var(--ui-bg);
		white-space: nowrap;
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

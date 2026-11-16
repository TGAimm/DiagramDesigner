<script lang="ts">
	import { onMount } from 'svelte';
	import { ArrowUp, Folder, X } from '@lucide/svelte';
	import { design } from '#lib/client/store.svelte.ts';
	import { landscapes } from '#lib/client/landscapes.svelte.ts';
	import type { FolderInfo, FolderListing } from '#lib/server/landscape.ts';

	/**
	 * Picks a folder on the machine the viewer runs on: type or paste a path, or walk the
	 * folders. Folders holding entity files are marked with their count.
	 */
	let listing = $state.raw<FolderListing | null>(null);
	let typed = $state('');
	let selected = $state<string | null>(null);
	let info = $state.raw<FolderInfo | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);
	let input = $state<HTMLInputElement>();

	/** Where Open points: the picked subfolder, else the folder listed. */
	const target = $derived(selected ?? listing?.path ?? null);

	function close() {
		landscapes.dialogOpen = false;
	}

	async function go(path: string | null) {
		error = null;
		busy = true;
		try {
			listing = await landscapes.folders(path);
			typed = listing.path ?? '';
			selected = null;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		const p = target;
		info = null;
		if (!p) return;
		let stale = false;
		landscapes
			.folder(p)
			.then((i) => {
				if (!stale) info = i;
			})
			.catch(() => undefined);
		return () => (stale = true);
	});

	async function openTarget() {
		const p = target;
		if (!p) return;
		const files = info?.path === p ? info.files : undefined;
		if (files === 0 && !confirm(`No entity files in\n${p}\n\nOpen it as an empty landscape?`))
			return;
		error = null;
		busy = true;
		try {
			await landscapes.open(p);
		} catch (e) {
			error = (e as Error).message;
			busy = false;
		}
	}

	/** Double-click: open a landscape, go into any other folder. */
	function enter(d: { path: string; files: number }) {
		if (d.files > 0) {
			selected = d.path;
			void openTarget();
		} else void go(d.path);
	}

	onMount(async () => {
		input?.focus();
		// Start beside the open landscape, so its siblings are one click away.
		const here = design.landscape?.path;
		if (!here) return go(null);
		try {
			const own = await landscapes.folders(here);
			await go(own.parent === undefined ? here : own.parent);
			if (listing?.dirs.some((d) => d.path === here)) selected = here;
		} catch {
			await go(null);
		}
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') close();
	}}
/>

<div class="scrim" role="presentation" onclick={close}></div>
<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="open-title">
	<div class="head">
		<span id="open-title">Open a landscape folder</span>
		<button class="x" aria-label="Close" onclick={close}><X size={16} /></button>
	</div>
	<form
		class="pathbar"
		onsubmit={(e) => {
			e.preventDefault();
			void go(typed.trim() || null);
		}}
	>
		<label class="sr" for="open-path">Folder path</label>
		<input
			id="open-path"
			bind:this={input}
			bind:value={typed}
			placeholder="Type or paste a folder path, then Enter"
			spellcheck="false"
			autocomplete="off"
			data-testid="open-path"
		/>
		<button
			type="button"
			class="up"
			aria-label="Up one folder"
			title="Up one folder"
			disabled={!listing || listing.parent === undefined}
			onclick={() => listing && listing.parent !== undefined && go(listing.parent)}
			><ArrowUp size={16} /></button
		>
	</form>
	{#if listing}
		<nav class="crumbs" aria-label="Path">
			{#each listing.crumbs as c, i (i)}
				{#if i}<span aria-hidden="true">›</span>{/if}
				{#if i === listing.crumbs.length - 1}<b>{c.name}</b>{:else}<button
						onclick={() => go(c.path)}>{c.name}</button
					>{/if}
			{/each}
		</nav>
	{/if}
	<div class="list" role="listbox" aria-label="Folders" aria-busy={busy}>
		{#if listing}
			{#each listing.dirs as d (d.path)}
				<button
					class="dir"
					class:sel={selected === d.path}
					role="option"
					aria-selected={selected === d.path}
					onclick={() => (selected = selected === d.path ? null : d.path)}
					ondblclick={() => enter(d)}
				>
					<Folder size={16} /><span class="nm">{d.name}</span>
					{#if d.files > 0}<span class="badge"
							>Landscape · {d.files}{d.partial ? '+' : ''} files</span
						>{/if}
				</button>
			{:else}
				<p class="empty">No folders here.</p>
			{/each}
		{/if}
	</div>
	<div class="info" aria-live="polite">
		{#if error}
			<span class="err">{error}</span>
		{:else if info && info.path === target}
			<b>{info.name}</b> ·
			{#if info.files}{info.systems} system{info.systems === 1 ? '' : 's'} · {info.files}{info.partial
					? '+'
					: ''} entity files.{:else}no entity files.{/if}
			Double-click a folder to go in; double-click a landscape to open it.
		{:else}
			Double-click a folder to go in; double-click a landscape to open it.
		{/if}
	</div>
	<div class="foot">
		<span class="hint">Folders on the machine the viewer runs on.</span>
		<button onclick={close}>Cancel</button>
		<button class="primary" disabled={!target || busy} onclick={openTarget}>Open landscape</button>
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: rgba(20, 21, 24, 0.35);
		z-index: 40;
	}
	.dlg {
		position: fixed;
		left: 50%;
		top: 90px;
		transform: translateX(-50%);
		width: min(700px, calc(100vw - 32px));
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		box-shadow: var(--ui-shadow);
		z-index: 41;
		display: flex;
		flex-direction: column;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--ui-border);
		font-weight: 600;
	}
	.x {
		border: none;
		background: none;
		color: var(--ui-muted);
		display: flex;
		padding: 2px;
	}
	.pathbar {
		display: flex;
		gap: 8px;
		padding: 12px 16px 8px;
	}
	.pathbar input {
		flex: 1;
		font-size: 13px;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		padding: 5px 8px;
	}
	.pathbar input:focus {
		outline: 2px solid var(--ui-accent-bg);
		border-color: var(--ui-accent);
	}
	.up {
		display: flex;
		align-items: center;
		padding: 4px 7px;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
	.crumbs {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px;
		padding: 0 16px 10px;
		font-size: 12px;
		color: var(--ui-muted);
	}
	.crumbs button {
		border: none;
		background: none;
		padding: 0;
		color: var(--ui-accent);
	}
	.crumbs b {
		color: var(--ui-text);
	}
	.list {
		margin: 0 16px;
		border: 1px solid var(--ui-border);
		height: 300px;
		overflow: auto;
	}
	.dir {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 7px 10px;
		border: none;
		border-bottom: 1px solid var(--ui-border);
		background: none;
		font-size: 13px;
		text-align: left;
		color: var(--ui-text);
	}
	.dir :global(svg) {
		flex: none;
		color: var(--ui-muted);
	}
	.dir.sel {
		background: var(--ui-accent-bg);
	}
	.dir.sel :global(svg) {
		color: var(--ui-accent);
	}
	.nm {
		flex: 1;
	}
	.badge {
		font-size: 11px;
		font-weight: 600;
		color: var(--ui-accent);
		border: 1px solid var(--ui-accent);
		padding: 0 6px;
		line-height: 18px;
		white-space: nowrap;
	}
	.empty {
		margin: 0;
		padding: 12px;
		color: var(--ui-muted);
		font-size: 13px;
	}
	.info {
		padding: 10px 16px;
		font-size: 12px;
		color: var(--ui-muted);
		line-height: 1.5;
		min-height: 18px;
	}
	.info b {
		color: var(--ui-text);
	}
	.err {
		color: var(--ui-danger);
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px;
		border-top: 1px solid var(--ui-border);
	}
	.hint {
		flex: 1;
		font-size: 12px;
		color: var(--ui-muted);
	}
</style>

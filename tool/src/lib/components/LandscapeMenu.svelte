<script lang="ts">
	import { Check, ChevronDown, ChevronUp, Folder, FolderOpen, X } from '@lucide/svelte';
	import { design } from '#lib/client/store.svelte.ts';
	import { landscapes } from '#lib/client/landscapes.svelte.ts';

	/**
	 * Topbar: names the open landscape. Its menu lists the recent landscapes (switch, or remove
	 * from the list), opens a folder and closes the landscape.
	 */
	let { mac = false }: { mac?: boolean } = $props();
	let wrap = $state<HTMLDivElement>();
	const current = $derived(design.landscape);
	const isCurrent = (path: string) =>
		!!current?.path && current.path.toLowerCase() === path.toLowerCase();

	function toggle() {
		landscapes.menuOpen = !landscapes.menuOpen;
		if (landscapes.menuOpen) void landscapes.refresh();
	}

	function openFolder() {
		landscapes.menuOpen = false;
		landscapes.dialogOpen = true;
	}

	async function pick(path: string) {
		landscapes.menuOpen = false;
		if (!isCurrent(path)) await landscapes.open(path).catch(() => undefined);
	}
</script>

<svelte:window
	onpointerdown={(e) => {
		if (landscapes.menuOpen && wrap && !wrap.contains(e.target as Node))
			landscapes.menuOpen = false;
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape' && landscapes.menuOpen) landscapes.menuOpen = false;
	}}
/>

<div class="wrap" bind:this={wrap}>
	<button
		class="pick"
		class:on={landscapes.menuOpen}
		class:none={!current}
		aria-haspopup="menu"
		aria-expanded={landscapes.menuOpen}
		onclick={toggle}
		title={current?.path ?? 'Landscapes'}
		data-testid="landscape-menu"
	>
		<Folder size={14} />{current?.name ?? 'No landscape'}
		{#if landscapes.menuOpen}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}
	</button>
	{#if landscapes.menuOpen}
		<div class="menu" role="menu" aria-label="Landscapes">
			{#if landscapes.recent.length}
				<h2 class="sec">RECENT LANDSCAPES</h2>
				{#each landscapes.recent as r (r.path)}
					{@const cur = isCurrent(r.path)}
					<div class="row" class:cur class:gone={!r.exists}>
						<button
							class="go"
							role="menuitemradio"
							aria-checked={cur}
							disabled={!r.exists}
							onclick={() => pick(r.path)}
						>
							<span class="tick"
								>{#if cur}<Check size={16} />{/if}</span
							>
							<span class="txt">
								<b>{r.name}</b>
								<small
									>{r.path}{#if !r.exists}
										· folder not found{/if}</small
								>
							</span>
							{#if r.exists}<span class="meta">{r.files}{r.partial ? '+' : ''} files</span>{/if}
						</button>
						{#if !r.exists}
							<button class="link" onclick={() => landscapes.forget(r.path)}>Remove</button>
						{:else if !cur}
							<button
								class="x"
								aria-label="Remove {r.name} from recent"
								title="Remove from recent"
								onclick={() => landscapes.forget(r.path)}><X size={14} /></button
							>
						{/if}
					</div>
				{/each}
				<div class="sep"></div>
			{/if}
			<button class="act" role="menuitem" onclick={openFolder}>
				<FolderOpen size={16} />Open folder…<kbd>{mac ? '⌘O' : 'Ctrl O'}</kbd>
			</button>
			<button
				class="act"
				role="menuitem"
				disabled={!current}
				onclick={() => {
					landscapes.menuOpen = false;
					void landscapes.close();
				}}><X size={16} />Close landscape</button
			>
			{#if landscapes.error}<p class="err">{landscapes.error}</p>{/if}
		</div>
	{/if}
</div>

<style>
	.wrap {
		position: relative;
		margin-left: 6px;
	}
	.pick {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		max-width: 280px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pick.on {
		background: var(--ui-accent-bg);
		border-color: var(--ui-accent);
	}
	.pick.none {
		color: var(--ui-muted);
	}
	.menu {
		position: absolute;
		left: 0;
		top: calc(100% + 4px);
		width: 440px;
		z-index: 30;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		box-shadow: var(--ui-shadow);
		font-size: 13px;
		padding: 6px 0;
	}
	.sec {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--ui-muted);
		margin: 6px 14px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding-right: 10px;
	}
	.row.cur {
		background: var(--ui-accent-bg);
	}
	.row:hover:not(.cur) {
		background: var(--ui-hover);
	}
	.go {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 4px 7px 14px;
		border: none;
		background: none;
		text-align: left;
	}
	.go:hover:not(:disabled) {
		background: none;
	}
	.go:disabled {
		opacity: 1;
	}
	.tick {
		width: 16px;
		flex: none;
		display: flex;
		color: var(--ui-accent);
	}
	.txt {
		flex: 1;
		min-width: 0;
	}
	.txt b {
		display: block;
		font-weight: 600;
	}
	.txt small {
		display: block;
		font-size: 12px;
		color: var(--ui-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.gone .txt b {
		color: var(--ui-muted);
		text-decoration: line-through;
	}
	.meta {
		font-size: 12px;
		color: var(--ui-muted);
		white-space: nowrap;
	}
	.x {
		border: none;
		background: none;
		color: var(--ui-muted);
		display: flex;
		padding: 2px;
		visibility: hidden;
	}
	.row:hover .x,
	.x:focus-visible {
		visibility: visible;
	}
	.link {
		border: none;
		background: none;
		padding: 0;
		font-size: 12px;
		color: var(--ui-accent);
	}
	.sep {
		height: 1px;
		background: var(--ui-border);
		margin: 6px 0;
	}
	.act {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		border: none;
		background: none;
		padding: 7px 14px;
		text-align: left;
	}
	.act:hover:not(:disabled) {
		background: var(--ui-hover);
	}
	kbd {
		margin-left: auto;
		font: inherit;
		font-size: 11px;
		line-height: 16px;
		padding: 0 5px;
		border: 1px solid var(--ui-border);
		background: var(--ui-bg);
		color: var(--ui-muted);
	}
	.err {
		margin: 6px 14px 2px;
		font-size: 12px;
		color: var(--ui-danger);
	}
</style>

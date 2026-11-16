<script lang="ts">
	import { FolderOpen } from '@lucide/svelte';
	import { landscapes } from '#lib/client/landscapes.svelte.ts';

	/** No landscape open: open a folder, a recent landscape or an example. */
	let { mac = false }: { mac?: boolean } = $props();
	const recent = $derived(landscapes.recent.filter((r) => r.exists));
</script>

<div class="screen">
	<section class="start" aria-labelledby="start-title">
		<div>
			<h1 id="start-title">Open a landscape</h1>
			<p>
				A landscape is a folder of entity files (<code>*.module.yaml</code>,
				<code>*.model.yaml</code>, …). Open one from this machine, pick a recent one, or start from
				an example.
			</p>
		</div>
		<div>
			<button class="primary big" onclick={() => (landscapes.dialogOpen = true)}>
				<FolderOpen size={16} />Open folder…<kbd>{mac ? '⌘O' : 'Ctrl O'}</kbd>
			</button>
		</div>
		{#if recent.length}
			<div>
				<h2 class="sec">RECENT</h2>
				<div class="lst">
					{#each recent as r (r.path)}
						<button class="item" onclick={() => landscapes.open(r.path)}>
							<span class="txt"><b>{r.name}</b><small>{r.path}</small></span>
							<span class="meta">{r.files}{r.partial ? '+' : ''} files</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}
		{#if landscapes.examples.length}
			<div>
				<h2 class="sec">EXAMPLES</h2>
				<div class="lst">
					{#each landscapes.examples as r (r.path)}
						<button class="item" onclick={() => landscapes.open(r.path)}>
							<span class="txt"><b>{r.name}</b><small>{r.path}</small></span>
							<span class="meta">{r.files} files</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}
		{#if landscapes.error}<p class="err">{landscapes.error}</p>{/if}
	</section>
</div>

<style>
	.screen {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		background-color: var(--sdv-canvas-bg, var(--ui-bg));
		overflow: auto;
	}
	.start {
		width: min(560px, 100%);
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		box-shadow: var(--ui-shadow);
		padding: 28px 28px 20px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	h1 {
		margin: 0;
		font-size: 22px;
	}
	p {
		margin: 6px 0 0;
		color: var(--ui-muted);
		font-size: 13px;
		line-height: 1.5;
	}
	.big {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 16px;
		font-weight: 600;
	}
	kbd {
		font: inherit;
		font-size: 11px;
		line-height: 16px;
		padding: 0 5px;
		border: 1px solid rgba(255, 255, 255, 0.6);
	}
	.sec {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--ui-muted);
		margin: 0 0 6px;
	}
	.lst {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--ui-border);
	}
	.item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border: none;
		border-bottom: 1px solid var(--ui-border);
		background: none;
		text-align: left;
		width: 100%;
	}
	.item:last-child {
		border-bottom: none;
	}
	.txt {
		flex: 1;
		min-width: 0;
	}
	.txt b {
		display: block;
		font-size: 13px;
	}
	.txt small {
		display: block;
		font-size: 12px;
		color: var(--ui-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		font-size: 12px;
		color: var(--ui-muted);
		white-space: nowrap;
	}
	.err {
		color: var(--ui-danger);
	}
</style>

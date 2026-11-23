<script lang="ts">
	import { Crosshair, X } from '@lucide/svelte';
	import { changes } from '#lib/client/changes.svelte.ts';
	import { scenarioAsk } from '#lib/client/search.svelte.ts';
	import FrontEnds from './FrontEnds.svelte';
	import { changeGlyph, changeLabel, changeTarget } from '#lib/scenario/labels.ts';

	/**
	 * Left of the canvas: the shown scenario's changes in order, with Apply, Report and
	 * Discard; or the design's history, one commit compared at a time. What the changes
	 * affect is on the canvas, not here. Focus cuts the canvas to how far the scenario, or one
	 * change of it, reaches; in that focus, where it ends is listed here.
	 */
	let { go }: { go: (id: string) => void } = $props();

	const s = $derived(changes.scenario);
	const c = $derived(changes.comparison);
	const stale = $derived(changes.results.filter((r) => r.status !== 'ok').length);
	const blocked = $derived(
		!s?.changes.length
			? 'Add a change to apply.'
			: stale || changes.errors.length
				? `Fix ${[stale && `${stale} stale change${stale > 1 ? 's' : ''}`, changes.errors.length && `${changes.errors.length} error${changes.errors.length > 1 ? 's' : ''}`].filter(Boolean).join(' and ')} to apply.`
				: ''
	);
	let copied = $state(false);

	async function report() {
		const text = changes.report();
		if (!text) return;
		await navigator.clipboard.writeText(text);
		copied = true;
		setTimeout(() => (copied = false), 1600);
	}

	const when = (t?: number) => {
		if (!t) return '';
		const days = Math.floor((Date.now() / 1000 - t) / 86400);
		return days < 1
			? 'today'
			: days === 1
				? 'yesterday'
				: days < 14
					? `${days} days ago`
					: new Date(t * 1000).toLocaleDateString();
	};

	$effect(() => {
		if (changes.panel === 'history' && !changes.history) void changes.loadHistory();
	});
</script>

{#if changes.panel === 'changes' && s && c}
	<aside class="panel" aria-label="Changes">
		<header>
			<div class="head">
				<p class="title">{s.name}</p>
				{#if s.description}<p class="desc">{s.description}</p>{/if}
				<div class="file">{s.path}</div>
			</div>
			{#if s.changes.length}
				<button
					class="btn focus"
					onclick={() => (scenarioAsk.change = 'all')}
					title="Show only what the scenario reaches, up to where it breaks or settles"
					><Crosshair size={13} />Focus</button
				>
			{/if}
			<button class="icon-btn" onclick={() => (changes.panel = null)} aria-label="Close"
				><X size={16} /></button
			>
		</header>
		<h3 class="sec">Changes, in order</h3>
		<div class="list">
			{#each s.changes as ch, i (i)}
				{@const r = changes.results[i]}
				{@const level = c.report.levelOf.get(changeTarget(ch))}
				<div class="chg">
					<button class="go" onclick={() => go(changeTarget(ch))}>
						<span class="n">{i + 1}</span><span class="op">{changeGlyph(ch)}</span>
						<span class="b">
							<span class="t">{changeLabel(c.before, c.after, ch)}</span>
							{#if r && r.status !== 'ok'}<span class="w stale">{r.status}: {r.message}</span>{/if}
						</span>
						{#if r && r.status !== 'ok'}<span class="tag chk">{r.status}</span
							>{:else if level === 'breaking'}<span class="tag brk">breaking</span
							>{:else if level === 'check'}<span class="tag chk">check</span
							>{:else if level === 'info'}<span class="tag ok">info</span>{/if}
					</button>
					<button
						class="icon-btn"
						onclick={() => (scenarioAsk.change = i)}
						aria-label="Focus on change {i + 1}"
						title="Show only what this change reaches"><Crosshair size={13} /></button
					>
					<button
						class="icon-btn rm"
						onclick={() => changes.remove(i)}
						aria-label="Remove change {i + 1}"
						title="Remove this change"><X size={13} /></button
					>
				</div>
			{:else}
				<p class="empty">
					No changes yet. Right-click a field or a model's name bar on the canvas to change it.
				</p>
			{/each}
		</div>
		{#if changes.subject?.scenario && changes.front}
			<div class="ends"><FrontEnds front={changes.front} {go} /></div>
		{/if}
		{#if changes.errors.length}
			<h3 class="sec">Errors after applying</h3>
			{#each changes.errors as e, i (i)}<p class="err">{e.message}</p>{/each}
		{/if}
		<footer>
			{#if changes.error}<p class="err">{changes.error}</p>{/if}
			{#if blocked}<p class="why">{blocked}</p>{/if}
			<div class="actions">
				<button class="btn pri" disabled={!!blocked} onclick={() => changes.apply()}
					>Apply to the design</button
				>
				<button class="btn" onclick={report} title="Copy a markdown report for reviewers"
					>{copied ? 'Copied' : 'Report'}</button
				>
				<span class="spacer"></span>
				<button
					class="btn"
					onclick={() => {
						if (confirm(`Discard “${s.name}” and delete its file?`)) void changes.discard();
					}}>Discard</button
				>
			</div>
		</footer>
	</aside>
{:else if changes.panel === 'history'}
	<aside class="panel" aria-label="History">
		<header>
			<div class="head"><p class="title">History</p></div>
			<button
				class="icon-btn"
				onclick={() => {
					changes.panel = null;
					if (changes.source?.kind === 'history') changes.show(null);
				}}
				aria-label="Close"><X size={16} /></button
			>
		</header>
		<h3 class="sec">Commits touching the design</h3>
		<div class="list">
			{#if changes.historyError}<p class="err">{changes.historyError}</p>{/if}
			{#each changes.history ?? [] as h (h.rev)}
				{@const on = changes.source?.kind === 'history' && changes.source.rev === h.rev}
				<button class="cm" class:on onclick={() => changes.showRev(h)}>
					<span class="t">
						{#if h.scenario}<span class="scn">scenario</span>{h.scenario
								.name}{:else}{h.subject}{/if}
					</span>
					{#if h.scenario?.description}<span class="d">{h.scenario.description}</span>{/if}
					<span class="w"
						>{#if h.short}<span class="sha">{h.short}</span>{/if}<span>{when(h.time)}</span
						>{#if on && c}<span
								>{c.summary.changed + c.summary.added + c.summary.dropped + c.summary.moved} changes</span
							>{/if}</span
					>
				</button>
			{:else}
				{#if changes.history}<p class="empty">No commits touch the design yet.</p>{/if}
			{/each}
		</div>
	</aside>
{/if}

<style>
	.panel {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 340px;
		z-index: 6;
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		background: var(--ui-panel);
		border-right: 1px solid var(--ui-border);
		color: var(--ui-text);
		font-size: 13px;
	}
	header {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		padding: 12px 12px 10px 16px;
		border-bottom: 1px solid var(--ui-border);
	}
	.head {
		flex: 1;
		min-width: 0;
	}
	.title {
		margin: 0 0 2px;
		font-size: 15px;
		font-weight: 600;
	}
	.desc {
		margin: 0 0 4px;
	}
	.file {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 11.5px;
		color: var(--ui-muted);
		overflow-wrap: anywhere;
	}
	.sec {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--ui-muted);
		margin: 0;
		padding: 12px 16px 6px;
		text-transform: uppercase;
	}
	.list {
		overflow-y: auto;
		min-height: 0;
		flex: 0 1 auto;
	}
	.chg {
		display: flex;
		align-items: center;
		border-bottom: 1px solid var(--ui-border);
	}
	.go,
	.cm {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		flex: 1;
		min-width: 0;
		padding: 8px 4px 8px 16px;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.go:hover,
	.cm:hover {
		background: var(--ui-hover);
	}
	.n {
		font-size: 11px;
		color: var(--ui-muted);
		width: 14px;
		padding-top: 2px;
		font-variant-numeric: tabular-nums;
	}
	.op {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		flex: none;
		border-radius: 3px;
		background: var(--sdv-op-fill);
		color: var(--sdv-op-text);
		font-weight: 700;
		font-size: 13px;
		line-height: 1;
		margin-top: 1px;
	}
	.b {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.t {
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	.w {
		font-size: 12px;
		color: var(--ui-muted);
	}
	.w.stale {
		color: var(--sdv-sev-check);
	}
	.tag {
		font-size: 11px;
		font-weight: 600;
		padding: 0 6px;
		border-radius: 3px;
		line-height: 18px;
		white-space: nowrap;
	}
	.brk {
		background: color-mix(in srgb, var(--sdv-sev-break) 16%, transparent);
		color: var(--sdv-sev-break);
	}
	.chk {
		background: color-mix(in srgb, var(--sdv-sev-check) 18%, transparent);
		color: var(--sdv-sev-check);
	}
	.ok {
		background: color-mix(in srgb, var(--sdv-edge) 20%, transparent);
		color: var(--ui-muted);
	}
	.rm {
		margin-right: 8px;
	}
	.focus {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		flex: none;
	}
	.ends {
		padding: 12px 16px 4px;
		overflow-y: auto;
		min-height: 0;
	}
	.cm {
		flex-direction: column;
		gap: 2px;
		width: 100%;
		box-sizing: border-box;
		border-bottom: 1px solid var(--ui-border);
	}
	.cm.on {
		background: var(--ui-accent-bg);
		box-shadow: inset 2px 0 0 var(--ui-accent);
	}
	.cm .t {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.cm .d {
		font-size: 12px;
	}
	.cm .w {
		display: flex;
		gap: 8px;
	}
	.sha {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 11.5px;
	}
	.scn {
		font-size: 11px;
		font-weight: 600;
		padding: 0 6px;
		line-height: 18px;
		border-radius: 3px;
		background: var(--ui-accent-bg);
		color: var(--ui-accent);
	}
	.empty,
	.why {
		margin: 8px 16px;
		color: var(--ui-muted);
		font-size: 12px;
	}
	.err {
		margin: 4px 16px;
		color: var(--ui-danger);
		font-size: 12px;
	}
	footer {
		margin-top: auto;
		padding: 12px 16px;
		border-top: 1px solid var(--ui-border);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	footer .why,
	footer .err {
		margin: 0;
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	.spacer {
		flex: 1;
	}
	.btn {
		font: inherit;
		color: inherit;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		padding: 4px 10px;
		line-height: 20px;
		cursor: pointer;
	}
	.btn.pri {
		background: var(--ui-text);
		color: var(--ui-panel);
		border-color: var(--ui-text);
	}
	.btn:disabled {
		background: var(--ui-panel);
		color: var(--ui-muted);
		border-color: var(--ui-border);
		cursor: default;
	}
	.icon-btn {
		border: none;
		background: none;
		color: var(--ui-muted);
		display: flex;
		cursor: pointer;
		padding: 2px;
	}
</style>

<script lang="ts">
	import { ChevronDown, GitBranch, History, Plus } from '@lucide/svelte';
	import { changes, type Mode } from '#lib/client/changes.svelte.ts';
	import { summaryLine } from '#lib/scenario/report.ts';

	/**
	 * Topbar: which scenario or commit is compared, how it is shown, and the one summary line
	 * of what it changes and breaks. Counts appear here and nowhere else.
	 */
	let menu = $state(false);
	let creating = $state<'new' | 'describe' | null>(null);
	let name = $state('');
	let description = $state('');

	const label = $derived(
		changes.source?.kind === 'scenario'
			? (changes.scenario?.name ?? 'Scenario')
			: changes.source?.kind === 'history'
				? changes.source.title
				: 'The design'
	);
	const summary = $derived(changes.comparison?.summary);
	const MODES: Mode[] = ['before', 'diff', 'after'];

	function startForm(kind: 'new' | 'describe') {
		creating = kind;
		name = kind === 'describe' ? (changes.scenario?.name ?? '') : '';
		description = kind === 'describe' ? (changes.scenario?.description ?? '') : '';
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!name.trim()) return;
		if (creating === 'new') await changes.create(name.trim(), description.trim() || undefined);
		else await changes.describe(name.trim(), description.trim() || undefined);
		creating = null;
		menu = false;
	}
</script>

<div class="wrap">
	<button
		class="pick"
		class:on={!!changes.source}
		aria-haspopup="menu"
		aria-expanded={menu}
		onclick={() => {
			menu = !menu;
			creating = null;
		}}
		title="Scenarios and history"
		data-testid="scenario-menu"
	>
		{#if changes.source?.kind === 'history'}<History size={14} />{:else}<GitBranch size={14} />{/if}
		<span class="name">{label}</span><ChevronDown size={12} />
	</button>
	{#if menu}
		<div class="menu" role="menu">
			{#if creating}
				<form onsubmit={submit}>
					<label>Name<input bind:value={name} placeholder="Rename SKU to product code" /></label>
					<label
						>Why <span class="opt">optional</span><textarea bind:value={description} rows="2"
						></textarea></label
					>
					<div class="row">
						<button type="submit" class="primary" disabled={!name.trim()}
							>{creating === 'new' ? 'Create' : 'Save'}</button
						>
						<button type="button" onclick={() => (creating = null)}>Cancel</button>
					</div>
					{#if changes.error}<p class="err">{changes.error}</p>{/if}
				</form>
			{:else}
				<div class="mh">Show</div>
				<button
					class="mi"
					role="menuitemradio"
					aria-checked={!changes.source}
					onclick={() => {
						changes.show(null);
						menu = false;
					}}><span class="check">{!changes.source ? '✓' : ''}</span>The design as it is</button
				>
				{#each changes.scenarios as s (s.path)}
					{@const on = changes.source?.kind === 'scenario' && changes.source.path === s.path}
					<button
						class="mi"
						role="menuitemradio"
						aria-checked={on}
						onclick={() => {
							changes.show({ kind: 'scenario', path: s.path });
							menu = false;
						}}
						><span class="check">{on ? '✓' : ''}</span>{s.name}<span class="r"
							>{s.changes.length} change{s.changes.length === 1 ? '' : 's'}</span
						></button
					>
				{/each}
				<div class="sep"></div>
				<button class="mi" role="menuitem" onclick={() => startForm('new')}
					><span class="check"><Plus size={13} /></span>New scenario…</button
				>
				{#if changes.scenario}
					<button class="mi" role="menuitem" onclick={() => startForm('describe')}
						><span class="check"></span>Rename or describe this one…</button
					>
				{/if}
				<div class="sep"></div>
				<button
					class="mi"
					role="menuitem"
					onclick={() => {
						changes.panel = 'history';
						menu = false;
					}}
					><span class="check"><History size={13} /></span>History<span class="r"
						>design commits</span
					></button
				>
			{/if}
		</div>
	{/if}
</div>
{#if changes.comparison}
	<div class="seg" role="group" aria-label="Show">
		{#each MODES as m (m)}
			<button aria-pressed={changes.mode === m} onclick={() => (changes.mode = m)}
				>{m[0].toUpperCase() + m.slice(1)}</button
			>
		{/each}
	</div>
	{#if summary}
		<button
			class="sum"
			onclick={() => (changes.panel = changes.source?.kind === 'history' ? 'history' : 'changes')}
			title="Show the list"
		>
			{#each summaryLine(summary).split(' — ') as part, i (i)}
				{#if i}<span class="dash">—</span>{/if}
				{#each part.split(' · ') as bit, j (j)}
					{#if j}<span class="dot">·</span>{/if}<span
						class:k={bit.endsWith('breaking')}
						class:w={bit.endsWith('to check')}>{bit}</span
					>
				{/each}
			{/each}
		</button>
	{/if}
{/if}

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
		max-width: 260px;
	}
	.pick.on {
		background: var(--ui-accent-bg);
		border-color: var(--ui-accent);
	}
	.pick .name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.menu {
		position: absolute;
		left: 0;
		top: calc(100% + 4px);
		width: 320px;
		z-index: 30;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		box-shadow: var(--ui-shadow);
		padding: 4px 0;
		font-size: 13px;
	}
	.mi {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 6px 12px;
		border: none;
		background: none;
		text-align: left;
		white-space: nowrap;
	}
	.mi[aria-checked='true'] {
		background: var(--ui-accent-bg);
	}
	.mi .r {
		margin-left: auto;
		font-size: 12px;
		color: var(--ui-muted);
	}
	.check {
		width: 14px;
		display: inline-flex;
		justify-content: center;
		color: var(--ui-accent);
	}
	.mh {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--ui-muted);
		padding: 6px 12px 4px;
		text-transform: uppercase;
	}
	.sep {
		height: 1px;
		background: var(--ui-border);
		margin: 4px 0;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px 12px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 12px;
		color: var(--ui-muted);
	}
	label input,
	label textarea {
		color: var(--ui-text);
		font-size: 13px;
	}
	.opt {
		font-style: italic;
	}
	.row {
		display: flex;
		gap: 8px;
	}
	.err {
		margin: 0;
		color: var(--ui-danger);
		font-size: 12px;
	}
	.seg {
		display: inline-flex;
	}
	.seg button {
		height: 30px;
		font-size: 13px;
		color: var(--ui-muted);
		margin-left: -1px;
	}
	.seg button[aria-pressed='true'] {
		color: var(--ui-text);
		font-weight: 600;
		position: relative;
	}
	.sum {
		border: none;
		background: none;
		font-size: 13px;
		color: var(--ui-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		display: flex;
		gap: 4px;
	}
	.sum .k {
		color: var(--sdv-sev-break);
		font-weight: 600;
	}
	.sum .w {
		color: var(--sdv-sev-check);
		font-weight: 600;
	}
</style>

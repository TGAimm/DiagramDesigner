<script lang="ts">
	import { Crosshair, Search } from '@lucide/svelte';
	import { changes } from '#lib/client/changes.svelte.ts';
	import { searchLandscape, type Hit, type Mark } from '#lib/landscape/search.ts';
	import { methodColor } from '#lib/theme/tokens.ts';
	import type { FocusMode } from '#lib/landscape/focus.ts';
	import EntityGlyph, { type GlyphKind } from './canvas/EntityGlyph.svelte';

	let {
		onpick,
		onfocus,
		onclose
	}: {
		onpick: (hit: Hit) => void;
		/** Show only the hit and what connects to it: everything, or its data models. */
		onfocus: (hit: Hit, mode: FocusMode) => void;
		onclose: () => void;
	} = $props();

	let query = $state('');
	let active = $state(0);
	let list = $state<HTMLElement>();

	const groups = $derived(searchLandscape(changes.shown, query, changes.hidden));
	const hits = $derived(groups.flatMap((g) => g.hits));
	/** Index in `hits` of each group's first hit. */
	const starts = $derived(
		groups.map((_, i) => groups.slice(0, i).reduce((n, g) => n + g.hits.length, 0))
	);
	const GLYPH: Record<Hit['kind'], GlyphKind | undefined> = {
		system: 'system',
		module: 'module',
		model: 'class',
		field: undefined,
		api: 'api',
		'logic-unit': 'logic',
		trigger: 'trigger',
		channel: 'channel'
	};
	const parts = (text: string, mark: Mark | undefined) =>
		mark ? [text.slice(0, mark[0]), text.slice(...mark), text.slice(mark[1])] : [text, '', ''];

	function move(by: number) {
		if (!hits.length) return;
		active = (active + by + hits.length) % hits.length;
		list?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') move(1);
		else if (e.key === 'ArrowUp') move(-1);
		else if (e.key === 'Enter' && hits[active] && e.shiftKey) onfocus(hits[active], 'all');
		else if (e.key === 'Enter' && hits[active] && e.altKey) onfocus(hits[active], 'data');
		else if (e.key === 'Enter' && hits[active]) onpick(hits[active]);
		else if (e.key === 'Escape') onclose();
		else return;
		e.preventDefault();
		// Esc here closes search only, not the canvas's picks too.
		e.stopPropagation();
	}
</script>

{#snippet marked(text: string, mark: Mark | undefined)}
	{@const [a, b, c] = parts(text, mark)}{a}{#if b}<mark>{b}</mark>{/if}{c}
{/snippet}

<!-- Esc closes it too; the scrim is not a control. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onclose}></div>
<div class="cmd" role="dialog" aria-label="Search the landscape" data-testid="search">
	<label class="input">
		<Search size={16} />
		<input
			{@attach (n) => n.focus()}
			type="text"
			bind:value={query}
			oninput={() => (active = 0)}
			{onkeydown}
			placeholder="Search systems, modules, models, fields, APIs, logic units…"
			aria-label="Search"
			aria-controls="search-hits"
			aria-activedescendant={hits[active] ? `hit-${active}` : undefined}
			autocomplete="off"
			spellcheck="false"
		/>
		<kbd>Esc</kbd>
	</label>
	<div class="list" id="search-hits" role="listbox" bind:this={list}>
		{#each groups as g, gi (g.kind)}
			<h3>{g.title}</h3>
			{#each g.hits as h, j (h.id)}
				{@const i = starts[gi] + j}
				{@const glyph = GLYPH[h.kind]}
				<!-- The active row offers its two focuses beside it. -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="row" class:on={i === active} onpointermove={() => (active = i)}>
					<button
						class="hit"
						id="hit-{i}"
						data-index={i}
						role="option"
						aria-selected={i === active}
						tabindex="-1"
						onclick={() => onpick(h)}
					>
						<span class="name">
							{#if glyph}<EntityGlyph kind={glyph} />{:else}<span class="slot"></span>{/if}
							{#if h.method}<b class="method" style:color={methodColor(h.method)}>{h.method}</b
								>{/if}
							<span>{@render marked(h.text, h.mark)}</span>
							{#if h.alt}<span class="alt">{@render marked(h.alt.text, h.alt.mark)}</span>{/if}
						</span>
						<span class="at">{h.at.join(' › ')}</span>
					</button>
					{#if i === active}
						<span class="acts">
							<button
								class="act"
								tabindex="-1"
								title="Focus: everything relevant (⇧↵)"
								onclick={() => onfocus(h, 'all')}><Crosshair size={12} />Focus</button
							>
							<button
								class="act"
								tabindex="-1"
								title="Focus: data models only (⌥↵)"
								onclick={() => onfocus(h, 'data')}><EntityGlyph kind="class" />Data models</button
							>
						</span>
					{/if}
				</div>
			{/each}
		{:else}
			<p class="none">No matches for “{query.trim()}”.</p>
		{/each}
	</div>
	<footer>
		<span><kbd>↑</kbd><kbd>↓</kbd>move</span>
		<span><kbd>↵</kbd>go to</span>
		<span><kbd>⇧↵</kbd>focus</span>
		<span><kbd>⌥↵</kbd>data models</span>
		<span><kbd>Esc</kbd>close</span>
		{#if query.trim() && hits.length}
			<span class="count">{hits.length} {hits.length === 1 ? 'match' : 'matches'}</span>
		{/if}
	</footer>
</div>

<style>
	.scrim {
		position: absolute;
		inset: 0;
		z-index: 20;
		background: rgba(29, 29, 27, 0.18);
	}
	:global([data-theme='dark']) .scrim {
		background: rgba(0, 0, 0, 0.45);
	}
	.cmd {
		position: absolute;
		z-index: 21;
		top: 52px;
		left: 50%;
		transform: translateX(-50%);
		width: min(600px, calc(100% - 32px));
		display: flex;
		flex-direction: column;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
	}
	.input {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 48px;
		padding: 0 14px;
		border-bottom: 1px solid var(--ui-border);
		color: var(--ui-muted);
	}
	.input input {
		flex: 1;
		min-width: 0;
		padding: 0;
		border: none;
		outline: none;
		background: none;
		font-size: 15px;
		color: var(--ui-text);
	}
	.input input::placeholder {
		color: var(--ui-muted);
	}
	kbd {
		font: inherit;
		font-size: 11px;
		line-height: 16px;
		padding: 0 5px;
		border: 1px solid var(--ui-border);
		background: var(--ui-bg);
		color: var(--ui-muted);
		white-space: nowrap;
	}
	.list {
		max-height: min(480px, calc(100vh - 220px));
		overflow-y: auto;
		padding: 6px 0;
	}
	h3 {
		margin: 0;
		padding: 8px 14px 4px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--ui-muted);
	}
	.row {
		display: flex;
		align-items: center;
		padding-right: 14px;
	}
	.row.on {
		background: var(--ui-accent-bg);
		box-shadow: inset 2px 0 0 var(--ui-accent);
	}
	.hit {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
		height: 34px;
		padding: 0 14px;
		border: none;
		background: none;
		text-align: left;
		cursor: pointer;
	}
	.hit:hover:not(:disabled) {
		background: none;
	}
	.acts {
		display: flex;
		gap: 6px;
		flex: none;
	}
	.act {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 8px;
		font-size: 12px;
		line-height: 18px;
		border: 1px solid var(--ui-accent);
		background: var(--ui-panel);
		white-space: nowrap;
		cursor: pointer;
	}
	.name {
		display: flex;
		align-items: center;
		gap: 0.5em;
		min-width: 0;
		white-space: nowrap;
	}
	.slot {
		width: 0.85em;
		flex: none;
	}
	.method {
		font-size: 12px;
	}
	.alt,
	.at {
		font-size: 12px;
		color: var(--ui-muted);
	}
	.at {
		margin-left: auto;
		padding-left: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	mark {
		background: none;
		color: inherit;
		font-weight: 700;
		text-decoration: underline;
		text-decoration-color: var(--ui-accent);
		text-underline-offset: 3px;
	}
	.none {
		margin: 0;
		padding: 14px;
		color: var(--ui-muted);
	}
	footer {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 8px 14px;
		border-top: 1px solid var(--ui-border);
		font-size: 12px;
		color: var(--ui-muted);
	}
	footer span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.count {
		margin-left: auto;
	}
</style>

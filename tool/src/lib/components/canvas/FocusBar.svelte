<script lang="ts">
	import { Crosshair, X } from '@lucide/svelte';
	import type { Focus, FocusDepth, FocusMode } from '#lib/landscape/focus.ts';
	import EntityGlyph, { type GlyphKind } from './EntityGlyph.svelte';

	// The controls of a focus, over the canvas's top left: what is focused, what to show, how
	// far to follow connections, and the way out. The canvas shows the rest.
	let {
		focus,
		name,
		kind,
		onchange,
		onleave
	}: {
		focus: Focus;
		name: string;
		/** The subject's entity kind, or `field`. */
		kind: string;
		onchange: (f: Focus) => void;
		onleave: () => void;
	} = $props();

	const GLYPH: Record<string, GlyphKind | undefined> = {
		system: 'system',
		module: 'module',
		model: 'class',
		api: 'api',
		'logic-unit': 'logic'
	};
	const MODES: [FocusMode, string][] = [
		['all', 'Everything'],
		['data', 'Data models']
	];
	const DEPTHS: [FocusDepth, string][] = [
		[1, '1'],
		[2, '2'],
		['all', 'All']
	];
</script>

<div class="bar" role="toolbar" aria-label="Focus" data-testid="focus-bar">
	<span class="label"><Crosshair size={14} />Focus</span>
	<span class="subject">
		{#if GLYPH[kind]}<EntityGlyph kind={GLYPH[kind]!} />{/if}{name}
	</span>
	<span class="sep"></span>
	<div class="seg" role="group" aria-label="What to show">
		{#each MODES as [mode, text] (mode)}
			<button
				class:on={focus.mode === mode}
				aria-pressed={focus.mode === mode}
				onclick={() => onchange({ ...focus, mode })}>{text}</button
			>
		{/each}
	</div>
	<div class="seg" role="group" aria-label="Depth">
		<span class="seg-label">Depth</span>
		{#each DEPTHS as [depth, text] (depth)}
			<button
				class:on={focus.depth === depth}
				aria-pressed={focus.depth === depth}
				title={depth === 'all' ? 'Follow every connection' : `${depth} hop${depth > 1 ? 's' : ''}`}
				onclick={() => onchange({ ...focus, depth })}>{text}</button
			>
		{/each}
	</div>
	<span class="sep"></span>
	<button class="leave" aria-label="Leave focus" title="Leave focus (Esc)" onclick={onleave}
		><X size={14} />Leave<kbd>Esc</kbd></button
	>
</div>

<style>
	.bar {
		position: absolute;
		left: 12px;
		top: 12px;
		z-index: 11;
		display: flex;
		align-items: center;
		gap: 12px;
		height: 40px;
		padding: 0 6px 0 12px;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
		color: var(--ui-text);
		font-size: 13px;
		white-space: nowrap;
	}
	.label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--sdv-selection);
		font-weight: 600;
	}
	.subject {
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
		font-weight: 600;
	}
	.sep {
		width: 1px;
		align-self: stretch;
		margin: 8px 0;
		background: var(--ui-border);
	}
	.seg {
		display: inline-flex;
		align-items: center;
		border: 1px solid var(--ui-border);
	}
	.seg button {
		font-size: 12px;
		line-height: 20px;
		padding: 2px 10px;
		border: none;
		border-left: 1px solid var(--ui-border);
		background: var(--ui-panel);
		cursor: pointer;
	}
	.seg button:first-of-type {
		border-left: none;
	}
	.seg button.on {
		background: var(--ui-accent-bg);
		box-shadow: inset 0 0 0 1px var(--ui-accent);
	}
	.seg-label {
		padding: 0 8px;
		border-right: 1px solid var(--ui-border);
		font-size: 12px;
		line-height: 24px;
		color: var(--ui-muted);
	}
	.leave {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 6px;
		border: none;
		background: none;
		font-size: 12px;
		color: var(--ui-muted);
		cursor: pointer;
	}
	kbd {
		font: inherit;
		font-size: 11px;
		line-height: 16px;
		padding: 0 5px;
		border: 1px solid var(--ui-border);
		background: var(--ui-bg);
		color: var(--ui-muted);
	}
</style>

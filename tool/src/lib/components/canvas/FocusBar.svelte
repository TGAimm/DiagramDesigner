<script lang="ts">
	import { Crosshair, Flag, X } from '@lucide/svelte';
	import type { Focus, FocusMode, FocusReach, FocusSides } from '#lib/landscape/focus.ts';
	import EntityGlyph, { type GlyphKind } from './EntityGlyph.svelte';

	// The controls of a focus, over the canvas's top left: what is focused, which of its
	// dependencies to show and how far, and the way out. The canvas shows the rest. A system or
	// module shows what it holds and its boundary, so it only picks the kinds shown; a flag key
	// is only depended on, so its state takes the place of the sides.
	let {
		focus,
		name,
		kind,
		flag,
		onchange,
		onleave
	}: {
		focus: Focus;
		name: string;
		/** The subject's entity kind, `field` or `flag`. */
		kind: string;
		/** A flag key the subject: whether its definitions are on (`mixed`: a split), their
		 *  default, and how to set them all. */
		flag?: { on: boolean | 'mixed'; dflt: boolean | 'split'; set: (on: boolean) => void };
		onchange: (f: Focus) => void;
		onleave: () => void;
	} = $props();

	const GLYPH: Record<string, GlyphKind | undefined> = {
		system: 'system',
		module: 'module',
		model: 'class',
		api: 'api',
		'logic-unit': 'logic',
		trigger: 'trigger',
		channel: 'channel'
	};
	const MODES: [FocusMode, string][] = [
		['all', 'Everything'],
		['data', 'Data models']
	];
	const SIDES: [FocusSides, string, string][] = [
		['usedBy', 'Used by', 'What depends on it'],
		['both', 'Both', 'What it depends on, and what depends on it'],
		['uses', 'Uses', 'What it depends on']
	];
	const REACH: [FocusReach, string, string][] = [
		['direct', 'Direct', 'One step each way'],
		['chain', 'Chain', 'On along each side until it ends']
	];
	const holder = $derived(kind === 'system' || kind === 'module');
</script>

<div class="bar" role="toolbar" aria-label="Focus" data-testid="focus-bar">
	<span class="label"><Crosshair size={14} />Focus</span>
	<span class="subject">
		{#if kind === 'flag'}<Flag size={13} class="flag" />{:else if GLYPH[kind]}<EntityGlyph
				kind={GLYPH[kind]!}
			/>{/if}{name}
	</span>
	<span class="sep"></span>
	{#if flag}
		<div class="seg" role="group" aria-label="{name} everywhere">
			{#each [false, true] as value (value)}
				<button
					class:on={flag.on === value}
					aria-pressed={flag.on === value}
					onclick={() => flag.set(value)}
					>{value ? 'On' : 'Off'}{#if flag.dflt === value}<span class="prod">production</span
						>{/if}</button
				>
			{/each}
		</div>
		{#if flag.on === 'mixed'}<span class="split">split</span>{/if}
	{:else if !holder}
		<div class="seg" role="group" aria-label="Sides">
			{#each SIDES as [sides, text, title] (sides)}
				<button
					class:on={focus.sides === sides}
					aria-pressed={focus.sides === sides}
					{title}
					onclick={() => onchange({ ...focus, sides })}>{text}</button
				>
			{/each}
		</div>
	{/if}
	{#if !holder}
		<div class="seg" role="group" aria-label="How far">
			{#each REACH as [reach, text, title] (reach)}
				<button
					class:on={focus.reach === reach}
					aria-pressed={focus.reach === reach}
					{title}
					onclick={() => onchange({ ...focus, reach })}>{text}</button
				>
			{/each}
		</div>
	{/if}
	{#if !flag}
		{#if !holder}<span class="sep"></span>{/if}
		<div class="seg" role="group" aria-label="What to show">
			{#each MODES as [mode, text] (mode)}
				<button
					class:on={focus.mode === mode}
					aria-pressed={focus.mode === mode}
					onclick={() => onchange({ ...focus, mode })}>{text}</button
				>
			{/each}
		</div>
	{/if}
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
		max-width: calc(100% - 24px);
		box-sizing: border-box;
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
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sep {
		width: 1px;
		align-self: stretch;
		margin: 8px 0;
		background: var(--ui-border);
		flex: none;
	}
	.seg {
		display: inline-flex;
		align-items: center;
		border: 1px solid var(--ui-border);
		flex: none;
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
	.prod {
		margin-left: 5px;
		font-size: 10.5px;
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
		flex: none;
	}
	.subject :global(.flag) {
		color: var(--ui-muted);
	}
	.split {
		font-size: 11px;
		font-weight: 600;
		padding: 0 6px;
		line-height: 18px;
		color: var(--sdv-sev-check);
		background: color-mix(in srgb, var(--sdv-sev-check) 16%, transparent);
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

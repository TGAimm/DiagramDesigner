<script lang="ts">
	import { ChevronDown, ChevronRight, Flag } from '@lucide/svelte';
	import { flagAsk } from '#lib/client/search.svelte.ts';
	import { changes } from '#lib/client/changes.svelte.ts';
	import { design } from '#lib/client/store.svelte.ts';
	import { familyParts } from '#lib/landscape/flag-sites.ts';
	import { flagKeys } from '#lib/model/flags.ts';

	/**
	 * Topbar: the design's feature flags, one row per key. Clicking a row focuses the canvas on
	 * the key, with its pane beside it (where each definition is set alone, which is how a split
	 * is made); its switch sets every definition. A key shows its name, the key only when it
	 * differs, the systems checking it and the first sentence of its description. Keys whose
	 * files name the same `family` are grouped under it, each row showing the part of its name
	 * the others don't share. What the state breaks is listed at the bottom.
	 */
	interface Key {
		key: string;
		defs: string[];
		name: string;
		label: string;
		systems: string;
		desc?: string;
		on: number;
		family?: string;
	}
	const firstSentence = (text: string) => text.match(/^.*?[.!?](?=\s|$)/s)?.[0] ?? text;
	const systemOf = (id: string) => {
		let e = design.model.elements.get(id);
		while (e?.parentId) e = design.model.elements.get(e.parentId);
		return e?.name ?? '';
	};
	const keys = $derived(
		[...flagKeys(design.model)]
			.map(([key, defs]): Key => {
				const els = defs.map((d) => design.model.elements.get(d)!);
				const desc = els.map((e) => e.def.meta?.description).find(Boolean);
				return {
					key,
					defs,
					name: els[0].name,
					label: els[0].name,
					systems: [...new Set(defs.map(systemOf))].join(', '),
					desc: desc && firstSentence(desc),
					on: defs.filter((d) => changes.flagState.get(d)).length,
					family: els.map((e) => e.def.family).find(Boolean)
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name))
	);
	/** Keys alone and families, in name order; a family sits where its name sorts. */
	const groups = $derived.by(() => {
		const fams: Record<string, Key[]> = {};
		for (const k of keys) if (k.family) (fams[k.family] ??= []).push(k);
		const out: ({ kind: 'key'; k: Key } | { kind: 'family'; name: string; keys: Key[] })[] = [
			...keys.filter((k) => !k.family).map((k) => ({ kind: 'key' as const, k })),
			...Object.entries(fams).map(([name, ks]) => {
				const parts = familyParts(ks.map((k) => k.name));
				return {
					kind: 'family' as const,
					name,
					keys: ks.map((k, i) => ({ ...k, label: parts[i] }))
				};
			})
		];
		return out.sort((a, b) =>
			(a.kind === 'key' ? a.k.name : a.name).localeCompare(b.kind === 'key' ? b.k.name : b.name)
		);
	});
	const moved = $derived(
		[...changes.flagState].filter(([id, on]) => on !== changes.flagDefaults.get(id)).length
	);
	const breaking = $derived(changes.findings.some((f) => f.level === 'breaking'));
	let closed = $state<Record<string, boolean>>({});
	const onOf = (n: number, of: number) => (n === 0 ? 'all off' : n === of ? 'all on' : `${n} on`);

	function open(k: Key) {
		changes.flagsOpen = false;
		flagAsk.key = k.key;
	}
</script>

{#snippet row(k: Key, inFamily: boolean)}
	{@const mixed = k.on > 0 && k.on < k.defs.length}
	<div class="row" class:fam={inFamily}>
		<button class="open" title="See what {k.name} changes" onclick={() => open(k)}>
			<span class="l1">
				<span class="nm" title={k.name}>{k.label}</span>
				{#if k.key !== k.name && !inFamily}<code>{k.key}</code>{/if}
				{#if !inFamily}<span class="sys">{k.systems}</span>{/if}
			</span>
			{#if k.desc}<span class="ds">{k.desc}</span>{/if}
		</button>
		{#if mixed}<span class="split">split</span>{/if}
		<button
			class="sw"
			class:is-on={k.on === k.defs.length}
			class:mixed
			role="switch"
			aria-checked={mixed ? 'mixed' : k.on === k.defs.length}
			aria-label="{k.name} everywhere"
			onclick={() => changes.setFlags(k.defs, k.on < k.defs.length)}
		></button>
	</div>
{/snippet}

{#if keys.length}
	<div class="wrap">
		<button
			class="pick"
			class:on={changes.flagged}
			aria-haspopup="menu"
			aria-expanded={changes.flagsOpen}
			onclick={() => (changes.flagsOpen = !changes.flagsOpen)}
			title="Feature flags"
			data-testid="flags-menu"
		>
			<Flag size={14} />Flags{#if moved}<span> · {moved}</span>{/if}{#if breaking}<span
					class="dot"
					aria-label="breaks something"
				></span>{/if}<ChevronDown size={12} />
		</button>
		{#if changes.flagsOpen}
			<div class="menu" role="menu" aria-label="Flags">
				<div class="head">
					<span class="title">Flags</span>
					<span class="count"
						>{keys.length} key{keys.length === 1 ? '' : 's'} · {moved
							? `${moved} off production`
							: 'all at production'}</span
					>
					<button disabled={!changes.flagged} onclick={() => changes.resetFlags()}
						>Reset to production</button
					>
				</div>
				<div class="list">
					{#each groups as g (g.kind === 'key' ? g.k.key : `family:${g.name}`)}
						{#if g.kind === 'key'}
							{@render row(g.k, false)}
						{:else}
							{@const shut = !!closed[g.name]}
							{@const on = g.keys.reduce((n, k) => n + k.on, 0)}
							{@const of = g.keys.reduce((n, k) => n + k.defs.length, 0)}
							<div class="family">
								<div class="fhead">
									<button
										class="chev"
										aria-label={shut ? 'Show keys' : 'Hide keys'}
										aria-expanded={!shut}
										onclick={() => (closed = { ...closed, [g.name]: !shut })}
									>
										{#if shut}<ChevronRight size={14} />{:else}<ChevronDown size={14} />{/if}
									</button>
									<span class="fname">{g.name}</span>
									<span class="fcount">{g.keys.length} keys · {onOf(on, of)}</span>
									<span class="sys">{[...new Set(g.keys.map((k) => k.systems))].join(', ')}</span>
								</div>
								{#if !shut}
									{#each g.keys as k (k.key)}{@render row(k, true)}{/each}
								{/if}
							</div>
						{/if}
					{/each}
				</div>
				{#if changes.findings.length}
					<div class="finds">
						{#each changes.findings as f, i (i)}
							<p class:k={f.level === 'breaking'} class:w={f.level === 'check'}>
								<b>{f.level}</b>
								{f.message}
							</p>
						{/each}
					</div>
				{/if}
				<div class="foot">Click a flag to see what it changes.</div>
			</div>
		{/if}
	</div>
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
	}
	.pick.on {
		background: var(--ui-accent-bg);
		border-color: var(--ui-accent);
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--sdv-sev-break);
	}
	.menu {
		position: absolute;
		left: 0;
		top: calc(100% + 4px);
		width: 520px;
		max-width: calc(100vw - 24px);
		max-height: calc(100vh - 80px);
		display: flex;
		flex-direction: column;
		z-index: 30;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		box-shadow: var(--ui-shadow);
		font-size: 13px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		border-bottom: 1px solid var(--ui-border);
	}
	.head button {
		font-size: 12px;
	}
	.title {
		font-weight: 600;
	}
	.count {
		flex: 1;
		font-size: 12px;
		color: var(--ui-muted);
	}
	.list {
		overflow-y: auto;
		min-height: 0;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding-right: 14px;
		border-bottom: 1px solid var(--ui-border);
	}
	.row:hover {
		background: color-mix(in srgb, var(--ui-accent) 7%, transparent);
	}
	.open {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 8px 0 8px 14px;
		border: none;
		background: none;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.l1 {
		display: flex;
		align-items: baseline;
		gap: 8px;
		min-width: 0;
	}
	.nm {
		font-weight: 600;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	code {
		flex: none;
		font-size: 11px;
		color: var(--ui-muted);
		white-space: nowrap;
	}
	.sys {
		margin-left: auto;
		flex: none;
		font-size: 11px;
		color: var(--ui-muted);
		white-space: nowrap;
	}
	.ds {
		font-size: 12px;
		line-height: 1.4;
		color: var(--ui-muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.family {
		border-bottom: 1px solid var(--ui-border);
	}
	.fhead {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 8px 14px 4px;
	}
	.chev {
		align-self: center;
		border: none;
		background: none;
		padding: 0;
		display: flex;
		color: var(--ui-muted);
	}
	.fname {
		font-weight: 600;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.fcount {
		flex: none;
		font-size: 12px;
		color: var(--ui-muted);
	}
	.row.fam {
		border-bottom: none;
	}
	.row.fam .open {
		flex-direction: row;
		align-items: baseline;
		gap: 10px;
		padding: 4px 0 4px 36px;
	}
	.row.fam .l1 {
		flex: none;
		min-width: 38px;
	}
	.family .row.fam:last-child .open {
		padding-bottom: 8px;
	}
	.split {
		font-size: 11px;
		font-weight: 600;
		padding: 0 6px;
		line-height: 18px;
		color: var(--sdv-sev-check);
		background: color-mix(in srgb, var(--sdv-sev-check) 16%, transparent);
	}
	.sw {
		position: relative;
		width: 30px;
		height: 18px;
		padding: 0;
		border-radius: 9px;
		flex: none;
	}
	.sw::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--ui-muted);
	}
	.sw.is-on {
		background: var(--ui-accent-bg);
		border-color: var(--ui-accent);
	}
	.sw.is-on::after {
		left: 14px;
		background: var(--ui-accent);
	}
	.sw.mixed::after {
		left: 8px;
		background: var(--sdv-sev-check);
	}
	.finds {
		padding: 8px 14px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		border-bottom: 1px solid var(--ui-border);
	}
	.finds p {
		margin: 0;
		font-size: 12px;
	}
	.finds .k b {
		color: var(--sdv-sev-break);
	}
	.finds .w b {
		color: var(--sdv-sev-check);
	}
	.foot {
		padding: 8px 14px;
		font-size: 12px;
		color: var(--ui-muted);
	}
</style>

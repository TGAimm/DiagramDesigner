<script lang="ts">
	import { Flag } from '@lucide/svelte';
	import { changes } from '#lib/client/changes.svelte.ts';
	import { flagAsk } from '#lib/client/search.svelte.ts';
	import { design } from '#lib/client/store.svelte.ts';
	import { familyParts, flagSites } from '#lib/landscape/flag-sites.ts';
	import { flagRoles } from '#lib/landscape/focus.ts';
	import { flagHome, flagKeys } from '#lib/model/flags.ts';

	/**
	 * Beside the canvas while a flag key is focused: what the key is, where it is defined (each
	 * definition set alone here, which is how a split is made), what flipping it changes at every
	 * flag step on it, what is gated on it, and the other keys of its family. The canvas shows
	 * where those are; this says what each does, including branches no line shows.
	 */
	let { flagKey }: { flagKey: string } = $props();

	const model = $derived(design.model);
	const defs = $derived(flagKeys(model).get(flagKey) ?? []);
	const first = $derived(model.elements.get(defs[0] ?? ''));
	const meta = $derived(
		defs.map((d) => model.elements.get(d)?.def.meta).find((m) => m?.description) ?? first?.def.meta
	);
	const facts = $derived(
		Object.entries(meta ?? {}).filter(([k]) => k !== 'description') as [string, string][]
	);
	const defaults = $derived(new Set(defs.map((d) => !!changes.flagDefaults.get(d))));
	const production = $derived(defaults.size > 1 ? 'split' : defaults.has(true) ? 'on' : 'off');
	const sites = $derived(flagSites(model, flagKey));
	const roles = $derived(flagRoles(model, flagKey));
	const splits = $derived(
		design.diagnostics.filter(
			(d) => d.code === 'flag-split' && d.message.startsWith(`breaks with ${flagKey} `)
		)
	);
	/** The family the key's definitions name, with every key in it, this one too. */
	const family = $derived.by(() => {
		const name = defs.map((d) => model.elements.get(d)?.def.family).find(Boolean);
		if (!name) return undefined;
		const keys = [...flagKeys(model)]
			.filter(([, ds]) => ds.some((d) => model.elements.get(d)?.def.family === name))
			.map(([k, ds]) => ({ key: k, name: model.elements.get(ds[0])?.name ?? k }))
			.sort((a, b) => a.name.localeCompare(b.name));
		const parts = familyParts(keys.map((k) => k.name));
		return { name, keys: keys.map((k, i) => ({ ...k, part: parts[i] })) };
	});
	const name = (id: string) => model.elements.get(id)?.name ?? id;
	const ownerOf = (id: string) => name(model.elements.get(id)?.parentId ?? '');
	const isOn = (id: string) => !!changes.flagState.get(id);
</script>

<aside class="pane" aria-label="Flag {first?.name ?? flagKey}" data-testid="flag-pane">
	<header>
		<div class="title"><Flag size={14} />{first?.name ?? flagKey}</div>
		<div class="sub">
			Flag{#if first?.name !== flagKey}
				· <code>{flagKey}</code>{/if} · {defs.length === 1
				? flagHome(model, defs[0])
				: `${defs.length} definitions`}
		</div>
	</header>
	<div class="body">
		{#if meta?.description}<p class="desc">{meta.description}</p>{/if}
		<dl class="facts">
			<dt>Production</dt>
			<dd>{production}</dd>
			{#each facts as [k, v] (k)}
				<dt>{k[0].toUpperCase() + k.slice(1)}</dt>
				<dd>{v}</dd>
			{/each}
		</dl>

		<section>
			<h3>
				Defined in{#if defs.length === 1}<span>one definition, so it can't be split</span>{/if}
			</h3>
			{#each defs as id (id)}
				<div class="def">
					<span class="home">{flagHome(model, id)}</span>
					<span class="dflt">default {changes.flagDefaults.get(id) ? 'on' : 'off'}</span>
					<div class="seg" role="group" aria-label="{name(id)} in {flagHome(model, id)}">
						<button aria-pressed={!isOn(id)} onclick={() => changes.setFlags([id], false)}
							>Off</button
						><button aria-pressed={isOn(id)} onclick={() => changes.setFlags([id], true)}>On</button
						>
					</div>
				</div>
			{/each}
			{#each splits as d (d.message)}
				<p class="split">{d.message}</p>
			{/each}
		</section>

		<section>
			<h3>
				What flipping it changes<span>{sites.length} flag step{sites.length === 1 ? '' : 's'}</span>
			</h3>
			{#each sites as s, i (i)}
				{@const on = isOn(s.flag)}
				<div class="site">
					<div class="unit">
						<i class="fn">ƒ</i><b>{name(s.unit)}</b><span class="where">{ownerOf(s.unit)}</span>
					</div>
					{#each s.context as c, j (j)}<div class="ctx">{c}</div>{/each}
					{#each [false, true] as branch (branch)}
						{@const lines = branch ? s.on : s.off}
						<div class="br" class:other={branch !== on}>
							<span class="bt" class:on-tag={branch}>{branch ? 'on' : 'off'}</span>
							<span class="what">
								{#if lines.length}
									{#each lines as l, k (k)}<span class="line">{l}</span>{/each}
								{:else}<span class="line none">nothing</span>{/if}
							</span>
						</div>
					{/each}
				</div>
			{:else}
				<p class="none">No flag step checks it.</p>
			{/each}
		</section>

		<section>
			<h3>Gated on it</h3>
			{#each [...roles.gated] as id (id)}
				{@const g = model.elements.get(id)}
				<div class="gated">
					<span
						>{g?.def.kind === 'api'
							? `${g.def.method ?? ''} ${g.def.path ?? g.name}`
							: name(id)}</span
					>
					<span class="where">only when {g?.def.when?.is ?? 'on'}</span>
				</div>
			{:else}
				<p class="none">Nothing.</p>
			{/each}
		</section>

		{#if family}
			<section>
				<h3>Family<span>declared in the flag files</span></h3>
				<div class="chips">
					<span class="fam">{family.name}</span>
					{#each family.keys as k (k.key)}
						{#if k.key === flagKey}
							<span class="chip here" title={k.name}>{k.part}</span>
						{:else}
							<button class="chip" title="Focus on {k.name}" onclick={() => (flagAsk.key = k.key)}
								>{k.part}</button
							>
						{/if}
					{/each}
				</div>
			</section>
		{/if}
	</div>
</aside>

<style>
	.pane {
		width: 380px;
		flex: none;
		display: flex;
		flex-direction: column;
		min-height: 0;
		box-sizing: border-box;
		background: var(--ui-panel);
		border-left: 1px solid var(--ui-border);
		color: var(--ui-text);
		font-size: 13px;
	}
	header {
		padding: 12px 16px 10px;
		border-bottom: 1px solid var(--ui-border);
	}
	.title {
		display: flex;
		align-items: center;
		gap: 0.45em;
		font-size: 15px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.title :global(svg) {
		color: var(--ui-muted);
		flex: none;
	}
	.sub {
		margin-top: 2px;
		font-size: 12px;
		color: var(--ui-muted);
		overflow-wrap: anywhere;
	}
	code {
		font-size: 11.5px;
	}
	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px 16px 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.desc {
		margin: 0;
		line-height: 1.5;
	}
	.facts {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 3px 12px;
		margin: 0;
		font-size: 12px;
	}
	.facts dt {
		color: var(--ui-muted);
	}
	.facts dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	h3 {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin: 0 0 6px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--ui-muted);
	}
	h3 span {
		text-transform: none;
		letter-spacing: 0;
		font-weight: 400;
	}
	.def {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 3px 0;
	}
	.home {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.dflt {
		font-size: 11px;
		color: var(--ui-muted);
		white-space: nowrap;
	}
	.seg {
		display: inline-flex;
		flex: none;
	}
	.seg button {
		font-size: 12px;
		padding: 1px 9px;
		color: var(--ui-muted);
		margin-left: -1px;
	}
	.seg button[aria-pressed='true'] {
		color: var(--ui-text);
		font-weight: 600;
		background: var(--ui-accent-bg);
	}
	.split {
		margin: 6px 0 0;
		font-size: 12px;
		color: var(--sdv-sev-break);
		overflow-wrap: anywhere;
	}
	.site {
		padding: 7px 0;
		border-top: 1px solid var(--ui-border);
	}
	.site:first-of-type {
		border-top: none;
		padding-top: 0;
	}
	.unit {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 6px;
		min-width: 0;
	}
	.unit b {
		font-size: 12.5px;
		min-width: 0;
		overflow-wrap: break-word;
	}
	.unit .where {
		overflow-wrap: normal;
	}
	.fn {
		font-family: Georgia, serif;
		color: var(--sdv-kind-logic-icon);
	}
	.where {
		font-size: 11.5px;
		color: var(--ui-muted);
		overflow-wrap: anywhere;
	}
	.ctx {
		padding-left: 18px;
		font-size: 11.5px;
		color: var(--ui-muted);
		overflow-wrap: anywhere;
	}
	.br {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 3px 0 0 18px;
		font-size: 12px;
		line-height: 1.4;
	}
	.br.other {
		color: var(--ui-muted);
	}
	.bt {
		flex: none;
		width: 26px;
		text-align: center;
		font-size: 10.5px;
		font-weight: 700;
		line-height: 16px;
		background: color-mix(in srgb, var(--ui-muted) 22%, transparent);
	}
	.bt.on-tag {
		background: none;
		border: 1px dashed var(--ui-muted);
		line-height: 14px;
	}
	.what {
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.line {
		overflow-wrap: anywhere;
	}
	.none {
		margin: 0;
		color: var(--ui-muted);
		font-size: 12px;
	}
	.gated {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 2px 0;
		overflow-wrap: anywhere;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.fam {
		font-size: 12px;
		color: var(--ui-muted);
		overflow-wrap: anywhere;
	}
	.chip {
		font-size: 12px;
		padding: 1px 8px;
	}
	.chip.here {
		border: 1px solid var(--ui-accent);
		background: var(--ui-accent-bg);
	}
</style>

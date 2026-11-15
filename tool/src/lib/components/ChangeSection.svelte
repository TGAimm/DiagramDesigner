<script lang="ts">
	import { changes } from '#lib/client/changes.svelte.ts';
	import { show } from '#lib/scenario/apply.ts';
	import type { Impact, Mention } from '#lib/scenario/impact.ts';
	import { impactLabel, itemLabel } from '#lib/scenario/labels.ts';

	/**
	 * What a scenario or commit does to one item, at the top of its inspector: the change
	 * itself, then what it breaks, stops at and mentions; or, for an item it only reaches, what
	 * reaches it. Counts stay on the canvas; this lists.
	 */
	let { id, go }: { id: string; go: (id: string) => void } = $props();

	const c = $derived(changes.comparison);
	const entry = $derived(c?.diff.byId.get(id));
	const mine = $derived(c?.report.impacts.filter((i) => i.cause === id) ?? []);
	const reaching = $derived(
		entry ? [] : (c?.report.impacts.filter((i) => i.id === id && i.level !== 'stopped') ?? [])
	);
	const mentions = $derived(c?.report.mentions.filter((m) => m.cause === id) ?? []);
	let ignored = $state<Record<string, true>>({});
	const key = (m: Mention) => `${m.entity}|${m.path.join('.')}`;

	const modelOf = (i: Impact) => (c && c.before.elements.has(i.element) ? c.before : c?.after);
	const label = (i: Impact) => {
		const m = modelOf(i);
		return m ? impactLabel(m, i) : i.id;
	};
	const named = (target: string) => {
		if (!c) return target;
		return c.after.ids.has(target) || c.after.elements.has(target)
			? itemLabel(c.after, target)
			: itemLabel(c.before, target);
	};
	const sections = $derived(
		[
			{
				title: 'Breaks',
				cls: 'brk',
				items: mine.filter((i) => i.depth === 1 && i.level === 'breaking')
			},
			{
				title: 'To check',
				cls: 'chk',
				items: mine.filter((i) => i.depth === 1 && i.level === 'check')
			},
			{ title: 'Affected through those', cls: 'brk', items: mine.filter((i) => i.depth === 2) },
			{ title: 'Stopped', cls: 'stop', items: mine.filter((i) => i.level === 'stopped') },
			{
				title: 'Information',
				cls: 'ok',
				items: mine.filter((i) => i.depth === 1 && i.level === 'info')
			}
		].filter((s) => s.items.length)
	);
	const flags = (i: Impact) =>
		[
			i.data === 'loss' && 'data loss',
			i.data === 'backfill' && 'backfill',
			i.external && 'plus unmodelled consumers'
		]
			.filter(Boolean)
			.join(' · ');
	const owner = (o: string | undefined) => (o ? named(o.split(':')[0]) : '');

	function rewrite(m: Mention) {
		void changes.append({ set: m.entity, path: m.path, was: m.text, to: m.to });
	}
</script>

{#if c && (entry || reaching.length)}
	{#if entry}
		<section class="change">
			<h4>Change</h4>
			{#if entry.change === 'added'}
				<p class="row">Added</p>
			{:else if entry.change === 'dropped'}
				<p class="row">Dropped</p>
			{:else}
				<div class="ba">
					{#if entry.renamedFrom}
						<span class="k">name</span><s>{entry.renamedFrom}</s><span class="ar">→</span><span
							>{entry.name}</span
						>
					{/if}
					{#if entry.movedFrom}
						<span class="k">in</span><s>{owner(entry.movedFrom)}</s><span class="ar">→</span><span
							>{owner(
								c.after.fields.get(id)?.modelId ??
									c.after.apiFields.get(id)?.apiId ??
									c.after.elements.get(id)?.parentId
							)}</span
						>
					{/if}
					{#each entry.keys as k (k.key)}
						<span class="k">{k.key}</span><s>{show(k.before)}</s><span class="ar">→</span><span
							>{show(k.after)}</span
						>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
	{#each sections as s (s.title)}
		<section>
			<h4>{s.title}</h4>
			{#each s.items as i, n (n)}
				<button class="entry {s.cls}" onclick={() => go(i.id)}>
					<span class="text">{label(i)}</span>
					<span class="where">{i.reason}{flags(i) ? ` · ${flags(i)}` : ''}</span>
				</button>
			{/each}
		</section>
	{/each}
	{#if mentions.some((m) => !ignored[key(m)])}
		<section>
			<h4>Mentions the old name</h4>
			{#each mentions.filter((m) => !ignored[key(m)]) as m (key(m))}
				<div class="mention">
					<span class="text">{named(m.entity)} · <q>{m.text}</q></span>
					{#if m.to && changes.editable}
						<button class="sbtn" onclick={() => rewrite(m)} title="Rewrite to “{m.to}”"
							>Rewrite</button
						>
					{/if}
					<button class="sbtn" onclick={() => (ignored = { ...ignored, [key(m)]: true })}
						>Ignore</button
					>
				</div>
			{/each}
		</section>
	{/if}
	{#if reaching.length}
		<section>
			<h4>Affected by</h4>
			{#each reaching as i, n (n)}
				<button
					class="entry {i.level === 'breaking' ? 'brk' : i.level === 'check' ? 'chk' : 'ok'}"
					onclick={() => go(i.cause)}
				>
					<span class="text">{named(i.cause)}</span>
					<span class="where">{i.reason}{flags(i) ? ` · ${flags(i)}` : ''}</span>
				</button>
			{/each}
		</section>
	{/if}
{/if}

<style>
	section {
		padding: 6px 0;
		border-top: 1px solid var(--sdv-model-stroke);
	}
	h4 {
		margin: 2px 12px 4px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--sdv-text-muted);
	}
	.row {
		margin: 0 12px 2px;
	}
	.ba {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto minmax(0, 1fr);
		gap: 2px 8px;
		margin: 0 12px 2px;
		align-items: baseline;
	}
	.ba .k,
	.ba .ar,
	.ba s {
		color: var(--sdv-text-muted);
		font-size: 12px;
	}
	.ba s,
	.ba span {
		overflow-wrap: anywhere;
	}
	.entry {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		width: 100%;
		padding: 3px 12px 3px 9px;
		border: none;
		border-left: 3px solid transparent;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.entry:hover {
		background: var(--sdv-row-hover);
	}
	.entry.brk {
		border-left-color: var(--sdv-sev-break);
	}
	.entry.chk {
		border-left-color: var(--sdv-sev-check);
	}
	.entry.stop {
		border-left-color: var(--sdv-link-from);
	}
	.entry.ok {
		border-left-color: var(--sdv-edge);
	}
	.text {
		font-weight: 500;
	}
	.where {
		color: var(--sdv-text-muted);
		font-size: 12px;
	}
	.mention {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 12px 3px 9px;
		border-left: 3px solid var(--sdv-sev-check);
	}
	.mention .text {
		flex: 1;
		min-width: 0;
		font-weight: 400;
	}
	q {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 12px;
	}
	.sbtn {
		font: inherit;
		font-size: 12px;
		color: inherit;
		background: var(--sdv-model-fill);
		border: 1px solid var(--sdv-model-stroke);
		padding: 1px 7px;
		cursor: pointer;
	}
</style>

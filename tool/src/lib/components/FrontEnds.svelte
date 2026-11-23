<script lang="ts">
	import { endsOf, type Front, type FrontLevel } from '#lib/scenario/front.ts';

	/**
	 * Where a focused change ends: what it breaks, what to check, and where it stops, each item
	 * once under its worst level with its reason. A click goes to the item.
	 */
	let { front, go }: { front: Front; go: (id: string) => void } = $props();

	const GROUPS: [FrontLevel, string][] = [
		['breaking', 'Breaks'],
		['check', 'To check'],
		['stopped', 'Stops at']
	];
	const ends = $derived(endsOf(front));
</script>

<section class="ends" data-testid="front-ends">
	<h3>Where it ends</h3>
	{#each GROUPS as [level, title] (level)}
		{@const items = ends.filter((o) => o.level === level)}
		{#if items.length}
			<p class="group {level}">{title}</p>
			{#each items as o, i (i)}
				<button class="end" onclick={() => go(o.id)}>
					<span class="what">{o.label}</span>
					<span class="why">{o.reason}</span>
				</button>
			{/each}
		{/if}
	{/each}
	{#if !ends.length}<p class="none">It doesn't reach past what it changes.</p>{/if}
</section>

<style>
	h3 {
		margin: 0 0 6px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--ui-muted);
	}
	.group {
		margin: 8px 0 2px;
		font-size: 11.5px;
		font-weight: 600;
	}
	.group.breaking {
		color: var(--sdv-sev-break);
	}
	.group.check {
		color: var(--sdv-sev-check);
	}
	.group.stopped {
		color: var(--ui-muted);
	}
	.end {
		display: flex;
		flex-direction: column;
		width: 100%;
		padding: 4px 6px;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.end:hover {
		background: var(--ui-hover);
	}
	.what {
		font-size: 12.5px;
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	.why {
		font-size: 11.5px;
		color: var(--ui-muted);
		overflow-wrap: anywhere;
	}
	.none {
		margin: 0;
		font-size: 12px;
		color: var(--ui-muted);
	}
</style>

<script lang="ts" module>
	/** What a glyph stands for: entity kinds, a model's views, and the events a trigger listens to. */
	export type GlyphKind =
		| 'system'
		| 'module'
		| 'class'
		| 'table'
		| 'file'
		| 'logic'
		| 'api'
		| 'triggers'
		| 'trigger'
		| 'user'
		| 'framework'
		| 'outside'
		| 'message'
		| 'channel'
		| 'topic'
		| 'received'
		| 'dead-lettered'
		| 'created'
		| 'updated'
		| 'deleted';
</script>

<script lang="ts">
	import { GLYPHS } from '../../render/glyphs';

	// One small mark per entity type, beside its name (never alone): Lucide's app-window, box,
	// braces, table, file, square-function, plug, zap (a triggers card), clock (a schedule), mail
	// (an old message trigger), a pipe (a queue), broadcast (a topic), and the events: inbox,
	// ban, plus, pencil, trash. The canvas draws the same paths (render/glyphs.ts). Sized in em, so it
	// follows the name's font. A card kind's mark wears that kind's colour; the rest the name's,
	// at reduced opacity. `tone` colours an event as the card it sits on.
	let { kind, tone }: { kind: GlyphKind; tone?: 'channel' | 'trigger' } = $props();
	const EVENTS = ['received', 'dead-lettered', 'created', 'updated', 'deleted'];
	const toneOf = $derived(
		tone ??
			(kind === 'channel' || kind === 'topic'
				? 'channel'
				: EVENTS.includes(kind) || kind === 'message'
					? 'trigger'
					: undefined)
	);
</script>

<svg class="glyph {kind} {toneOf ?? ''}" viewBox="0 0 24 24" aria-hidden="true">
	{#each GLYPHS[kind] ?? GLYPHS.api as d (d)}<path {d} />{/each}
</svg>

<style>
	.glyph {
		width: 0.85em;
		height: 0.85em;
		flex: none;
		fill: none;
		stroke: currentColor;
		/* In viewBox units, so the stroke scales with the name like a font's weight. */
		stroke-width: 2.2;
		stroke-linejoin: round;
		stroke-linecap: round;
		opacity: var(--glyph-opacity, 0.75);
	}
	.class {
		color: var(--sdv-kind-class-icon);
	}
	.table,
	.file {
		color: var(--sdv-kind-table-icon);
	}
	.logic {
		color: var(--sdv-kind-logic-icon);
	}
	.triggers,
	.trigger {
		color: var(--sdv-kind-trigger-icon);
	}
	.channel {
		color: var(--sdv-kind-channel-icon);
	}
	.class,
	.table,
	.file,
	.logic,
	.triggers,
	.trigger,
	.channel {
		opacity: calc(var(--glyph-opacity, 0.75) / 0.75);
	}
</style>

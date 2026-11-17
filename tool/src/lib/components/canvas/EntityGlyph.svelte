<script lang="ts" module>
	/** What a glyph stands for: entity kinds, plus a model's two views. */
	export type GlyphKind =
		'system' | 'module' | 'class' | 'table' | 'logic' | 'api' | 'triggers' | 'trigger' | 'message';
</script>

<script lang="ts">
	// One small mark per entity type, beside its name (never alone): Lucide's app-window, box,
	// braces, table, square-function, plug, zap (a triggers card), clock (a schedule) and mail (a message). Sized
	// in em, so it follows the name's font. A card kind's mark wears that kind's colour; the rest
	// the name's, at reduced opacity.
	let { kind }: { kind: GlyphKind } = $props();
</script>

<svg class="glyph {kind}" viewBox="0 0 24 24" aria-hidden="true">
	{#if kind === 'system'}
		<rect x="2" y="4" width="20" height="16" rx="2" /><path d="M10 4v4" /><path d="M2 8h20" /><path
			d="M6 4v4"
		/>
	{:else if kind === 'module'}
		<path
			d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"
		/><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" />
	{:else if kind === 'class'}
		<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" /><path
			d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"
		/>
	{:else if kind === 'table'}
		<path
			d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"
		/>
	{:else if kind === 'logic'}
		<rect width="18" height="18" x="3" y="3" rx="2" /><path
			d="M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3"
		/><path d="M9 11.2h5.7" />
	{:else if kind === 'triggers'}
		<path
			d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"
		/>
	{:else if kind === 'trigger'}
		<circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
	{:else}
		<path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path
			d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"
		/>
	{/if}
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
	.table {
		color: var(--sdv-kind-table-icon);
	}
	.logic {
		color: var(--sdv-kind-logic-icon);
	}
	.triggers,
	.trigger {
		color: var(--sdv-kind-trigger-icon);
	}
	.class,
	.table,
	.logic,
	.triggers,
	.trigger {
		opacity: calc(var(--glyph-opacity, 0.75) / 0.75);
	}
</style>

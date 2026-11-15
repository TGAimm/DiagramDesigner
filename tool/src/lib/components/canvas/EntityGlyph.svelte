<script lang="ts" module>
	/** What a glyph stands for: entity kinds, plus a model's two views. */
	export type GlyphKind = 'system' | 'module' | 'class' | 'table' | 'logic' | 'api';
</script>

<script lang="ts">
	// One small mark per entity type, beside its name (never alone). Sized in em, so it
	// follows the name's font; drawn in its colour at reduced opacity.
	let { kind }: { kind: GlyphKind } = $props();
</script>

{#if kind === 'logic'}
	<i class="glyph fn" aria-hidden="true">ƒ</i>
{:else}
	<svg class="glyph" viewBox="0 0 12 12" aria-hidden="true">
		{#if kind === 'system'}
			<rect x="1.5" y="2" width="9" height="8" rx="1" /><path d="M1.5 4.6h9" />
		{:else if kind === 'module'}
			<path d="M6 1.2 10.5 3.6v4.8L6 10.8 1.5 8.4V3.6Z" /><path d="M1.5 3.6 6 6l4.5-2.4M6 6v4.8" />
		{:else if kind === 'class'}
			<path d="M4.6 1.5H4a1.2 1.2 0 0 0-1.2 1.2v2L1.6 6l1.2 1.3v2A1.2 1.2 0 0 0 4 10.5h.6" />
			<path d="M7.4 1.5H8a1.2 1.2 0 0 1 1.2 1.2v2L10.4 6 9.2 7.3v2A1.2 1.2 0 0 1 8 10.5h-.6" />
		{:else if kind === 'table'}
			<ellipse cx="6" cy="3" rx="4.5" ry="1.6" />
			<path d="M1.5 3v6c0 .9 2 1.6 4.5 1.6s4.5-.7 4.5-1.6V3" />
		{:else}
			<circle cx="7.9" cy="6" r="2.6" /><path d="M1.2 6h4.1" />
		{/if}
	</svg>
{/if}

<style>
	.glyph {
		width: 0.85em;
		height: 0.85em;
		flex: none;
		fill: none;
		stroke: currentColor;
		/* In viewBox units, so the stroke scales with the name like a font's weight. */
		stroke-width: 1.3;
		stroke-linejoin: round;
		stroke-linecap: round;
		opacity: var(--glyph-opacity, 0.75);
	}
	.fn {
		width: auto;
		height: auto;
		font-family: Georgia, serif;
		font-weight: 400;
		line-height: 1;
	}
</style>

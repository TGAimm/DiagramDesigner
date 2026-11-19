<script lang="ts">
	import { identParts } from '#lib/render/text.ts';

	// An identifier that wraps, if it must, only where identParts allows.
	let { text }: { text: string } = $props();
	const parts = $derived(identParts(text));
</script>

{#each parts as p, i (i)}{#if i}<wbr />{/if}{p}{/each}

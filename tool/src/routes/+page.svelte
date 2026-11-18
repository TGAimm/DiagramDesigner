<script lang="ts">
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import { settings } from '#lib/client/settings.svelte.ts';
	import { ViewState } from '#lib/client/view-state.svelte.ts';
	import GlCanvas from '#lib/components/canvas/GlCanvas.svelte';
	import LandscapeCanvas from '#lib/components/canvas/LandscapeCanvas.svelte';

	const view = new ViewState();
</script>

<div class="landscape">
	<div class="workspace">
		{#if settings.renderer === 'webgl'}
			<GlCanvas {view} />
		{:else}
			<SvelteFlowProvider>
				<LandscapeCanvas {view} />
			</SvelteFlowProvider>
		{/if}
	</div>
</div>

<style>
	.landscape {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.workspace {
		flex: 1;
		min-height: 0;
		display: flex;
	}
</style>

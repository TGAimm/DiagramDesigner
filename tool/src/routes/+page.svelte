<script lang="ts">
	import { ViewState } from '#lib/client/view-state.svelte.ts';
	import FlagPane from '#lib/components/FlagPane.svelte';
	import LandscapeCanvas from '#lib/components/canvas/LandscapeCanvas.svelte';

	const view = new ViewState();
</script>

<div class="landscape">
	<div class="workspace">
		<LandscapeCanvas {view} />
		<!-- Beside the canvas, not over it, so a focus fits what is left. -->
		{#if view.focused?.flag && !view.play}
			<FlagPane flagKey={view.focused.id} />
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

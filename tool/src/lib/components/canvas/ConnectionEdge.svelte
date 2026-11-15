<script lang="ts">
	import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/svelte';

	/** A right-angled line; `data.title` shows on hover (how many connections a line merges). */
	let {
		id,
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		markerStart,
		markerEnd,
		interactionWidth,
		data
	}: EdgeProps = $props();

	const [path] = $derived(
		getSmoothStepPath({
			sourceX,
			sourceY,
			targetX,
			targetY,
			sourcePosition,
			targetPosition,
			borderRadius: 0
		})
	);
</script>

<BaseEdge {id} {path} {markerStart} {markerEnd} {interactionWidth} />
{#if data?.title}<title>{data.title}</title>{/if}

<script lang="ts">
	import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/svelte';
	import { routePath, type Point } from '#lib/landscape/route.ts';

	/**
	 * A right-angled line through `data.points` as routed round the boxes, or straight between
	 * its handles if routing failed; `data.title` shows on hover (how many connections a line
	 * merges); with `data.halo` it runs over a halo in the canvas colour.
	 */
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

	const points = $derived(data?.points as Point[] | undefined);
	const [path] = $derived(
		points?.length
			? [routePath(points)]
			: getSmoothStepPath({
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

{#if data?.halo}<path class="halo" d={path} />{/if}
<BaseEdge {id} {path} {markerStart} {markerEnd} {interactionWidth} />
{#if data?.title}<title>{data.title}</title>{/if}

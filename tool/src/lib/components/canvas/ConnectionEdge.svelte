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

	/** A head's tip, and its angle in degrees pointing out of the line. */
	const tip = $derived.by(() => {
		const atStart = data?.head === 'diamond';
		if (!points?.length) {
			return atStart
				? { x: sourceX, y: sourceY, a: sourcePosition === 'right' ? 180 : 0 }
				: { x: targetX, y: targetY, a: targetPosition === 'left' ? 0 : 180 };
		}
		const pts = atStart ? [...points].reverse() : points;
		const end = pts[pts.length - 1];
		const from = pts.findLast((p) => p.x !== end.x || p.y !== end.y) ?? end;
		return { ...end, a: (Math.atan2(end.y - from.y, end.x - from.x) * 180) / Math.PI };
	});
</script>

{#if data?.halo}<path class="halo" d={path} />{/if}
<BaseEdge {id} {path} {interactionWidth} />
{#if data?.head}
	<g transform="translate({tip.x} {tip.y}) rotate({tip.a})">
		<!-- 10px on screen at any zoom, like the lines. -->
		<path
			class="head"
			fill={data.color as string}
			d={data.head === 'diamond' ? 'M0 0 L-8 -5 L-16 0 L-8 5 Z' : 'M-10 -4 L0 0 L-10 4 Z'}
		/>
	</g>
{/if}
{#if data?.title}<title>{data.title}</title>{/if}

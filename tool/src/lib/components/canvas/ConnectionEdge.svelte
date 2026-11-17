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

	/**
	 * The routed line's length, and that of its segment at the head, for the dash that stops it
	 * under its head (see LandscapeCanvas).
	 */
	const len = $derived(
		points?.reduce(
			(n, p, i) => (i ? n + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) : 0),
			0
		)
	);
	const stub = $derived.by(() => {
		if (!points || points.length < 2) return 0;
		const [a, b] =
			data?.head === 'diamond' ? [points[0], points[1]] : [points.at(-1)!, points.at(-2)!];
		return Math.hypot(a.x - b.x, a.y - b.y);
	});

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

{#if data?.halo}<path class="halo screen-sized" d={path} />{/if}
<BaseEdge
	{id}
	{path}
	{interactionWidth}
	class="screen-sized"
	style={len ? `--len: ${len}px; --stub: ${stub}px` : undefined}
/>
{#if data?.head}
	<g transform="translate({tip.x} {tip.y}) rotate({tip.a})">
		<!-- 10px on screen at any zoom, like the lines. -->
		<path
			class="head screen-sized"
			fill={data.color as string}
			d={data.head === 'diamond' ? 'M0 0 L-8 -5 L-16 0 L-8 5 Z' : 'M-10 -4 L0 0 L-10 4 Z'}
		/>
	</g>
{/if}
{#if data?.title}<title>{data.title}</title>{/if}

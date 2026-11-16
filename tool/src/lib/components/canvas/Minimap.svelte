<script lang="ts" module>
	/** A box drawn on the minimap, in canvas coordinates; a system has its name. */
	export interface MapBox {
		id: string;
		x: number;
		y: number;
		width: number;
		height: number;
		name?: string;
	}
</script>

<script lang="ts">
	import { useSvelteFlow, useViewport } from '@xyflow/svelte';

	/**
	 * The whole landscape at one scale, the view as an outlined frame. Click to centre the view
	 * there, drag to pan, wheel to zoom the canvas.
	 */
	let {
		boxes,
		cw,
		ch,
		minZoom,
		maxZoom
	}: { boxes: MapBox[]; cw: number; ch: number; minZoom: number; maxZoom: number } = $props();

	const MAX_W = 600;
	const MAX_H = 450;
	const HEAD = 16.5;

	const flow = useSvelteFlow();
	const viewport = useViewport();

	const bounds = $derived.by(() => {
		let x0 = Infinity,
			y0 = Infinity,
			x1 = -Infinity,
			y1 = -Infinity;
		for (const b of boxes) {
			x0 = Math.min(x0, b.x);
			y0 = Math.min(y0, b.y);
			x1 = Math.max(x1, b.x + b.width);
			y1 = Math.max(y1, b.y + b.height);
		}
		return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
	});
	const s = $derived(Math.min(MAX_W / bounds.w, MAX_H / bounds.h));
	const systems = $derived(boxes.filter((b) => b.name !== undefined));
	const modules = $derived(boxes.filter((b) => b.name === undefined));
	const mx = (b: MapBox) => (b.x - bounds.x) * s;
	const my = (b: MapBox) => (b.y - bounds.y) * s;
	const w = $derived(bounds.w * s);
	const h = $derived(bounds.h * s);
	const view = $derived.by(() => {
		const { x, y, zoom } = viewport.current;
		return {
			x: (-x / zoom - bounds.x) * s,
			y: (-y / zoom - bounds.y) * s,
			w: (cw / zoom) * s,
			h: (ch / zoom) * s
		};
	});

	/** Where the frame's centre is held from the pointer while dragging. */
	let grab: { dx: number; dy: number } | null = null;

	function centre(mx: number, my: number, duration = 0) {
		flow.setCenter(mx / s + bounds.x, my / s + bounds.y, {
			zoom: viewport.current.zoom,
			duration
		});
	}

	/** The pointer on the map; the target may be a box inside it. */
	function at(e: PointerEvent) {
		const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
		return [e.clientX - r.left, e.clientY - r.top];
	}

	function down(e: PointerEvent) {
		if (e.button !== 0) return;
		(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
		const [mx, my] = at(e);
		const v = view;
		const inside = mx >= v.x && mx <= v.x + v.w && my >= v.y && my <= v.y + v.h;
		grab = inside ? { dx: mx - (v.x + v.w / 2), dy: my - (v.y + v.h / 2) } : { dx: 0, dy: 0 };
		if (!inside) centre(mx, my, 200);
	}

	function move(e: PointerEvent) {
		if (!grab) return;
		const [mx, my] = at(e);
		centre(mx - grab.dx, my - grab.dy);
	}

	// Not passive, so the page doesn't scroll and the canvas under the map doesn't zoom too.
	function wheel(svg: SVGSVGElement) {
		const on = (e: WheelEvent) => {
			e.preventDefault();
			const { x, y, zoom } = viewport.current;
			const next = Math.min(maxZoom, Math.max(minZoom, zoom * 2 ** (-e.deltaY * 0.002)));
			flow.setCenter((cw / 2 - x) / zoom, (ch / 2 - y) / zoom, { zoom: next });
		};
		svg.addEventListener('wheel', on, { passive: false });
		return () => svg.removeEventListener('wheel', on);
	}
</script>

{#if boxes.length}
	<div class="minimap" data-testid="minimap">
		<svg
			width={w}
			height={h}
			role="img"
			aria-label="Minimap of the landscape"
			onpointerdown={down}
			onpointermove={move}
			onpointerup={() => (grab = null)}
			onpointercancel={() => (grab = null)}
			{@attach wheel}
		>
			<title>Click to go there; drag the frame to pan</title>
			<!-- In layers, so no box covers a name: system frames, then modules, then name tabs. -->
			{#each systems as b (b.id)}
				<rect class="sys" x={mx(b)} y={my(b)} width={b.width * s} height={b.height * s} />
			{/each}
			{#each modules as b (b.id)}
				<rect class="mod" x={mx(b)} y={my(b)} width={b.width * s} height={b.height * s} />
			{/each}
			{#each systems as b (b.id)}
				<!-- A nested svg clips the name tab to its system. -->
				<svg x={mx(b)} y={my(b)} width={b.width * s} height={Math.min(HEAD, b.height * s)}>
					<rect class="head" width={b.name!.length * 8.4 + 10.5} height={HEAD} />
					<text x="4.5" y="12.75">{b.name}</text>
				</svg>
			{/each}
			<path
				class="dim"
				fill-rule="evenodd"
				d="M0 0H{w}V{h}H0Z M{view.x} {view.y}h{view.w}v{view.h}h{-view.w}Z"
			/>
			<rect class="frame" x={view.x} y={view.y} width={view.w} height={view.h} />
		</svg>
	</div>
{/if}

<style>
	.minimap {
		position: absolute;
		right: 15px;
		bottom: 15px;
		z-index: 5;
		padding: 6px;
		line-height: 0;
		background: var(--ui-panel);
		box-shadow: 0 0 2px 1px rgba(0, 0, 0, 0.08);
	}
	svg {
		overflow: hidden;
		cursor: pointer;
		touch-action: none;
		user-select: none;
	}
	.sys {
		fill: color-mix(in srgb, var(--sdv-system-fill) 7%, var(--sdv-canvas-bg));
		stroke: color-mix(in srgb, var(--sdv-system-fill) 55%, transparent);
		stroke-width: 1;
	}
	.mod {
		fill: var(--sdv-container-fill);
		stroke: var(--sdv-container-stroke);
		stroke-width: 0.75;
	}
	.head {
		fill: var(--sdv-system-fill);
	}
	text {
		fill: var(--sdv-system-text);
		font-size: 13.5px;
		font-weight: 600;
	}
	.dim {
		fill: var(--sdv-canvas-bg);
		opacity: 0.6;
		pointer-events: none;
	}
	.frame {
		fill: none;
		stroke: var(--sdv-selection);
		stroke-width: 1.5;
		pointer-events: none;
	}
</style>

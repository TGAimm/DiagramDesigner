<script lang="ts">
	import type { Application, BitmapText, Container, Graphics } from 'pixi.js';
	import { untrack } from 'svelte';
	import { changes } from '#lib/client/changes.svelte.ts';
	import { settings } from '#lib/client/settings.svelte.ts';
	import { theme } from '#lib/client/theme.svelte.ts';
	import type { ViewState } from '#lib/client/view-state.svelte.ts';
	import { RAIL, railRowY, type Rail } from '#lib/landscape/apis.ts';
	import { apiOf, edgesOf, restLines, type LinkKind } from '#lib/landscape/connections.ts';
	import {
		cardRows,
		fieldRowY,
		foldable,
		FOLD,
		HEADER,
		layoutLandscape,
		logicRowY,
		shownRows,
		TABLE,
		typeText,
		refLabel,
		type LandscapeBox
	} from '#lib/landscape/layout.ts';
	import { LEGIBLE, MARGIN, NAME_MIN } from '#lib/landscape/open.ts';
	import { RouteClient, type RoutePort } from '#lib/landscape/route-client.ts';
	import { routeStore } from '#lib/landscape/route-store.ts';
	import RouteWorker from '#lib/landscape/route-worker.ts?worker';
	import type { Point } from '#lib/landscape/route.ts';
	import { railsOf, restGroups } from '#lib/landscape/scene.ts';
	import { tokenValues, type Token } from '#lib/theme/tokens.ts';
	import wasmUrl from 'libavoid-js/dist/libavoid.wasm?url';

	/**
	 * The landscape drawn on one WebGL canvas (PixiJS), the Rendering technique setting's
	 * `webgl`. Nothing it draws is an element of the page, so the browser has nothing to restyle,
	 * lay out or hit-test as the view moves: a pan moves one transform, and a zoom re-sizes what
	 * keeps its size on screen (names, line widths, heads) in a few loops over plain objects.
	 *
	 * Draw order is layering: each depth's boxes, then the lines at rest among their children,
	 * then the next depth's boxes, so a line runs over the box it is in and under the boxes
	 * inside. Cards draw their rows, and rails their endpoints, while they read and are near the
	 * screen, as in adaptive detail (see open.ts).
	 *
	 * Still drawn by page elements only: hover and picking, lit lines, the inspector and peeks,
	 * focus and play, change marks, the key and the minimap.
	 */
	let { view }: { view: ViewState } = $props();

	const MIN_ZOOM = 0.0005;
	const MAX_ZOOM = 64;
	/** Glyphs are drawn once at this size and scaled. */
	const GLYPH_PX = 48;

	// ------------------------------------------------------------ what is drawn
	const model = $derived(changes.shown);
	// Laid out with every flag branch and gated item in, as the page elements' canvas does.
	const laid = $derived(layoutLandscape(changes.layoutModel, settings.layout));
	const boxes = $derived(laid.boxes);
	const boxById = $derived(new Map(boxes.map((b) => [b.id, b])));
	const open = $derived(new Set(boxes.filter((b) => b.group).map((b) => b.id)));
	const rails = $derived(railsOf(model, boxes, boxById, open));
	/** The key entry each kind of line at rest is hidden under. */
	const KEY_OF: Partial<Record<LinkKind, string>> = {
		reads: 'reads',
		writes: 'writes',
		calls: 'calls',
		handles: 'calls'
	};
	const hiddenLeaf = (id: string) =>
		changes.hidden.has(id) || changes.hidden.has(apiOf(model, id) ?? '');
	const rest = $derived(
		restLines(
			laid.lines,
			edgesOf(model).filter(
				(e) =>
					KEY_OF[e.kind] &&
					!view.hidden[KEY_OF[e.kind]!] &&
					!hiddenLeaf(e.from) &&
					!hiddenLeaf(e.to)
			)
		)
	);
	const groups = $derived(restGroups(boxes, boxById, rails, rest));

	// ------------------------------------------------------------ routing
	const router = new RouteClient(
		new RouteWorker() as unknown as RoutePort,
		new RouteWorker() as unknown as RoutePort,
		wasmUrl,
		typeof localStorage === 'undefined' ? undefined : routeStore(localStorage, 512)
	);
	router.onfail = (error) => console.error('Routing failed:', error);
	$effect(() => () => router.destroy());
	let routedIn = $state(0);
	const routeCame = () => untrack(() => routedIn++);
	const restRoutes = $derived.by(() => {
		void routedIn;
		return router.groupRoutes(groups);
	});
	$effect(() => router.wantGroups(groups, true, routeCame));

	// ------------------------------------------------------------ PixiJS
	let host: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let pixi: typeof import('pixi.js') | undefined = $state();
	let app: Application | undefined;
	let world: Container | undefined;
	let failed = $state<string>();
	const cam = { x: 0, y: 0, zoom: 1 };
	let fitted: unknown;

	$effect(() => {
		let gone = false;
		let made: Application | undefined;
		void (async () => {
			try {
				const P = await import('pixi.js');
				const a = new P.Application();
				await a.init({
					canvas,
					resizeTo: host,
					antialias: true,
					autoDensity: true,
					resolution: devicePixelRatio,
					autoStart: false,
					preference: 'webgl',
					backgroundAlpha: 0
				});
				if (gone) return a.destroy();
				made = a;
				world = new P.Container();
				a.stage.addChild(world);
				a.renderer.on('resize', () => requestRender(true));
				app = a;
				pixi = P;
			} catch (e) {
				failed = String(e);
			}
		})();
		return () => {
			gone = true;
			made?.destroy(false, { children: true });
			app = undefined;
			world = undefined;
		};
	});

	/** Colours of the theme as PixiJS takes them: a number and an alpha. */
	const colours = $derived.by(() => {
		const values = tokenValues(theme.current);
		const P = pixi;
		return (t: Token) => {
			const c = P ? new P.Color(values[t]) : undefined;
			return { color: c?.toNumber() ?? 0, alpha: c?.alpha ?? 1 };
		};
	});

	// ------------------------------------------------------------ the scene
	interface Name {
		text: BitmapText;
		b: LandscapeBox;
		/** Fixed size in canvas px, or how it keeps a size on screen. */
		kind: 'group' | 'card' | 'leaf';
		/** Its width at GLYPH_PX. */
		w: number;
	}
	let names: Name[] = [];
	/* eslint-disable svelte/prefer-svelte-reactivity -- the scene is not state: drawn, not read */
	/** Line graphics, by the depth of the box the lines are in (-1 for the root). */
	let lineLayers = new Map<number, Graphics>();
	/** Cards and rails drawing their rows, by box id. */
	let rowsOf = new Map<string, Container>();
	let builtFor: unknown[] = [];
	/* eslint-enable svelte/prefer-svelte-reactivity */

	const depthOf = (b: LandscapeBox) => {
		let d = 0;
		for (let p = b.parentId; p; p = boxById.get(p)?.parentId) d++;
		return d;
	};
	const isCard = (b: LandscapeBox) => !!(b.table || b.logic || b.triggers);
	type KindToken = 'kind-class' | 'kind-table' | 'kind-logic' | 'kind-trigger';
	const kindToken = (b: LandscapeBox): KindToken =>
		b.logic
			? 'kind-logic'
			: b.triggers
				? 'kind-trigger'
				: b.view === 'table'
					? 'kind-table'
					: 'kind-class';

	function textOf(s: string, colour: { color: number }, bold = false) {
		const t = new pixi!.BitmapText({
			text: s,
			style: {
				fontFamily: getComputedStyle(document.body).fontFamily,
				fontSize: GLYPH_PX,
				fill: 0xffffff,
				fontWeight: bold ? 'bold' : 'normal'
			}
		});
		t.tint = colour.color;
		return t;
	}

	/** Every box and name, layer by layer; lines and rows are drawn as they come. */
	function build() {
		const P = pixi!;
		const c = colours;
		for (const child of world!.removeChildren()) child.destroy({ children: true });
		names = [];
		lineLayers = new Map();
		rowsOf = new Map();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and used here
		const byDepth = new Map<number, LandscapeBox[]>();
		for (const b of boxes) {
			const d = depthOf(b);
			byDepth.set(d, [...(byDepth.get(d) ?? []), b]);
		}
		const deepest = Math.max(-1, ...byDepth.keys());
		const lineLayer = (d: number) => {
			const g = new P.Graphics();
			lineLayers.set(d, g);
			world!.addChild(g);
		};
		lineLayer(-1);
		for (let d = 0; d <= deepest; d++) {
			const g = new P.Graphics();
			world!.addChild(g);
			for (const b of byDepth.get(d) ?? []) drawBox(g, b, c);
			lineLayer(d);
		}
		// Names over everything, as the page elements draw them in front.
		const nameLayer = new P.Container();
		world!.addChild(nameLayer);
		for (const b of boxes) {
			const el = model.elements.get(b.elementId);
			const label = b.logic ? 'Logic' : b.triggers ? 'Triggers' : (el?.name ?? b.id);
			const kind = b.group ? 'group' : isCard(b) ? 'card' : 'leaf';
			const tok: Token = isCard(b)
				? 'model-text'
				: b.boundary
					? 'boundary-text'
					: el?.def.kind === 'module' && !el.parentId
						? 'system-text'
						: 'module-text';
			const text = textOf(label, c(tok), true);
			text.cullable = true;
			nameLayer.addChild(text);
			names.push({ text, b, kind, w: text.width });
		}
		const rowLayer = new P.Container();
		rowLayer.label = 'rows';
		world!.addChild(rowLayer);
	}

	function drawBox(g: Graphics, b: LandscapeBox, c: typeof colours) {
		const el = model.elements.get(b.elementId);
		const system = el?.def.kind === 'module' && !el.parentId && !b.boundary;
		const line = (t: Token) => ({ ...c(t), width: 1, pixelLine: true });
		if (isCard(b)) {
			const k = kindToken(b);
			const r = b.logic ? 10 : b.triggers ? 6 : b.view === 'table' ? 3 : 8;
			g.roundRect(b.absX, b.absY, b.width, b.height, r).fill(c('model-fill')).stroke(line(k));
			if (b.triggers)
				g.rect(b.absX + 1, b.absY + 1, b.width - 2, TABLE.head - 1).fill(c('kind-trigger-head'));
			g.moveTo(b.absX, b.absY + TABLE.head)
				.lineTo(b.absX + b.width, b.absY + TABLE.head)
				.stroke(line(b.view === 'table' || b.triggers ? k : (`${k}-soft` as Token)));
		} else if (b.boundary) {
			g.roundRect(b.absX, b.absY, b.width, b.height, 10).stroke(line('boundary-stroke'));
		} else {
			const pre = system ? 'system' : 'module';
			g.roundRect(b.absX, b.absY, b.width, b.height, system ? 14 : 10)
				.fill(c(`${pre}-fill`))
				.stroke(line(`${pre}-stroke`));
		}
		const r = rails.get(b.id);
		if (r)
			g.roundRect(b.absX + b.width - r.width / 2, b.absY + r.top, r.width, r.height, 6)
				.fill(c('api-fill'))
				.stroke(line('api-stroke'));
	}

	/** Lines at rest, sized for the zoom: widths and heads keep their size on screen. */
	function drawLines() {
		const c = colours;
		const z = cam.zoom;
		for (const g of lineLayers.values()) g.clear();
		const routes = restRoutes.routes;
		for (const l of rest) {
			const pts = routes.get(l.id);
			if (!pts || pts.length < 2) continue;
			const parent = l.parentId ? boxById.get(l.parentId) : undefined;
			const g = lineLayers.get(parent ? depthOf(parent) : -1);
			if (!g) continue;
			const w = l.count >= 10 ? 2.6 : l.count > 1 ? 1.8 : 1.2;
			const path = (pp: Point[]) => {
				g.moveTo(pp[0].x, pp[0].y);
				for (const p of pp.slice(1)) g.lineTo(p.x, p.y);
			};
			path(pts);
			g.stroke({ ...c('canvas-bg'), width: (w + 4.5) / z, join: 'miter', cap: 'butt' });
			// The line stops under its head, so a wide line does not blunt the tip.
			const [a, b] = [pts.at(-2)!, pts.at(-1)!];
			const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
			const [ux, uy] = [(b.x - a.x) / len, (b.y - a.y) / len];
			const back = Math.min(5 / z, len);
			path([...pts.slice(0, -1), { x: b.x - ux * back, y: b.y - uy * back }]);
			g.stroke({ ...c('edge-rest'), width: w / z, join: 'miter', cap: 'butt' });
			const [hl, hw] = [10 / z, 4 / z];
			g.poly([
				b.x,
				b.y,
				b.x - ux * hl - uy * hw,
				b.y - uy * hl + ux * hw,
				b.x - ux * hl + uy * hw,
				b.y - uy * hl - ux * hw
			]).fill(c('edge-rest'));
		}
	}

	/**
	 * Names keep NAME_MIN px on screen as the view zooms out, never past what their box has
	 * room for; a module's sits in its top-left corner, a card's in its name bar while its rows
	 * show, else across it.
	 */
	function placeNames() {
		const z = cam.zoom;
		const legible = TABLE.row * z >= LEGIBLE;
		for (const n of names) {
			const { b, text } = n;
			const fit = (w: number, h: number) => Math.max(0, Math.min(w / (n.w / GLYPH_PX), h));
			let px: number;
			if (n.kind === 'group') {
				px = Math.min(13 / z, HEADER / 2, fit(b.width - 24, Infinity));
				text.position.set(b.absX + 0.6 * px, b.absY + 0.35 * px);
			} else if (n.kind === 'card' && legible && rowsOf.has(b.id)) {
				px = clamp(TABLE.title, NAME_MIN / z, Math.min(fit(b.width - 2 * TABLE.pad, 99), 22));
				text.position.set(b.absX + TABLE.pad, b.absY + (TABLE.head - 1.2 * px) / 2);
			} else {
				const room = b.width - (rails.get(b.id)?.width ?? 0) / 2 - 16;
				px = clamp(n.kind === 'card' ? TABLE.title : 15, NAME_MIN / z, fit(room, b.height * 0.6));
				const w = (n.w / GLYPH_PX) * px;
				text.position.set(b.absX + (room + 16 - w) / 2, b.absY + (b.height - 1.2 * px) / 2);
			}
			text.scale.set(px / GLYPH_PX);
			text.visible = px * z >= 2;
		}
	}
	const clamp = (lo: number, v: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

	/** Cards and rails near the screen whose rows read draw them; the rest drop theirs. */
	function placeRows() {
		const z = cam.zoom;
		const layer = world!.getChildByLabel('rows') as Container;
		const { width, height } = app!.screen;
		const [mx, my] = [width * MARGIN, height * MARGIN];
		const near = (x: number, y: number, w: number, h: number) => {
			const [l, t] = [x * z + cam.x, y * z + cam.y];
			return l < width + mx && t < height + my && l + w * z > -mx && t + h * z > -my;
		};
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and used here
		const want = new Set<string>();
		if (TABLE.row * z >= LEGIBLE)
			for (const b of boxes)
				if (isCard(b) && near(b.absX, b.absY, b.width, b.height)) want.add(b.id);
		for (const [id, r] of rails) {
			const b = boxById.get(id)!;
			const x = b.absX + b.width - r.width / 2;
			if (RAIL.font * r.scale * z >= LEGIBLE && near(x, b.absY + r.top, r.width, r.height))
				want.add(`rail:${id}`);
		}
		for (const [id, c] of rowsOf)
			if (!want.has(id)) {
				c.destroy({ children: true });
				rowsOf.delete(id);
			}
		for (const id of want) {
			if (rowsOf.has(id)) continue;
			const c = id.startsWith('rail:') ? railRows(id.slice(5)) : cardRowsOf(boxById.get(id)!);
			layer.addChild(c);
			rowsOf.set(id, c);
		}
	}

	function cardRowsOf(b: LandscapeBox): Container {
		const P = pixi!;
		const c = colours;
		const out = new P.Container();
		const g = new P.Graphics();
		out.addChild(g);
		const at = (s: string, x: number, y: number, px: number, tok: Token, bold = false) => {
			const t = textOf(s, c(tok), bold);
			t.scale.set(px / GLYPH_PX);
			t.position.set(x, y - (px * 1.2) / 2);
			out.addChild(t);
			return t;
		};
		const kind = b.logic
			? 'Logic'
			: b.triggers
				? 'Triggers'
				: b.view === 'table'
					? 'TABLE'
					: 'CLASS';
		if (b.table) {
			const kw = at(kind, 0, b.absY + TABLE.head / 2, TABLE.label, 'text-muted');
			kw.x = b.absX + b.width - TABLE.pad - kw.width;
		}
		const lines = (y: number) =>
			g
				.moveTo(b.absX, y)
				.lineTo(b.absX + b.width, y)
				.stroke({ ...c(`${kindToken(b)}-soft`), width: 1, pixelLine: true });
		const rows = cardRows(b);
		if (rows) {
			const nameW = (b.logic ?? b.triggers)!.cols[0].width;
			rows.forEach((r, i) => {
				const y = b.absY + logicRowY(i);
				at(r.name, b.absX + TABLE.pad, y, TABLE.row, 'model-text');
				at(r.signature, b.absX + nameW + TABLE.pad, y, TABLE.signature, 'text-muted');
				if (i) lines(y - TABLE.rowHeight / 2);
			});
			return out;
		}
		const fields = b.fields ?? [];
		const n = shownRows(fields.length, false, b.foldAt ?? FOLD);
		const typeX = b.absX + (b.table?.[0]?.width ?? 0) + TABLE.pad;
		const label = (id: string) => refLabel(model, id);
		fields.slice(0, n).forEach((f, i) => {
			const y = b.absY + fieldRowY(i, fields.length, false, b.foldAt ?? FOLD);
			at(f.name, b.absX + TABLE.pad, y, TABLE.row, 'model-text', !!f.pk);
			at(typeText(f, label), typeX, y, TABLE.row, 'text-muted');
			lines(y - TABLE.rowHeight / 2);
		});
		if (foldable(fields.length, b.foldAt ?? FOLD)) {
			const y = b.absY + fieldRowY(n, fields.length, false, b.foldAt ?? FOLD);
			lines(y - TABLE.rowHeight / 2);
			at(
				`Show all ${fields.length} fields (${fields.length - n} more)`,
				b.absX + TABLE.pad,
				y,
				TABLE.label,
				'text-muted'
			);
		}
		return out;
	}

	function railRows(id: string): Container {
		const P = pixi!;
		const c = colours;
		const b = boxById.get(id)!;
		const r: Rail = rails.get(id)!;
		const out = new P.Container();
		const x0 = b.absX + b.width - r.width / 2;
		const y0 = b.absY + r.top;
		const at = (s: string, x: number, y: number, px: number, tok: Token, bold = false) => {
			const t = textOf(s, c(tok), bold);
			t.scale.set((px * r.scale) / GLYPH_PX);
			t.position.set(x, y - (px * r.scale * 1.2) / 2);
			out.addChild(t);
		};
		at(
			'APIs',
			x0 + RAIL.pad * r.scale,
			y0 + (RAIL.head / 2) * r.scale,
			RAIL.label,
			'text-muted',
			true
		);
		const METHOD: Record<string, Token> = {
			GET: 'method-get',
			POST: 'method-post',
			PUT: 'method-put',
			PATCH: 'method-put',
			DELETE: 'method-delete'
		};
		let y = RAIL.head;
		for (const grp of r.groups) {
			if (grp.title) {
				at(
					grp.title,
					x0 + RAIL.pad * r.scale,
					y0 + (y + RAIL.group / 2) * r.scale,
					RAIL.label,
					'text-muted',
					true
				);
				y += RAIL.group;
			}
			for (const a of grp.apis) {
				const def = model.elements.get(a)?.def;
				const ry = y0 + (railRowY(r, a) ?? 0) * r.scale;
				at(
					def?.method ?? '',
					x0 + RAIL.pad * r.scale,
					ry,
					RAIL.font,
					METHOD[def?.method ?? ''] ?? 'text-muted',
					true
				);
				at(
					def?.path ?? '',
					x0 + (RAIL.pad + r.methodWidth + RAIL.gap) * r.scale,
					ry,
					RAIL.font,
					'api-text'
				);
			}
			y += grp.apis.length * RAIL.row;
		}
		return out;
	}

	// ------------------------------------------------------------ camera and drawing
	let frame = 0;
	let zoomDrawn = NaN;
	let linesDirty = true;
	/** Draws the next frame; `resized` fits a first layout to the new size. */
	function requestRender(resized = false) {
		if (resized && fitted === undefined) fit();
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			if (!app || !world) return;
			world.position.set(cam.x, cam.y);
			world.scale.set(cam.zoom);
			if (zoomDrawn !== cam.zoom || linesDirty) {
				drawLines();
				zoomDrawn = cam.zoom;
				linesDirty = false;
			}
			placeRows();
			placeNames();
			pixi!.Culler.shared.cull(app.stage, app.screen);
			app.render();
		});
	}

	function fit() {
		if (!app || !boxes.length) return;
		const roots = boxes.filter((b) => !b.parentId);
		const x0 = Math.min(...roots.map((b) => b.absX));
		const y0 = Math.min(...roots.map((b) => b.absY));
		const x1 = Math.max(...roots.map((b) => b.absX + b.width));
		const y1 = Math.max(...roots.map((b) => b.absY + b.height));
		const { width, height } = app.screen;
		if (!width || !height) return;
		cam.zoom = Math.min(width / (x1 - x0), height / (y1 - y0)) * 0.92;
		cam.x = (width - (x1 - x0) * cam.zoom) / 2 - x0 * cam.zoom;
		cam.y = (height - (y1 - y0) * cam.zoom) / 2 - y0 * cam.zoom;
		fitted = laid;
	}

	// A new layout or theme draws the scene anew; a new layout is fitted.
	$effect(() => {
		const deps = [pixi, laid, colours, rails, model];
		if (!pixi || !app) return;
		untrack(() => {
			if (deps.every((d, i) => d === builtFor[i])) return;
			const newLayout = builtFor[1] !== laid;
			builtFor = deps;
			build();
			if (newLayout && fitted !== laid) fit();
			linesDirty = true;
			requestRender();
		});
	});
	// Lines come in group by group.
	$effect(() => {
		void restRoutes;
		void rest;
		linesDirty = true;
		requestRender();
	});

	function onwheel(e: WheelEvent) {
		e.preventDefault();
		const r = host.getBoundingClientRect();
		const [px, py] = [e.clientX - r.left, e.clientY - r.top];
		const step = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.002;
		const k = Math.pow(2, -e.deltaY * step * (e.ctrlKey ? 5 : 1));
		const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * k));
		cam.x = px - ((px - cam.x) * z) / cam.zoom;
		cam.y = py - ((py - cam.y) * z) / cam.zoom;
		cam.zoom = z;
		requestRender();
	}
	let drag = $state.raw<{ x: number; y: number; cx: number; cy: number; id: number }>();
	function onpointerdown(e: PointerEvent) {
		if (e.button !== 0) return;
		host.setPointerCapture(e.pointerId);
		drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, id: e.pointerId };
	}
	function onpointermove(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.id) return;
		cam.x = drag.cx + e.clientX - drag.x;
		cam.y = drag.cy + e.clientY - drag.y;
		requestRender();
	}
	function onpointerup(e: PointerEvent) {
		if (drag?.id === e.pointerId) drag = undefined;
	}
	$effect(() => {
		host.addEventListener('wheel', onwheel, { passive: false });
		return () => host.removeEventListener('wheel', onwheel);
	});
</script>

<div
	class="gl"
	class:dragging={!!drag}
	bind:this={host}
	role="application"
	aria-label="Landscape (WebGL)"
	data-testid="gl-canvas"
	{onpointerdown}
	{onpointermove}
	{onpointerup}
	onpointercancel={onpointerup}
	ondblclick={() => (fit(), requestRender())}
>
	<canvas bind:this={canvas}></canvas>
	{#if failed}
		<p class="failed">WebGL could not start: {failed}. Choose Page elements in Settings.</p>
	{/if}
	{#if !restRoutes.done}
		<p class="routing">Routing lines… ({restRoutes.routes.size} of {rest.length})</p>
	{/if}
</div>

<style>
	.gl {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		background: var(--sdv-canvas-bg);
		cursor: grab;
		touch-action: none;
	}
	.gl.dragging {
		cursor: grabbing;
	}
	.gl :global(canvas) {
		position: absolute;
		inset: 0;
		display: block;
	}
	.failed,
	.routing {
		position: absolute;
		left: 12px;
		bottom: 8px;
		margin: 0;
		font-size: 12px;
		color: var(--sdv-text-muted);
		pointer-events: none;
		z-index: 1;
	}
	.failed {
		color: var(--ui-danger);
	}
</style>

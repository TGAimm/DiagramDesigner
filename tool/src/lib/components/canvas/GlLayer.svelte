<script lang="ts" module>
	import type { Point } from '#lib/landscape/route.ts';
	import type { Token } from '#lib/theme/tokens.ts';

	/** A line drawn on the WebGL layer, in canvas px; widths, dashes and heads in screen px. */
	export interface GlLine {
		id: string;
		points: Point[];
		width: number;
		color: Token;
		head?: 'arrow' | 'diamond';
		/** Width of the halo in the canvas colour under it. */
		halo?: number;
		dash?: readonly [number, number];
		/** Faded, as lines at rest are while something is looked at. */
		dim?: boolean;
		/** Hover text. */
		title?: string;
		/** Depth of the box the line is in, -1 for none; lit lines go over everything. */
		depth: number;
	}

	/** What is under the pointer. */
	export type GlHit =
		| { part: 'row'; box: string; id: string }
		| { part: 'api'; box: string; id: string }
		| { part: 'fold'; box: string }
		/** A card's name bar, a closed box, or an open box's name tab. */
		| { part: 'head'; box: string; card: boolean }
		/** Inside an open box, not on its name tab. */
		| { part: 'body'; box: string }
		/** A rail not listing its endpoints. */
		| { part: 'rail'; box: string };
</script>

<script lang="ts">
	import type { BitmapText, Container, Graphics } from 'pixi.js';
	import { useViewport } from '@xyflow/svelte';
	import { changes } from '#lib/client/changes.svelte.ts';
	import { theme } from '#lib/client/theme.svelte.ts';
	import type { ViewState } from '#lib/client/view-state.svelte.ts';
	import { RAIL, railRowY, type Rail } from '#lib/landscape/apis.ts';
	import {
		cardRows,
		fieldRowY,
		FOLD,
		foldable,
		HEADER,
		incomingCount,
		indexFields,
		indexKind,
		keysOf,
		kindWord,
		logicNote,
		logicRowY,
		ownerNote,
		refLabel,
		shownRows,
		slotCount,
		TABLE,
		triggersNote,
		typeText,
		type LandscapeBox,
		type Relations
	} from '#lib/landscape/layout.ts';
	import { NAME_MIN } from '#lib/landscape/open.ts';
	import type { Model } from '#lib/model/model.ts';
	import { tokenValues } from '#lib/theme/tokens.ts';
	import { GLYPH_PX, glText } from './gl/font.ts';

	/**
	 * The landscape's boxes, rows and lines drawn on one WebGL canvas (PixiJS), for the Rendering
	 * technique setting's `webgl`. It sits in the canvas under Svelte Flow, which is given no
	 * nodes or edges and still pans, zooms and carries everything over the landscape (cards,
	 * peeks, the player, the key). Nothing it draws is an element of the page, so the browser has
	 * nothing to restyle, lay out or hit-test as the view moves.
	 *
	 * It reads the same view state the page elements' nodes do (lit rows, the pick, rails listed,
	 * cards expanded, change marks), and `hitAt` tells the canvas what is under the pointer, so
	 * the canvas handles hover and clicks as it does for the nodes.
	 *
	 * Draw order is layering: lines at rest among the roots, each depth's boxes then the lines
	 * at rest among their children, names, rows, lit lines, outlines.
	 */
	let {
		boxes,
		boxById,
		rails,
		model,
		rels,
		view,
		rest,
		lit,
		dim,
		namesInFront,
		pointer
	}: {
		boxes: LandscapeBox[];
		boxById: Map<string, LandscapeBox>;
		rails: Map<string, Rail>;
		model: Model;
		rels: Relations;
		view: ViewState;
		rest: GlLine[];
		lit: GlLine[];
		/** While something is looked at: the boxes kept bright; the rest are toned down. */
		dim: Set<string> | undefined;
		/** Open boxes' names are drawn in front by the canvas, not here. */
		namesInFront: boolean;
		/** What the pointer is over now, for a row's hover tint. */
		pointer: GlHit | null;
	} = $props();

	const viewport = useViewport();
	const DIM_OPACITY = 0.2;

	let host: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let pixi: typeof import('pixi.js') | undefined = $state();
	let app: import('pixi.js').Application | undefined;
	let failed = $state<string>();

	// ------------------------------------------------------------ PixiJS
	$effect(() => {
		let gone = false;
		let made: import('pixi.js').Application | undefined;
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
				a.renderer.on('resize', () => request());
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
		};
	});

	const values = $derived(tokenValues(theme.current));
	/** A token as PixiJS takes it: a number and an alpha. */
	const colour = (t: Token) => {
		const c = new pixi!.Color(values[t]);
		return { color: c.toNumber(), alpha: c.alpha };
	};

	/** Text crisp at any scale (see gl/font.ts), tinted with token `t`. */
	function textOf(s: string, t: Token, bold = false): BitmapText {
		const text = glText(pixi!, s, { bold });
		const c = colour(t);
		text.tint = c.color;
		text.alpha = c.alpha;
		return text;
	}

	// ------------------------------------------------------------ the scene
	interface Name {
		text: BitmapText;
		b: LandscapeBox;
		kind: 'group' | 'card' | 'leaf' | 'rail';
		/** Its width at GLYPH_PX. */
		w: number;
		/** Where it was last drawn, in canvas px, for hit testing a name tab. */
		at?: { x0: number; y0: number; x1: number; y1: number };
	}
	/* eslint-disable svelte/prefer-svelte-reactivity -- the scene is drawn, not read: not state */
	let names: Name[] = [];
	let nameOf = new Map<string, Name>();
	let lineLayers = new Map<number, Graphics>();
	let litLayer: Graphics | undefined;
	let rowLayer: Container | undefined;
	let outlineLayer: Graphics | undefined;
	/** The row under the pointer, tinted over its card's rows. */
	let hoverLayer: Graphics | undefined;
	let badgeLayer: Container | undefined;
	/** Cards and rails drawing their rows, by box id (`rail:` for a rail), and what they drew. */
	let rowsOf = new Map<string, { c: Container; sig: string }>();
	let depthCache = new Map<string, number>();
	/* eslint-enable svelte/prefer-svelte-reactivity */

	const depthOf = (b: LandscapeBox): number => {
		let d = depthCache.get(b.id);
		if (d !== undefined) return d;
		d = b.parentId ? depthOf(boxById.get(b.parentId)!) + 1 : 0;
		depthCache.set(b.id, d);
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
	const elOf = (b: LandscapeBox) => model.elements.get(b.elementId);
	const isSystem = (b: LandscapeBox) => {
		const el = elOf(b);
		return !b.boundary && el?.def.kind === 'module' && !el.parentId;
	};

	// Change marks while a scenario or commit is compared, as LandscapeNode draws them.
	const marks = $derived(changes.marks);
	const comparing = $derived(!!changes.comparison);
	const level = (id: string) => {
		const l = marks.level.get(id);
		return l === 'breaking' || l === 'check' ? l : undefined;
	};
	const marked = (id: string) =>
		marks.glyph.has(id) || (marks.level.has(id) && marks.level.get(id) !== 'stopped');
	/** How much of a box shows: toned down while not related to what is looked at, faded when compared and unchanged. */
	const alphaOf = (b: LandscapeBox) =>
		(dim && !dim.has(b.id) ? DIM_OPACITY : 1) *
		(comparing && !b.group && !marks.rollup.get(b.elementId) ? 0.45 : 1);

	/** Boxes, names and badges, layer by layer; lines, rows and outlines are drawn per frame. */
	function build() {
		const P = pixi!;
		const stage = app!.stage;
		for (const child of stage.removeChildren()) child.destroy({ children: true });
		names = [];
		nameOf = new Map();
		lineLayers = new Map();
		rowsOf = new Map();
		depthCache = new Map();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and used here
		const byDepth = new Map<number, LandscapeBox[]>();
		for (const b of boxes) {
			const d = depthOf(b);
			byDepth.set(d, [...(byDepth.get(d) ?? []), b]);
		}
		const lineLayer = (d: number) => {
			const g = new P.Graphics();
			lineLayers.set(d, g);
			stage.addChild(g);
		};
		lineLayer(-1);
		const deepest = Math.max(-1, ...byDepth.keys());
		for (let d = 0; d <= deepest; d++) {
			const g = new P.Graphics();
			stage.addChild(g);
			for (const b of byDepth.get(d) ?? []) drawBox(g, b);
			lineLayer(d);
		}
		const nameLayer = new P.Container();
		stage.addChild(nameLayer);
		for (const b of boxes) {
			const el = elOf(b);
			const name = b.logic ? 'Logic' : b.triggers ? 'Triggers' : (el?.name ?? b.id);
			const op = marks.glyph.get(b.elementId);
			const tok: Token = isCard(b)
				? 'model-text'
				: b.boundary
					? 'boundary-text'
					: isSystem(b)
						? 'system-text'
						: 'module-text';
			const kind = b.group ? 'group' : isCard(b) ? 'card' : 'leaf';
			const text = textOf(op ? `${op} ${name}` : name, tok, true);
			text.alpha *= alphaOf(b);
			text.cullable = true;
			nameLayer.addChild(text);
			const n: Name = { text, b, kind, w: text.width };
			names.push(n);
			nameOf.set(b.id, n);
		}
		for (const [id] of rails) {
			const b = boxById.get(id)!;
			const text = textOf('APIs', 'api-text', true);
			text.alpha *= alphaOf(b);
			nameLayer.addChild(text);
			const n: Name = { text, b, kind: 'rail', w: text.width };
			names.push(n);
			nameOf.set(`rail:${id}`, n);
		}
		rowLayer = new P.Container();
		stage.addChild(rowLayer);
		hoverLayer = new P.Graphics();
		stage.addChild(hoverLayer);
		litLayer = new P.Graphics();
		stage.addChild(litLayer);
		outlineLayer = new P.Graphics();
		stage.addChild(outlineLayer);
		badgeLayer = new P.Container();
		stage.addChild(badgeLayer);
		// One count per closed box: what changed or is affected inside, in the worst severity.
		for (const b of boxes) {
			const roll = marks.rollup.get(b.elementId);
			if (!roll || b.group) continue;
			const badge = new P.Container();
			badge.label = b.id;
			const g = new P.Graphics();
			const fill =
				roll.level === 'breaking' ? 'sev-break' : roll.level === 'check' ? 'sev-check' : 'op-fill';
			g.roundRect(-11, -11, Math.max(22, 10 + 7 * String(roll.count).length), 22, 11).fill(
				colour(fill)
			);
			const t = textOf(String(roll.count), 'op-text', true);
			t.scale.set(12 / GLYPH_PX);
			t.position.set(
				-t.width / 2 + (Math.max(22, 10 + 7 * String(roll.count).length) - 22) / 2,
				-7.5
			);
			badge.addChild(g, t);
			badgeLayer.addChild(badge);
		}
	}

	function drawBox(g: Graphics, b: LandscapeBox) {
		const a = alphaOf(b);
		const fill = (t: Token) => {
			const c = colour(t);
			return { ...c, alpha: c.alpha * a };
		};
		const line = (t: Token, width = 1) => ({ ...fill(t), width, pixelLine: width === 1 });
		if (isCard(b)) {
			const k = kindToken(b);
			const r = b.logic ? 10 : b.triggers ? 6 : b.view === 'table' ? 3 : 8;
			g.roundRect(b.absX, b.absY, b.width, b.height, r).fill(fill('model-fill')).stroke(line(k));
			if (b.triggers)
				g.rect(b.absX + 1, b.absY + 1, b.width - 2, TABLE.head - 1).fill(fill('kind-trigger-head'));
			g.moveTo(b.absX, b.absY + TABLE.head)
				.lineTo(b.absX + b.width, b.absY + TABLE.head)
				.stroke(line(b.view === 'table' || b.triggers ? k : (`${k}-soft` as Token)));
		} else if (b.boundary) {
			g.roundRect(b.absX, b.absY, b.width, b.height, 10).stroke(line('boundary-stroke'));
		} else {
			const pre = isSystem(b) ? 'system' : 'module';
			g.roundRect(b.absX, b.absY, b.width, b.height, isSystem(b) ? 14 : 10)
				.fill(fill(`${pre}-fill`))
				.stroke(line(`${pre}-stroke`));
		}
		const r = rails.get(b.id);
		if (r)
			g.roundRect(b.absX + b.width - r.width / 2, b.absY + r.top, r.width, r.height, 6)
				.fill(fill('api-fill'))
				.stroke(line('api-stroke'));
	}

	// ------------------------------------------------------------ lines
	/** `pts` cut into dashes of `on` and gaps of `off`, all in canvas px. */
	function dashed(pts: Point[], on: number, off: number): Point[][] {
		const out: Point[][] = [];
		let cur: Point[] = [];
		let left = on;
		let drawing = true;
		for (let i = 1; i < pts.length; i++) {
			let [a, b] = [pts[i - 1], pts[i]];
			let len = Math.hypot(b.x - a.x, b.y - a.y);
			if (drawing && !cur.length) cur.push(a);
			while (len > left) {
				const t = left / len;
				const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
				if (drawing) {
					cur.push(p);
					out.push(cur);
					cur = [];
				} else cur = [p];
				drawing = !drawing;
				[a, len, left] = [p, len - left, drawing ? on : off];
			}
			left -= len;
			if (drawing) cur.push(b);
		}
		if (drawing && cur.length > 1) out.push(cur);
		return out;
	}

	function drawLine(g: Graphics, l: GlLine, z: number) {
		const pts = l.points;
		if (pts.length < 2) return;
		const a = l.dim ? 0.25 : 1;
		const c = (t: Token) => {
			const v = colour(t);
			return { ...v, alpha: v.alpha * a };
		};
		const path = (pp: Point[]) => {
			g.moveTo(pp[0].x, pp[0].y);
			for (const p of pp.slice(1)) g.lineTo(p.x, p.y);
		};
		if (l.halo) {
			path(pts);
			g.stroke({ ...c('canvas-bg'), width: l.halo / z, join: 'miter', cap: 'butt' });
		}
		// The line stops under its head, so a wide line does not blunt the tip; a diamond sits at
		// its start.
		const atStart = l.head === 'diamond';
		const [tip, from] = atStart ? [pts[0], pts[1]] : [pts.at(-1)!, pts.at(-2)!];
		const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
		const [ux, uy] = [(tip.x - from.x) / len, (tip.y - from.y) / len];
		const back = l.head ? Math.min(5 / z, len) : 0;
		const cut = { x: tip.x - ux * back, y: tip.y - uy * back };
		const body = atStart ? [cut, ...pts.slice(1)] : [...pts.slice(0, -1), cut];
		const stroke = {
			...c(l.color),
			width: l.width / z,
			join: 'miter' as const,
			cap: 'butt' as const
		};
		for (const d of l.dash ? dashed(body, l.dash[0] / z, l.dash[1] / z) : [body]) {
			path(d);
			g.stroke(stroke);
		}
		if (!l.head) return;
		const [hl, hw] = l.head === 'diamond' ? [16 / z, 5 / z] : [10 / z, 4 / z];
		const [px, py] = [-uy, ux];
		const pt = (along: number, side: number) => [
			tip.x - ux * along + px * side,
			tip.y - uy * along + py * side
		];
		g.poly(
			l.head === 'diamond'
				? [...pt(0, 0), ...pt(hl / 2, hw), ...pt(hl, 0), ...pt(hl / 2, -hw)]
				: [...pt(0, 0), ...pt(hl, hw), ...pt(hl, -hw)]
		).fill(c(l.color));
	}

	function drawLines(z: number) {
		for (const g of lineLayers.values()) g.clear();
		for (const l of rest) {
			const g = lineLayers.get(l.depth) ?? lineLayers.get(-1);
			if (g) drawLine(g, l, z);
		}
		litLayer?.clear();
		if (litLayer) for (const l of lit) drawLine(litLayer, l, z);
	}

	// ------------------------------------------------------------ names
	const clamp = (lo: number, v: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

	/**
	 * Names keep NAME_MIN px on screen as the view zooms out, never past what their box has room
	 * for; an open box's sits in its top-left corner (the canvas draws it in front while zoomed
	 * far out), a card's in its name bar while its rows show, else across it.
	 */
	function placeNames(z: number) {
		for (const n of names) {
			const { b, text } = n;
			const fit = (w: number, h: number) => Math.max(0, Math.min(w / (n.w / GLYPH_PX), h));
			let px: number;
			let x: number;
			let y: number;
			if (n.kind === 'rail') {
				const r = rails.get(b.id)!;
				const listed = rowsOf.has(`rail:${b.id}`);
				text.visible = !listed;
				if (listed) continue;
				const room = fit(r.width - 8, r.height * 0.6);
				px = clamp(Math.min(RAIL.font, room), NAME_MIN / z, room);
				x = b.absX + b.width - ((n.w / GLYPH_PX) * px) / 2;
				y = b.absY + r.top + r.height / 2 - 0.6 * px;
			} else if (n.kind === 'group') {
				px = Math.min(13 / z, HEADER / 2, fit(b.width - 24, Infinity));
				x = b.absX + 0.6 * px;
				y = b.absY + 0.35 * px;
				text.visible = !namesInFront;
			} else if (n.kind === 'card' && rowsOf.has(b.id)) {
				px = clamp(
					TABLE.title,
					NAME_MIN / z,
					Math.min(fit(b.width - 2 * TABLE.pad - 60, 99), TABLE.head / 2.2)
				);
				x = b.absX + TABLE.pad;
				y = b.absY + TABLE.head * 0.36 - 0.6 * px;
			} else {
				const room = b.width - (rails.get(b.id)?.width ?? 0) / 2 - 16;
				px = clamp(n.kind === 'card' ? TABLE.title : 15, NAME_MIN / z, fit(room, b.height * 0.6));
				const w = (n.w / GLYPH_PX) * px;
				x = b.absX + (room + 16 - w) / 2;
				y = b.absY + (b.height - 1.2 * px) / 2;
			}
			text.scale.set(px / GLYPH_PX);
			text.position.set(x, y);
			if (n.kind !== 'group' && n.kind !== 'rail') text.visible = px * z >= 2;
			n.at = {
				x0: x - 4 / z,
				y0: y - 2 / z,
				x1: x + (n.w / GLYPH_PX) * px + 4 / z,
				y1: y + 1.3 * px
			};
		}
		// Badges keep their size on screen, on the box's top-right corner.
		for (const badge of badgeLayer?.children ?? []) {
			const b = boxById.get(badge.label)!;
			badge.scale.set(1 / z);
			badge.position.set(b.absX + b.width - 2 / z, b.absY + 2 / z);
		}
	}

	// ------------------------------------------------------------ rows
	/** A card's rows show while it reads near the screen, or is looked at; a rail's as well, or hovered. */
	const cardFull = (id: string) => !!view.near[id] || !!view.full[id];
	const railListed = (id: string) => view.railHover === id || cardFull(id);

	function placeRows() {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and used here
		const want = new Map<string, string>();
		for (const b of boxes)
			if (isCard(b) && cardFull(b.id))
				want.set(
					b.id,
					JSON.stringify([
						!!view.expanded[b.id],
						view.hot[b.id] ?? null,
						view.field?.box === b.id ? view.field.field : '',
						view.flash?.box === b.id ? view.flash.field : '',
						view.apiDim[b.id] ?? null,
						view.apiBoxes[b.id] ?? null,
						alphaOf(b)
					])
				);
		for (const [id] of rails)
			if (railListed(id)) {
				const apis = rails.get(id)!.groups.flatMap((g) => g.apis);
				want.set(
					`rail:${id}`,
					JSON.stringify([
						apis.filter((a) => view.hotApis[a]),
						apis.includes(view.api ?? '') ? view.api : '',
						alphaOf(boxById.get(id)!)
					])
				);
			}
		for (const [id, r] of rowsOf)
			if (want.get(id) !== r.sig) {
				r.c.destroy({ children: true });
				rowsOf.delete(id);
			}
		for (const [id, sig] of want) {
			if (rowsOf.has(id)) continue;
			const b = boxById.get(id.startsWith('rail:') ? id.slice(5) : id)!;
			const c = id.startsWith('rail:') ? railRows(b) : cardRowsOf(b);
			c.alpha = alphaOf(b);
			rowLayer!.addChild(c);
			rowsOf.set(id, { c, sig });
		}
	}

	/**
	 * A row's tint by how it is lit, as LandscapeNode's rows: flash, self or picked, lit. The row
	 * under the pointer is tinted apart (see `drawHover`), so hovering rebuilds no rows.
	 */
	function rowState(box: string, id: string) {
		const hot = view.hot[box]?.[id];
		const picked = view.field?.box === box && view.field.field === id;
		const flash = view.flash?.box === box && view.flash.field === id;
		const bg: Token | undefined = flash
			? 'row-flash'
			: hot === 'self' || picked
				? 'row-self'
				: hot === 'peer'
					? 'row-peer'
					: undefined;
		const bar: Token | undefined =
			hot === 'self' || picked
				? 'selection'
				: hot === 'caller'
					? 'link-call'
					: level(id) === 'breaking'
						? 'sev-break'
						: level(id) === 'check'
							? 'sev-check'
							: undefined;
		return { bg, bar };
	}

	function cardRowsOf(b: LandscapeBox): Container {
		const P = pixi!;
		const out = new P.Container();
		const g = new P.Graphics();
		out.addChild(g);
		const at = (s: string, x: number, y: number, px: number, t: Token, bold = false) => {
			const text = textOf(s, t, bold);
			text.scale.set(px / GLYPH_PX);
			text.position.set(x, y - (px * 1.2) / 2);
			out.addChild(text);
			return text;
		};
		const k = kindToken(b);
		const sep = (y: number) =>
			g
				.moveTo(b.absX + 1, y)
				.lineTo(b.absX + b.width - 1, y)
				.stroke({ ...colour(`${k}-soft`), width: 1, pixelLine: true });
		const tint = (y: number, h: number, t: Token) =>
			g.rect(b.absX + 1, y, b.width - 2, h).fill(colour(t));
		const bar = (y: number, h: number, t: Token) => g.rect(b.absX + 1, y, 3, h).fill(colour(t));
		const rowsH = TABLE.rowHeight;
		const rows = cardRows(b);
		const el = elOf(b);
		// The name bar's kind word and note; the name is drawn with the others (see placeNames).
		if (b.table) {
			const word = at(
				kindWord(b.view ?? 'class'),
				0,
				b.absY + TABLE.head * 0.36,
				TABLE.label,
				'text-muted'
			);
			word.x = b.absX + b.width - TABLE.pad - word.width;
		}
		const owner = b.ref ? model.elements.get(el?.parentId ?? '')?.name : undefined;
		const parts = view.apiBoxes[b.id];
		const note = rows
			? b.logic
				? logicNote(rows.length)
				: triggersNote(rows.length)
			: [ownerNote(owner), parts?.join(', ')].filter(Boolean).join(' · ');
		if (note)
			at(
				note,
				b.absX + TABLE.pad,
				b.absY + TABLE.head * 0.74,
				TABLE.note,
				parts ? 'link-ref' : 'text-muted'
			);
		if (rows) {
			const nameW = (b.logic ?? b.triggers)!.cols[0].width;
			rows.forEach((r, i) => {
				if (changes.hidden.has(r.id)) return;
				const y = b.absY + logicRowY(i);
				const top = y - rowsH / 2;
				const s = rowState(b.id, r.id);
				if (s.bg) tint(top, rowsH, s.bg);
				if (s.bar) bar(top, rowsH, s.bar);
				if (i) sep(top);
				const op = marks.glyph.get(r.id);
				const name = at(
					`${b.logic ? 'ƒ ' : ''}${op ? `${op} ` : ''}${r.name}`,
					b.absX + TABLE.pad,
					y,
					TABLE.row,
					'model-text'
				);
				const sig = at(r.signature, b.absX + nameW + TABLE.pad, y, TABLE.signature, 'text-muted');
				if (comparing && !marked(r.id)) name.alpha = sig.alpha = 0.38;
				if (marks.dropped.has(r.id))
					g.moveTo(name.x, y)
						.lineTo(name.x + name.width, y)
						.stroke({ ...colour('text-muted'), width: 1, pixelLine: true });
			});
			return out;
		}
		const fields = b.fields ?? [];
		const expanded = !!view.expanded[b.id];
		const foldAt = b.foldAt ?? FOLD;
		const n = shownRows(fields.length, expanded, foldAt);
		const cols = b.table ?? [];
		// Expanded, a card keeps its laid-out size and draws over whatever is below it.
		const bottom =
			b.absY +
			fieldRowY(n, fields.length, true, Number.MAX_SAFE_INTEGER) +
			(foldable(fields.length, foldAt) ? rowsH / 2 : -rowsH / 2) +
			2;
		if (expanded && bottom > b.absY + b.height)
			g.roundRect(b.absX, b.absY + TABLE.head, b.width, bottom - b.absY - TABLE.head, 3)
				.fill(colour('model-fill'))
				.stroke({ ...colour(k), width: 1, pixelLine: true });
		const xs: number[] = [];
		cols.reduce((x, c) => (xs.push(x), x + c.width), b.absX);
		const headY = b.absY + 1 + TABLE.head + rowsH / 2;
		cols.forEach((c, ci) => {
			if (c.key !== 'links')
				at(c.label, xs[ci] + TABLE.pad, headY, TABLE.label, 'text-muted', true);
		});
		const dimRows = view.apiDim[b.id];
		const label = (id: string) => refLabel(model, id);
		fields.slice(0, n).forEach((f, i) => {
			const y = b.absY + fieldRowY(i, fields.length, expanded, foldAt);
			const top = y - rowsH / 2;
			const s = rowState(b.id, f.id);
			if (s.bg) tint(top, rowsH, s.bg);
			if (s.bar) bar(top, rowsH, s.bar);
			sep(top);
			const faded = (comparing && !marked(f.id)) || !!dimRows?.[f.id];
			const texts: BitmapText[] = [];
			cols.forEach((c, ci) => {
				const x = xs[ci] + TABLE.pad;
				if (c.key === 'name') {
					const op = marks.glyph.get(f.id);
					const name = at(
						`${op ? `${op} ` : ''}${f.name}`,
						x,
						y,
						TABLE.row,
						marks.dropped.has(f.id) ? 'text-muted' : 'model-text'
					);
					texts.push(name);
					if (marks.dropped.has(f.id))
						g.moveTo(name.x, y)
							.lineTo(name.x + name.width, y)
							.stroke({ ...colour('text-muted'), width: 1, pixelLine: true });
					let bx = name.x + name.width + TABLE.badgeGap;
					for (const key of b.view === 'table' ? keysOf(f) : []) {
						const t = at(key, bx + 6, y, TABLE.badge, 'model-key-text', true);
						g.roundRect(bx, y - 8, t.width + 12, 16, 4).fill(colour('model-key-fill'));
						texts.push(t);
						bx += t.width + 12 + TABLE.badgeGap;
					}
				} else if (c.key === 'type')
					texts.push(at(typeText(f, label), x, y, TABLE.row, 'text-muted'));
				else if (c.key === 'required' && f.required)
					texts.push(at(TABLE.check, x, y, TABLE.row, 'model-text'));
				else if (c.key === 'nullable' && f.nullable)
					texts.push(at(TABLE.check, x, y, TABLE.row, 'model-text'));
				else if (c.key === 'constraints' && f.constraints?.length)
					texts.push(at(f.constraints.join(' '), x, y, TABLE.badge, 'text-muted'));
				else if (c.key === 'links') {
					let sx = xs[ci];
					for (const slot of c.slots ?? []) {
						const kind =
							slot === 'inRef'
								? 'ref'
								: slot === 'inFrom'
									? 'from'
									: slot === 'inApi'
										? 'api'
										: undefined;
						const count = kind ? incomingCount(rels, f.id, kind) : 0;
						if (slot === 'ref' && f.ref)
							texts.push(at('→', sx + 3, y, TABLE.row, 'link-ref', true));
						else if (slot === 'from' && f.from?.length)
							texts.push(at(f.derived ? '⇢ƒ' : '⇢', sx + 3, y, TABLE.row, 'link-from', true));
						else if (count) {
							const t = at(
								slotCount(slot as 'inRef' | 'inFrom' | 'inApi', count),
								sx + 5,
								y,
								10,
								'op-text',
								true
							);
							g.roundRect(sx + 1, y - 8, t.width + 8, 16, 8).fill(
								colour(
									slot === 'inRef' ? 'link-ref' : slot === 'inFrom' ? 'link-from' : 'api-stroke'
								)
							);
							texts.push(t);
						}
						sx += 20;
					}
				}
			});
			if (faded) for (const t of texts) t.alpha = 0.38;
		});
		if (foldable(fields.length, foldAt)) {
			const y = b.absY + fieldRowY(n, fields.length, expanded, foldAt) + (expanded ? rowsH : 0);
			const hidden =
				!expanded &&
				fields
					.slice(foldAt)
					.some(
						(f) => view.hot[b.id]?.[f.id] || (view.field?.box === b.id && view.field.field === f.id)
					);
			tint(y - rowsH / 2, rowsH, hidden ? 'row-peer' : 'model-header');
			sep(y - rowsH / 2);
			at(
				expanded ? '⌃ Collapse' : `⌄ Show all ${fields.length} fields (${fields.length - n} more)`,
				b.absX + TABLE.pad,
				y,
				TABLE.label,
				'text-muted'
			);
		}
		const indexes = b.view === 'table' ? el?.def.indexes : undefined;
		if (indexes?.length) {
			let y =
				b.absY +
				fieldRowY(n, fields.length, true, Number.MAX_SAFE_INTEGER) +
				(foldable(fields.length, foldAt) ? rowsH : 0);
			sep(y - rowsH / 2);
			at('Indexes', b.absX + TABLE.pad, y, TABLE.label, 'text-muted', true);
			for (const ix of indexes) {
				y += rowsH;
				at(
					`${indexKind(ix)}  ${ix.name}  ${indexFields(ix, fields)}`,
					b.absX + TABLE.pad,
					y,
					TABLE.row,
					'model-text'
				);
			}
		}
		return out;
	}

	function railRows(b: LandscapeBox): Container {
		const P = pixi!;
		const r = rails.get(b.id)!;
		const out = new P.Container();
		const g = new P.Graphics();
		out.addChild(g);
		const x0 = b.absX + b.width - r.width / 2;
		const y0 = b.absY + r.top;
		const s = r.scale;
		const at = (text: string, x: number, y: number, px: number, t: Token, bold = false) => {
			const o = textOf(text, t, bold);
			o.scale.set((px * s) / GLYPH_PX);
			o.position.set(x, y - (px * s * 1.2) / 2);
			out.addChild(o);
			return o;
		};
		at('APIs', x0 + RAIL.pad * s, y0 + (RAIL.head / 2) * s, RAIL.label, 'text-muted', true);
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
					x0 + RAIL.pad * s,
					y0 + (y + RAIL.group / 2) * s,
					RAIL.label,
					'text-muted',
					true
				);
				y += RAIL.group;
			}
			for (const a of grp.apis) {
				if (changes.hidden.has(a)) continue;
				const def = model.elements.get(a)?.def;
				const ry = y0 + (railRowY(r, a) ?? 0) * s;
				const top = ry - (RAIL.row / 2) * s;
				const picked = view.api === a;
				const bg: Token | undefined = picked
					? 'row-self'
					: view.hotApis[a]
						? 'row-peer'
						: undefined;
				if (bg) g.rect(x0 + 1, top, r.width - 2, RAIL.row * s).fill(colour(bg));
				const bar: Token | undefined = picked
					? 'selection'
					: level(a) === 'breaking'
						? 'sev-break'
						: level(a) === 'check'
							? 'sev-check'
							: undefined;
				if (bar) g.rect(x0 + 1, top, 3 * s, RAIL.row * s).fill(colour(bar));
				const op = marks.glyph.get(a);
				const m = at(
					`${op ? `${op} ` : ''}${def?.method ?? ''}`,
					x0 + RAIL.pad * s,
					ry,
					RAIL.font,
					METHOD[def?.method ?? ''] ?? 'text-muted',
					true
				);
				const p = at(
					def?.path ?? '',
					x0 + (RAIL.pad + r.methodWidth + RAIL.gap) * s,
					ry,
					RAIL.font,
					'api-text'
				);
				if (comparing && !marked(a)) m.alpha = p.alpha = 0.38;
				if (marks.dropped.has(a))
					g.moveTo(p.x, ry)
						.lineTo(p.x + p.width, ry)
						.stroke({ ...colour('text-muted'), width: 1, pixelLine: true });
			}
			y += grp.apis.length * RAIL.row;
		}
		return out;
	}

	// ------------------------------------------------------------ outlines
	/** The selected box, and boxes the lit lines or the picked api's bodies end on, outlined. */
	function drawOutlines(z: number) {
		const g = outlineLayer;
		if (!g) return;
		g.clear();
		const ring = (id: string, t: Token, off: number) => {
			const b = boxById.get(id);
			if (!b) return;
			const o = off / z;
			g.roundRect(b.absX - o, b.absY - o, b.width + 2 * o, b.height + 2 * o, 10 + o).stroke({
				...colour(t),
				width: 2 / z
			});
		};
		for (const id of Object.keys(view.peerBoxes)) ring(id, 'link-ref', 3);
		for (const id of Object.keys(view.apiBoxes)) ring(id, 'link-ref', 3);
		for (const id of view.selectedNodes) ring(id, 'selection', 2);
	}

	/** Tints the row, api or fold toggle under the pointer, as `:hover` does a node's rows. */
	function drawHover() {
		const g = hoverLayer;
		if (!g) return;
		g.clear();
		const p = pointer;
		const b = p && boxById.get(p.box);
		if (!p || !b || !rowsOf.has(p.part === 'api' ? `rail:${b.id}` : b.id)) return;
		const h = TABLE.rowHeight;
		const tint = colour('row-hover');
		if (p.part === 'api') {
			const r = rails.get(b.id)!;
			const y = b.absY + r.top + ((railRowY(r, p.id) ?? 0) - RAIL.row / 2) * r.scale;
			g.rect(b.absX + b.width - r.width / 2 + 1, y, r.width - 2, RAIL.row * r.scale).fill(tint);
			return;
		}
		const fields = b.fields ?? [];
		const expanded = !!view.expanded[b.id];
		const foldAt = b.foldAt ?? FOLD;
		let y: number | undefined;
		if (p.part === 'row') {
			const rows = cardRows(b);
			const i = rows
				? rows.findIndex((r) => r.id === p.id)
				: fields.findIndex((f) => f.id === p.id);
			if (i >= 0) y = rows ? logicRowY(i) : fieldRowY(i, fields.length, expanded, foldAt);
		} else if (p.part === 'fold') {
			const n = shownRows(fields.length, expanded, foldAt);
			y = fieldRowY(n, fields.length, expanded, foldAt) + (expanded ? h : 0);
		}
		if (y !== undefined) g.rect(b.absX + 1, b.absY + y - h / 2, b.width - 2, h).fill(tint);
	}

	// ------------------------------------------------------------ drawing
	let frame = 0;
	let drawnZoom = NaN;
	let linesDirty = true;
	/** Draws the next frame. */
	function request() {
		if (frame || typeof requestAnimationFrame === 'undefined') return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			if (!app || !pixi) return;
			const { x, y, zoom } = viewport.current;
			app.stage.position.set(x, y);
			app.stage.scale.set(zoom);
			if (zoom !== drawnZoom || linesDirty) {
				drawLines(zoom);
				drawnZoom = zoom;
				linesDirty = false;
			}
			placeRows();
			placeNames(zoom);
			drawOutlines(zoom);
			drawHover();
			// Culled against the screen in canvas px.
			const s = app.screen;
			pixi.Culler.shared.cull(app.stage, { x: 0, y: 0, width: s.width, height: s.height });
			app.render();
		});
	}
	$effect(() => () => cancelAnimationFrame(frame));

	// A new layout, theme, dimming or change marks draw the scene anew.
	$effect(() => {
		void [pixi, boxes, boxById, rails, model, values, dim, marks, comparing, changes.hidden];
		if (!pixi || !app) return;
		build();
		linesDirty = true;
		request();
	});
	$effect(() => {
		void [rest, lit];
		linesDirty = true;
		request();
	});
	// The view moved, or what rows show and how they are lit changed.
	$effect(() => {
		void viewport.current;
		void [view.near, view.full, view.railHover, view.expanded, view.hot, view.field, view.flash];
		void [view.apiDim, view.apiBoxes, view.hotApis, view.api, view.peerBoxes, view.selectedNodes];
		void [pointer, namesInFront];
		request();
	});

	// ------------------------------------------------------------ hit testing
	/**
	 * What is at `px`, `py` on the canvas, in screen px from its top-left: a row, an api, a fold
	 * toggle, a name bar or tab, the inside of an open box, or a closed rail; the deepest drawn.
	 */
	export function hitAt(px: number, py: number): GlHit | null {
		const { x, y, zoom } = viewport.current;
		const wx = (px - x) / zoom;
		const wy = (py - y) / zoom;
		const inside = (x0: number, y0: number, w: number, h: number) =>
			wx >= x0 && wx <= x0 + w && wy >= y0 && wy <= y0 + h;
		// Rails straddle their box's right border, over it and what is beside it.
		for (const [id, r] of rails) {
			const b = boxById.get(id)!;
			const x0 = b.absX + b.width - r.width / 2;
			if (!inside(x0, b.absY + r.top, r.width, r.height)) continue;
			if (!rowsOf.has(`rail:${id}`)) return { part: 'rail', box: id };
			for (const a of r.groups.flatMap((g) => g.apis)) {
				const ry = b.absY + r.top + (railRowY(r, a) ?? 0) * r.scale;
				if (Math.abs(wy - ry) <= (RAIL.row / 2) * r.scale && !changes.hidden.has(a))
					return { part: 'api', box: id, id: a };
			}
			return { part: 'rail', box: id };
		}
		// Expanded cards draw over what is below them.
		for (const b of boxes) {
			if (!b.fields || !view.expanded[b.id] || !rowsOf.has(b.id)) continue;
			const n = b.fields.length;
			const h = fieldRowY(n, n, true, Number.MAX_SAFE_INTEGER) + TABLE.rowHeight;
			if (inside(b.absX, b.absY, b.width, h)) return cardHit(b, wy);
		}
		let best: LandscapeBox | undefined;
		for (const b of boxes)
			if (inside(b.absX, b.absY, b.width, b.height) && (!best || depthOf(b) > depthOf(best)))
				best = b;
		if (!best) return null;
		if (isCard(best)) return cardHit(best, wy);
		if (!best.group) return { part: 'head', box: best.id, card: false };
		const tab = nameOf.get(best.id)?.at;
		if (!namesInFront && tab && wx >= tab.x0 && wx <= tab.x1 && wy >= tab.y0 && wy <= tab.y1)
			return { part: 'head', box: best.id, card: false };
		return { part: 'body', box: best.id };
	}

	function cardHit(b: LandscapeBox, wy: number): GlHit {
		const head: GlHit = { part: 'head', box: b.id, card: true };
		if (!rowsOf.has(b.id) || wy < b.absY + TABLE.head) return head;
		const half = TABLE.rowHeight / 2;
		const rows = cardRows(b);
		if (rows) {
			const i = rows.findIndex((r, i) => Math.abs(wy - (b.absY + logicRowY(i))) <= half);
			return i >= 0 && !changes.hidden.has(rows[i].id)
				? { part: 'row', box: b.id, id: rows[i].id }
				: head;
		}
		const fields = b.fields ?? [];
		const expanded = !!view.expanded[b.id];
		const foldAt = b.foldAt ?? FOLD;
		const n = shownRows(fields.length, expanded, foldAt);
		for (let i = 0; i < n; i++)
			if (Math.abs(wy - (b.absY + fieldRowY(i, fields.length, expanded, foldAt))) <= half)
				return { part: 'row', box: b.id, id: fields[i].id };
		const foldY =
			b.absY + fieldRowY(n, fields.length, expanded, foldAt) + (expanded ? TABLE.rowHeight : 0);
		if (foldable(fields.length, foldAt) && Math.abs(wy - foldY) <= half)
			return { part: 'fold', box: b.id };
		return head;
	}

	/** The line at rest under `px`, `py`, for its hover text: within a few screen px of it. */
	export function restLineAt(px: number, py: number): GlLine | undefined {
		const { x, y, zoom } = viewport.current;
		const wx = (px - x) / zoom;
		const wy = (py - y) / zoom;
		const reach = 4 / zoom;
		for (const l of rest)
			for (let i = 1; i < l.points.length; i++) {
				const [a, b] = [l.points[i - 1], l.points[i]];
				const t = Math.max(
					0,
					Math.min(
						1,
						((wx - a.x) * (b.x - a.x) + (wy - a.y) * (b.y - a.y)) /
							((b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1)
					)
				);
				if (Math.hypot(wx - (a.x + t * (b.x - a.x)), wy - (a.y + t * (b.y - a.y))) <= reach)
					return l;
			}
	}
</script>

<div class="gl-layer" bind:this={host} aria-hidden="true">
	<canvas bind:this={canvas}></canvas>
	{#if failed}
		<p class="failed">WebGL could not start: {failed}. Choose Page elements in Settings.</p>
	{/if}
</div>

<style>
	.gl-layer {
		position: absolute;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		overflow: hidden;
	}
	canvas {
		position: absolute;
		inset: 0;
		display: block;
	}
	.failed {
		position: absolute;
		left: 60px;
		bottom: 8px;
		margin: 0;
		font-size: 12px;
		color: var(--ui-danger);
	}
</style>

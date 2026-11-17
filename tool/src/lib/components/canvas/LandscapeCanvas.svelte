<script lang="ts">
	import {
		ChevronDown,
		ChevronLeft,
		ChevronUp,
		LocateFixed,
		Play,
		TriangleAlert,
		X
	} from '@lucide/svelte';
	import {
		Background,
		BackgroundVariant,
		ConnectionMode,
		ControlButton,
		Controls,
		SvelteFlow,
		useSvelteFlow,
		useViewport,
		type Edge,
		type Node,
		type NodeProps
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { changes } from '#lib/client/changes.svelte.ts';
	import { search } from '#lib/client/search.svelte.ts';
	import SearchPalette from '#lib/components/SearchPalette.svelte';
	import type { Hit } from '#lib/landscape/search.ts';
	import { focusOn, focusOnRun, type Focus, type FocusMode } from '#lib/landscape/focus.ts';
	import FocusBar from './FocusBar.svelte';
	import Minimap from './Minimap.svelte';
	import { settings } from '#lib/client/settings.svelte.ts';
	import { theme } from '#lib/client/theme.svelte.ts';
	import type { FieldRef, Hot, ViewState } from '#lib/client/view-state.svelte.ts';
	import {
		cardRows,
		fieldRowY,
		incomingCount,
		layoutLandscape,
		linkTarget,
		logicRowY,
		refLabel,
		relationsOf,
		shownRows,
		TABLE,
		typeText,
		type FieldLink,
		type LandscapeBox
	} from '#lib/landscape/layout.ts';
	import {
		apiOf,
		edgesOf,
		homeOf,
		leavesOf,
		restLines,
		within,
		type LinkKind,
		type RestLine
	} from '#lib/landscape/connections.ts';
	import { apiHosts, drawnInFull, READABLE } from '#lib/landscape/open.ts';
	import { sequenceOf, sequenceWidth } from '#lib/landscape/sequence.ts';
	import SequenceDiagram from './SequenceDiagram.svelte';
	import PlayerBar from './PlayerBar.svelte';
	import { callOf, forwardGoesInto, runOf, stepOutOf, type PlayStep } from '#lib/landscape/play.ts';
	import type { LogicField } from '#lib/model/schema.ts';
	import {
		apiUses,
		bodyModels,
		partLabel,
		RAIL,
		railGroups,
		railOf,
		railRowY,
		type ApiUse,
		type Rail
	} from '#lib/landscape/apis.ts';
	import { apiBodies } from '#lib/model/model.ts';
	import { durationWords, nextRuns, scheduleWords } from '#lib/model/schedule.ts';
	import {
		routeKey,
		type Rect,
		type RouteEnd,
		type RouteLine,
		type Side
	} from '#lib/landscape/route.ts';
	import { RouteClient, type RouteAhead, type RoutePort } from '#lib/landscape/route-client.ts';
	import RouteWorker from '#lib/landscape/route-worker.ts?worker';
	import wasmUrl from 'libavoid-js/dist/libavoid.wasm?url';
	import { untrack } from 'svelte';
	import LandscapeNode, { type LandscapeNodeData } from './LandscapeNode.svelte';
	import ConnectionEdge from './ConnectionEdge.svelte';
	import EntityGlyph from './EntityGlyph.svelte';
	import ChangeSection from '#lib/components/ChangeSection.svelte';
	import ChangesPanel from '#lib/components/ChangesPanel.svelte';
	import EditMenu from '#lib/components/EditMenu.svelte';

	/**
	 * The whole model, laid out once, every box mounted and open. Zoomed out, cards and rails draw
	 * only their frames unless they are looked at (see open.ts).
	 */
	let { view }: { view: ViewState } = $props();

	const MIN_ZOOM = 0.05;
	const MAX_ZOOM = 64;
	const flow = useSvelteFlow();
	const viewport = useViewport();
	const nodeTypes = { landscape: LandscapeNode };
	const edgeTypes = { connection: ConnectionEdge };

	let cw = $state(1);
	let ch = $state(1);
	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);
	/** The layout the view was last fitted to: a new one is fitted again. */
	let fittedTo: unknown;
	let fittedFocus: unknown;
	/** Where the view was before the focus, to go back to on leaving it. */
	let beforeFocus: { x: number; y: number; zoom: number } | undefined;
	/** Where the view was before playing, to go back to on stopping. */
	let beforePlay: { x: number; y: number; zoom: number } | undefined;
	/** The next new focus keeps the camera where it was put, instead of fitting. */
	let keepCamera = false;
	/** A new focus is being fitted; the camera is left to it. */
	let fitting = false;
	// Set once the first fit has landed; before it the camera is a placeholder.
	let ready = $state(false);
	/** The key explaining the canvas's marks is shown. */
	let keyOpen = $state(false);

	// Render everything: every box and rail open at any zoom; long cards still fold.
	const all = $derived(settings.detail === 'all');
	// The design, or the state of a scenario or commit being compared (see changes.svelte.ts);
	// in a focus, cut down to the subject and what connects to it, drawn the same. Playing, to
	// what the run can touch, whatever focus it started in.
	const playing = $derived(view.play?.unit);
	const focused = $derived(
		playing
			? focusOnRun(changes.shown, playing)
			: view.focused
				? focusOn(changes.shown, view.focused)
				: undefined
	);
	const focusKey = $derived(playing ? `run:${playing}` : view.focused);
	const model = $derived(focused?.model ?? changes.shown);
	// Laid out with every flag branch and gated item in, so setting a flag moves nothing.
	const boxes = $derived(
		layoutLandscape(focused?.model ?? changes.layoutModel, settings.layout, focused?.foldAt)
	);
	const rels = $derived(relationsOf(model));
	// The minimap draws the root boxes, named, and the modules directly in them.
	const mapBoxes = $derived(
		boxes.flatMap((b) => {
			const box = { id: b.id, x: b.absX, y: b.absY, width: b.width, height: b.height };
			if (!b.parentId) return [{ ...box, name: el(b.elementId)?.name ?? b.id }];
			const top = !boxById.get(b.parentId)?.parentId;
			return top && el(b.elementId)?.def.kind === 'module' ? [box] : [];
		})
	);
	const boxById = $derived(new Map(boxes.map((b) => [b.id, b])));
	// Gated off in the shown flag state: drawn hidden, so neither end of a line.
	const hiddenLeaf = (id: string) =>
		changes.hidden.has(id) || changes.hidden.has(apiOf(model, id) ?? '');
	// Every connection, less the kinds the key hides.
	const allEdges = $derived(edgesOf(model).filter((e) => !hiddenLeaf(e.from) && !hiddenLeaf(e.to)));
	const shownEdges = $derived(allEdges.filter((e) => !view.hidden[KEY_OF[e.kind]]));
	const leavesBy = $derived(new Map(boxes.map((b) => [b.id, new Set(leavesOf(model, b))])));
	const label = (id: string) => refLabel(model, id) ?? id;
	/**
	 * Where row `i` of a card sits, folded or expanded as it is now; logic and triggers cards
	 * never fold.
	 */
	const rowY = (b: LandscapeBox, i: number) =>
		cardRows(b)
			? logicRowY(i)
			: fieldRowY(i, b.fields?.length ?? 0, !!view.expanded[b.id], b.foldAt);
	/** The row of a field, logic unit or trigger in a card, or -1. */
	const rowOf = (b: LandscapeBox, id: string | undefined) =>
		cardRows(b)?.findIndex((r) => r.id === id) ?? b.fields?.findIndex((f) => f.id === id) ?? -1;
	const el = (id: string) => model.elements.get(id);
	const focusedEl = $derived(view.focused && changes.shown.elements.get(view.focused.id));
	const isUnit = (id: string) => el(id)?.def.kind === 'logic-unit';
	const isApiEl = (id: string) => el(id)?.def.kind === 'api';
	const isTrigger = (id: string) => el(id)?.def.kind === 'trigger';

	// Every system and module is drawn open at any zoom. Zoomed out, what thins out is the rows of
	// cards and rails (see open.ts), which are most of what a large landscape draws.
	const open = $derived(new Set(boxes.filter((b) => b.group).map((b) => b.id)));
	// Render everything, or a focus, which is small: every card and rail in full at any zoom.
	const everything = $derived(all || !!focused);
	// Cards and rails drawing their rows: where they read and are on or near the screen (see
	// open.ts). Nodes read it from the view state, and it is only replaced when it changes, so a
	// pan rebuilds nothing and redraws only the boxes coming into or leaving view.
	$effect(() => {
		const { x, y, zoom } = viewport.current;
		const next = everything
			? [...boxes.map((b) => b.id), ...rails.keys()]
			: [...drawnInFull(boxes, rails, { x, y, zoom, width: cw, height: ch })];
		const was = untrack(() => view.near);
		if (next.length === Object.keys(was).length && next.every((id) => was[id])) return;
		view.near = Object.fromEntries(next.map((id) => [id, true as const]));
	});
	// The zoom, `--z`, for what keeps a size on screen, set by one rule on the elements that use
	// it (class `screen-sized`, see app.css). Set on the canvas, every element in it would be
	// styled anew at each step of a zoom.
	const zoomSheet = new CSSStyleSheet();
	zoomSheet.insertRule('.canvas .screen-sized { --z: 1 }');
	const zoomRule = zoomSheet.cssRules[0] as CSSStyleRule;
	$effect(() => {
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, zoomSheet];
		return () => {
			document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== zoomSheet);
		};
	});
	$effect(() => zoomRule.style.setProperty('--z', String(viewport.current.zoom)));
	/** The rail on box `id` lists its endpoints: they read near the screen, or are looked at. */
	const listed = (id: string) => !!view.near[id] || !!view.full[id];

	// Apis sit on a rail across the right border of their parent's box, or of the nearest shown
	// box round it, one rail per box.
	function railsFor(openSet: Set<string>): Map<string, Rail> {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and returned whole
		const out = new Map<string, Rail>();
		for (const [id, apis] of apiHosts(boxes, openSet)) {
			const b = boxById.get(id)!;
			out.set(id, railOf(model, railGroups(model, b.elementId, apis), b.height));
		}
		return out;
	}
	const rails = $derived(railsFor(open));
	const uses = $derived(apiUses(model));
	const hostOf = (api: string) => {
		for (const [id, r] of rails)
			if (r.groups.some((g) => g.apis.includes(api))) return boxById.get(id);
	};
	/** The box drawn for `b`: itself, or the nearest shown box round it while it is hidden. */
	const shownBox = (b: LandscapeBox) => {
		let s = b;
		while (s.parentId && !open.has(s.parentId)) s = boxById.get(s.parentId)!;
		return s;
	};

	// ------------------------------------------------------------ connections
	/** The key entry each kind of connection is listed and hidden under. */
	const KEY_OF: Record<LinkKind, string> = {
		ref: 'ref',
		body: 'ref',
		model: 'model',
		from: 'from',
		reads: 'reads',
		writes: 'writes',
		calls: 'calls',
		handles: 'calls'
	};
	/** The colour token of each kind of line. */
	const LINK_TOKEN: Record<LinkKind, string> = {
		ref: 'ref',
		body: 'ref',
		model: 'ref',
		from: 'from',
		reads: 'ref',
		writes: 'write',
		calls: 'call',
		handles: 'call'
	};

	/** A box looked at, or a row or api in it. */
	type Look = { box: string; leaf?: string } | null;
	/** The row or api under the pointer. */
	const hoveredRow = $derived<Look>(
		view.hover ? { box: view.hover.box, leaf: view.hover.field } : null
	);
	/** The card or name bar under the pointer, also while a row of it is. */
	const hoveredBox = $derived<Look>(view.hoverBox ? { box: view.hoverBox } : null);
	/** What is clicked. */
	const picked = $derived.by((): Look => {
		const host = view.api ? hostOf(view.api) : undefined;
		if (view.api && host) return { box: host.id, leaf: view.api };
		if (view.field) return { box: view.field.box, leaf: view.field.field };
		if (view.selectedNodes[0]) return { box: view.selectedNodes[0] };
		return null;
	});
	/**
	 * What is looked at: a row or api under the pointer, else a card or name bar, else what is
	 * clicked. A row or api focuses its own connections (with the hovered field of a picked
	 * api's shape); a box those of everything in it.
	 */
	const focus = $derived(hoveredRow ?? hoveredBox ?? picked);

	/** One end of a lit line: the node and handle it ends on, and where that is. */
	interface End {
		leaf: string;
		/** The box the leaf is drawn in; `node` unless that is hidden. */
		home: LandscapeBox;
		node: LandscapeBox;
		/** `row:<id>`, `api:<id>` or `head`. */
		anchor: string;
		/** The node's left and right edges and the anchor's height, in canvas px. */
		x0: number;
		x1: number;
		y: number;
		/** Ends on the box round the leaf, so that is outlined. */
		peer: boolean;
	}

	/** Where a leaf drawn in box `home` ends a line: its row, its rail row, or a shown box. */
	function endOf(leaf: string, home: LandscapeBox): End | undefined {
		const api = apiOf(model, leaf);
		if (api) {
			const host = hostOf(api);
			const r = host && rails.get(host.id);
			if (!host || !r) return undefined;
			const left = host.absX + host.width - r.width / 2;
			// A lit api's rail is listed at any zoom (see `view.full`), so the line ends on its row.
			return {
				leaf: api,
				home,
				node: host,
				anchor: `api:${api}`,
				x0: left,
				x1: left + r.width,
				y: host.absY + r.top + (railRowY(r, api) ?? 0) * r.scale,
				peer: false
			};
		}
		const node = shownBox(home);
		const row = node === home ? rowOf(home, leaf) : -1;
		return {
			leaf,
			home,
			node,
			anchor: row >= 0 ? `row:${leaf}` : 'head',
			x0: node.absX,
			x1: node.absX + node.width,
			y:
				node.absY +
				(row >= 0
					? rowY(home, row)
					: node.view || cardRows(node)
						? TABLE.head / 2
						: node.height / 2),
			peer: node !== home
		};
	}

	/** The sides two ends leave and enter by: facing each other, or both right when stacked. */
	const sides = (a: { x0: number; x1: number }, b: { x0: number; x1: number }) =>
		b.x0 >= a.x1
			? (['r', 'l'] as const)
			: b.x1 <= a.x0
				? (['l', 'r'] as const)
				: (['r', 'r'] as const);

	// ------------------------------------------------------------ routing
	// In workers, one for what is wanted now and one routing ahead, so routing never holds up
	// input or frames (see route-client.ts).
	const router = new RouteClient(
		new RouteWorker() as unknown as RoutePort,
		new RouteWorker() as unknown as RoutePort,
		wasmUrl
	);
	/** Routing failed: lines run straight between their ends instead. */
	let unrouted = $state(false);
	router.onfail = (error) => {
		console.error('Routing failed:', error);
		unrouted = true;
	};
	$effect(() => () => router.destroy());
	/** Counts routes wanted now coming in, for what reads them to look again. */
	let routedIn = $state(0);
	const routeCame = () => routedIn++;

	/** Boxes lines go round: every shown box but an open one, with its rail; open boxes' rails. */
	const obstacles = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and returned whole
		const out = new Map<string, Rect>();
		for (const b of boxes) {
			if (open.has(b.id) || (b.parentId && !open.has(b.parentId))) continue;
			const r = rails.get(b.id);
			out.set(b.id, {
				x0: b.absX,
				y0: b.absY,
				x1: b.absX + b.width + (r ? r.width / 2 : 0),
				y1: b.absY + b.height
			});
		}
		for (const [id, r] of rails) {
			if (!open.has(id)) continue;
			const b = boxById.get(id)!;
			const x0 = b.absX + b.width - r.width / 2;
			const y0 = b.absY + r.top;
			out.set(`rail:${id}`, { x0, y0, x1: x0 + r.width, y1: y0 + r.height });
		}
		return out;
	});

	/**
	 * Where a line ends for the router: on the box or rail it sits on, by whichever side routes
	 * best (`only` if given; an api on a closed box's rail its outer side), or on side `side` of
	 * an open box.
	 */
	function routeEnd(
		e: { node: LandscapeBox; anchor: string; x0: number; x1: number; y: number },
		side: Side,
		only?: Side
	): RouteEnd {
		const end = { x0: e.x0, x1: e.x1, y: e.y };
		const rail = `rail:${e.node.id}`;
		const api = e.anchor.startsWith('api:');
		const on = api && obstacles.has(rail) ? rail : e.node.id;
		if (!obstacles.has(on)) return { ...end, sides: [side] };
		return { ...end, on, sides: only ? [only] : api && on === e.node.id ? ['r'] : ['l', 'r'] };
	}

	interface LitLine {
		id: string;
		kind: LinkKind;
		/** The end that depends on the other. */
		s: End;
		t: End;
		sides: readonly ['l' | 'r', 'l' | 'r'];
	}

	/**
	 * The focused connections, one hop each way, each to wherever its other end is: its row if
	 * that shows, else the shown box round it. For a box, those with an end outside it; a card
	 * keeps lineage between its own rows, drawn round its right side.
	 */
	function linesOf(focus: Look): LitLine[] {
		const f = focus && boxById.get(focus.box);
		if (!focus || !f) return [];
		const leaves = focus.leaf
			? new Set([focus.leaf, ...(focus.leaf === view.api && view.apiField ? [view.apiField] : [])])
			: new Set(within(boxes, f.id).flatMap((b) => [...(leavesBy.get(b.id) ?? [])]));
		const inside = within(boxes, f.id);
		const homeIn = (leaf: string) =>
			apiOf(model, leaf)
				? homeOf(model, boxes, f, leaf)
				: inside.find((b) => leavesBy.get(b.id)?.has(leaf));
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and returned whole
		const out = new Map<string, LitLine>();
		for (const e of shownEdges) {
			const fromIn = leaves.has(e.from);
			const toIn = leaves.has(e.to);
			if ((!fromIn && !toIn) || (!focus.leaf && f.group && fromIn && toIn)) continue;
			const [mine, theirs] = fromIn ? [e.from, e.to] : [e.to, e.from];
			const mineHome = homeIn(mine);
			const theirHome = mineHome && homeOf(model, boxes, mineHome, theirs);
			const a = mineHome && endOf(mine, mineHome);
			const b = theirHome && endOf(theirs, theirHome);
			if (!a || !b) continue;
			const [s, t] = fromIn ? [a, b] : [b, a];
			const sameCard = s.node === t.node;
			// One box: only two of a card's rows are joined.
			if (
				sameCard &&
				(s.anchor === t.anchor || !s.anchor.startsWith('row:') || !t.anchor.startsWith('row:'))
			)
				continue;
			const id = `${e.kind}|${s.node.id}|${s.anchor}|${t.node.id}|${t.anchor}`;
			if (!out.has(id))
				out.set(id, { id, kind: e.kind, s, t, sides: sameCard ? ['r', 'r'] : sides(s, t) });
		}
		return [...out.values()];
	}
	// Each look's lines, so moving between the rows of a card reroutes only the row's.
	const rowLines = $derived(linesOf(hoveredRow));
	const boxLines = $derived(linesOf(hoveredBox));
	const pickedLines = $derived(linesOf(picked));
	const lit = $derived(hoveredRow ? rowLines : hoveredBox ? boxLines : pickedLines);

	// ------------------------------------------------------------ hover
	// What the pointer is over, as enter and leave events tell: a row or api, and a card or name
	// bar. The view state gets it once a frame, so leaving one row for the next is one change,
	// never a moment on the card between them that lights (and routes) all of the card's lines.
	// Nor while the view pans or zooms, when everything slides under the pointer: then it gets
	// what the pointer is over once the view rests.
	let overRow: FieldRef | null = null;
	let overBox: string | null = null;
	let moving = false;
	let hoverFrame = 0;
	function hoverLater() {
		hoverFrame ||= requestAnimationFrame(hoverNow);
	}
	function hoverNow() {
		hoverFrame = 0;
		if (moving) return;
		if (overRow?.box !== view.hover?.box || overRow?.field !== view.hover?.field)
			view.hover = overRow;
		if (overBox !== view.hoverBox) view.hoverBox = overBox;
	}
	/** The pointer went onto row `ref` (a row, an api, or an inspector entry), or off it. */
	function hoverRow(ref: FieldRef, on: boolean) {
		if (on) overRow = ref;
		else if (overRow?.box === ref.box && overRow.field === ref.field) overRow = null;
		hoverLater();
	}

	function onfield(box: string, field: string, ev: 'enter' | 'leave' | 'click') {
		if (ev !== 'click') hoverRow({ box, field }, ev === 'enter');
		else {
			const same = view.field?.box === box && view.field.field === field;
			view.field = same ? null : { box, field };
			view.api = null;
			view.apiField = null;
			view.selectedNodes = [];
		}
	}

	function railView(id: string) {
		const r = rails.get(id);
		if (!r) return undefined;
		return {
			top: r.top,
			width: r.width,
			height: r.height,
			scale: r.scale,
			methodWidth: r.methodWidth,
			groups: r.groups.map((g) => ({
				title: g.title,
				apis: g.apis.map((a) => {
					const def = el(a)!.def;
					return {
						id: a,
						name: el(a)!.name,
						method: def.method ?? '',
						path: def.path ?? '',
						y: railRowY(r, a) ?? 0
					};
				})
			}))
		};
	}

	/** Zooms in on a closed rail until its rows read, centred on it. */
	function openRail(id: string) {
		const b = boxById.get(id);
		const r = rails.get(id);
		if (!b || !r) return;
		const zoom = Math.max(viewport.current.zoom, (READABLE / (RAIL.font * r.scale)) * 1.05);
		flow.setCenter(b.absX + b.width, b.absY + r.top + r.height / 2, { zoom, duration: 600 });
	}

	// Boxes the picked api's bodies use, outlined with the parts using them, and the rows a
	// trimmed body leaves out, dimmed. A model in a hidden box outlines the box that shows.
	$effect(() => {
		const host = view.api ? hostOf(view.api) : undefined;
		const parts: Record<string, string[]> = {};
		const kept: Record<string, Set<string> | 'all'> = {};
		if (view.api && host)
			for (const u of bodyModels(model, view.api)) {
				const t = linkTarget(model, boxes, host, u.model);
				if (!t) continue;
				const s = shownBox(t);
				const label = partLabel(u.part);
				if (!(parts[s.id] ??= []).includes(label)) parts[s.id].push(label);
				const k = kept[s.id];
				if (!u.fields || u.fields.length === (s.fields?.length ?? 0) || k === 'all')
					kept[s.id] = 'all';
				else kept[s.id] = new Set([...(k ?? []), ...u.fields]);
			}
		const dim: Record<string, Record<string, true>> = {};
		for (const [id, k] of Object.entries(kept)) {
			if (k === 'all') continue;
			for (const f of boxById.get(id)?.fields ?? [])
				if (!k.has(f.id)) (dim[id] ??= {})[f.id] = true;
		}
		view.apiBoxes = parts;
		view.apiDim = dim;
	});

	function onapi(api: string) {
		view.api = view.api === api ? null : api;
		view.apiField = null;
		view.field = null;
		view.trail = [];
		view.selectedNodes = [];
	}

	// Rows to light, by box: the focused row, and the rows at the ends of its lines; apis on
	// rails likewise. Nodes read them from the view state, so focus changes never rebuild them.
	// An end on a box round its leaf outlines that box. Every box looked at, picked or played,
	// and every box its lines end on, is drawn in full at any zoom. That holds for the hovered
	// card and the pick while a row's lines are lit too, so hovering the rows of a card never
	// closes the boxes the card or the pick reach.
	$effect(() => {
		const out: Record<string, Record<string, Hot>> = {};
		const apis: Record<string, true> = {};
		const peers: Record<string, true> = {};
		const full: Record<string, true> = {};
		const draw = (box: string | undefined) => box && (full[box] = true);
		const RANK: Record<Hot, number> = { self: 3, peer: 2, caller: 1 };
		const mark = (box: string, field: string, how: Hot) => {
			const rows = (out[box] ??= {});
			if (!rows[field] || RANK[how] > RANK[rows[field]]) rows[field] = how;
		};
		draw(focus?.box);
		draw(hoveredBox?.box);
		draw(view.field?.box);
		draw(view.api ? hostOf(view.api)?.id : undefined);
		view.selectedNodes.forEach(draw);
		for (const l of [...boxLines, ...pickedLines]) for (const end of [l.s, l.t]) draw(end.node.id);
		if (focus?.leaf) mark(focus.box, focus.leaf, 'self');
		for (const l of lit)
			for (const end of [l.s, l.t]) {
				draw(end.node.id);
				if (end.peer) peers[end.node.id] = true;
				if (end.anchor.startsWith('api:')) apis[end.leaf] = true;
				else if (end.anchor.startsWith('row:')) mark(end.node.id, end.leaf, 'peer');
			}
		// The current step of a run: the unit taking it, and the other end.
		if (step) {
			const ends = endsOf(step);
			for (const [id, e, how] of [
				[step.from, ends.from, 'self'],
				[step.to, ends.to, 'peer']
			] as const) {
				if (!e) continue;
				const shown = shownBox(e.box);
				if (e.api) {
					apis[e.api] = true;
					draw(hostOf(e.api)?.id);
				} else {
					draw(shown.id);
					if (shown !== e.box || e.row === undefined) peers[shown.id] = true;
					else mark(e.box.id, id, how);
				}
			}
			// The units stepped into calls from keep an edge on their rows, to show where Out goes.
			for (const id of step.frame.slice(0, -1)) {
				const e = playEndOf(id, undefined);
				if (e?.row !== undefined) mark(e.box.id, id, 'caller');
			}
		}
		view.hot = out;
		view.hotApis = apis;
		view.peerBoxes = peers;
		view.full = full;
	});

	$effect(() => {
		const counts = Object.fromEntries(
			[...model.fields.keys()].map((id) => [
				id,
				{
					ref: incomingCount(rels, id, 'ref'),
					from: incomingCount(rels, id, 'from'),
					api: incomingCount(rels, id, 'api')
				}
			])
		);
		nodes = boxes.map((b) => {
			const info = el(b.elementId)!;
			return {
				id: b.id,
				type: 'landscape',
				position: { x: b.x, y: b.y },
				parentId: b.parentId,
				width: b.width,
				height: b.height,
				draggable: false,
				connectable: false,
				class: open.has(b.id) ? 'open' : undefined,
				data: {
					name: info.name,
					element: b.elementId,
					// A closed boundary reads as the model it is drawn round; a root module is a system.
					kind: b.boundary
						? 'model'
						: info.def.kind === 'module' && !info.parentId
							? 'system'
							: info.def.kind,
					group: b.group,
					owner: b.ref ? el(info.parentId ?? '')?.name : undefined,
					fields: b.fields,
					foldAt: b.foldAt,
					indexes: b.view === 'table' ? info.def.indexes : undefined,
					table: b.table,
					logic: b.logic,
					triggers: b.triggers,
					view: b.view,
					labels: Object.fromEntries(
						(b.fields ?? [])
							.flatMap((f) => [f.ref, f.model, ...(f.from ?? [])])
							.flatMap((id) => {
								const label = id && refLabel(model, id);
								return label ? [[id, label]] : [];
							})
					),
					incoming: counts,
					state: view,
					onfield: (field, ev) => onfield(b.id, field, ev),
					open: open.has(b.id),
					onbox: (ev) => {
						if (ev === 'enter') overBox = b.id;
						else if (overBox === b.id) overBox = null;
						hoverLater();
					},
					rail: railView(b.id),
					onapi,
					onrail: () => openRail(b.id),
					onmenu: editing ? (target, x, y) => (menu = { target, x, y }) : undefined
				} satisfies LandscapeNodeData
			};
		});
		// A new layout or focus is fitted; leaving a focus or stopping goes back to where the view
		// was.
		if ((fittedTo !== settings.layout || fittedFocus !== focusKey) && boxes.length) {
			const keep = keepCamera;
			keepCamera = false;
			fittedTo = settings.layout;
			fittedFocus = focusKey;
			if (!keep) {
				fitting = true;
				requestAnimationFrame(() =>
					requestAnimationFrame(() => {
						if (playing) fitRun();
						else void flow.fitView({ padding: 0.08 }).then(() => (ready = true));
						fitting = false;
					})
				);
			}
		}
	});

	// At rest only who talks to whom: calls, handles, reads and writes. Keys, holds, lineage
	// and bodies light up on hover.
	const rest = $derived(
		restLines(
			model,
			boxes,
			shownEdges.filter((e) => ['calls', 'handles', 'reads', 'writes'].includes(e.kind))
		)
	);

	/** A box's name bar as a line end: a card's bar, or the middle of any other box. */
	const headEnd = (b: LandscapeBox) => ({
		node: b,
		anchor: 'head',
		x0: b.absX,
		x1: b.absX + b.width,
		y: b.absY + (b.view || cardRows(b) ? TABLE.head / 2 : b.height / 2)
	});

	// Lines at rest and lit lines are routed apart, so a hover never moves the lines at rest.
	// Each is drawn once routed, never first along a makeshift path.
	const restWant = $derived.by(() => {
		const lines = rest.map((l) => {
			const a = headEnd(boxById.get(l.source)!);
			const b = headEnd(boxById.get(l.target)!);
			const [ss, ts] = sides(a, b);
			return { id: l.id, s: routeEnd(a, ss), t: routeEnd(b, ts) };
		});
		// Lines at rest leaving a box together share one exit (see the design's Routing rule).
		return { lines, key: routeKey(lines, true) };
	});
	const restRoutes = $derived.by(() => {
		void routedIn;
		return router.get(obstacles, restWant.key);
	});
	$effect(() => {
		const { key, lines } = restWant;
		router.want(obstacles, key, lines, true, 'rest', routeCame);
	});

	/** Lit lines as the router takes them. */
	const routeLinesOf = (lines: LitLine[]): RouteLine[] =>
		lines.map((l) => {
			const sameCard = l.s.node === l.t.node;
			return {
				id: l.id,
				s: routeEnd(l.s, l.sides[0], sameCard ? 'r' : undefined),
				t: routeEnd(l.t, l.sides[1], sameCard ? 'r' : undefined)
			};
		});
	// Lit lines are mostly routed ahead (below). Those that are not are routed before anything
	// else and drawn when they come, a moment after the rows they join light up.
	const litWant = $derived.by(() => {
		const lines = routeLinesOf(lit);
		return { lines, key: routeKey(lines) };
	});
	const litRoutes = $derived.by(() => {
		void routedIn;
		return router.get(obstacles, litWant.key);
	});
	$effect(() => {
		const { key, lines } = litWant;
		router.want(obstacles, key, lines, false, 'lit', routeCame);
	});

	/** The view's centre on the canvas. */
	function viewCentre() {
		const { x, y, zoom } = viewport.current;
		return { x: (cw / 2 - x) / zoom, y: (ch / 2 - y) / zoom };
	}
	/** Everything that can be looked at, with its lit lines: every box, row and api. */
	function looksAhead(): RouteAhead[] {
		const out: RouteAhead[] = [];
		const add = (look: Look, x: number, y: number) =>
			out.push({ x, y, lines: () => routeLinesOf(linesOf(look)) });
		for (const b of boxes) {
			const x = b.absX + b.width / 2;
			add({ box: b.id }, x, b.absY + b.height / 2);
			const n = b.fields?.length ?? 0;
			const rows = cardRows(b) ?? b.fields?.slice(0, shownRows(n, !!view.expanded[b.id], b.foldAt));
			rows?.forEach((r, i) => add({ box: b.id, leaf: r.id }, x, b.absY + rowY(b, i)));
		}
		for (const [id, r] of rails) {
			const b = boxById.get(id)!;
			const x = b.absX + b.width;
			for (const a of r.groups.flatMap((g) => g.apis))
				add({ box: id, leaf: a }, x, b.absY + r.top + (railRowY(r, a) ?? 0) * r.scale);
		}
		return out;
	}
	// After each layout, and whenever the lines lit by looking at something may end elsewhere
	// (a card folded or expanded, a kind of line hidden, an api picked), the lit lines of
	// everything that can be looked at are routed ahead, those nearest the view first. What is
	// routed already is not routed again.
	$effect(() => {
		void shownEdges;
		void view.expanded;
		void view.api;
		void view.apiField;
		const among = obstacles;
		untrack(() => router.ahead(among, looksAhead(), viewCentre()));
	});

	/** A line at rest: grey, on the two boxes' name bars, wider the more it merges. */
	function restEdge(l: RestLine, dim: boolean) {
		const [ss, ts] = sides(headEnd(boxById.get(l.source)!), headEnd(boxById.get(l.target)!));
		const only = (ks: LinkKind[]) => l.kinds.every((k) => ks.includes(k));
		const pattern = only(['calls', 'handles']) ? 'calls' : '';
		return {
			id: `rest:${l.id}`,
			source: l.source,
			target: l.target,
			sourceHandle: `head:${ss}`,
			targetHandle: `head:${ts}`,
			type: 'connection',
			// Svelte Flow adds this to the higher level of the two boxes, so the line sits under
			// them, over the box they share.
			zIndex: -1,
			data: {
				points: restRoutes?.get(l.id),
				title: `${l.count} connection${l.count > 1 ? 's' : ''}: ${l.kinds.map((k) => KIND_NAME[k]).join(', ')}`
			},
			class: ['conn rest', pattern, l.count >= 10 ? 'w3' : l.count > 1 ? 'w2' : 'w1', dim && 'dim']
				.filter(Boolean)
				.join(' '),
			markerEnd: 'sdv-arrow-rest'
		};
	}

	/** A lit line: in its kind's colour, over the cards, from row to row where they show. */
	function litEdge(l: LitLine) {
		const token = LINK_TOKEN[l.kind];
		return {
			id: `lit:${l.id}`,
			source: l.s.node.id,
			target: l.t.node.id,
			sourceHandle: `${l.s.anchor}:${l.sides[0]}`,
			targetHandle: `${l.t.anchor}:${l.sides[1]}`,
			type: 'connection',
			zIndex: 1000,
			data: { points: litRoutes?.get(l.id) },
			class: `conn lit ${l.kind}`,
			...(l.kind === 'model'
				? { markerStart: `sdv-diamond-${token}` }
				: { markerEnd: `sdv-arrow-${token}` })
		};
	}

	$effect(() => {
		edges = [
			...(restRoutes || unrouted ? rest.map((l) => restEdge(l, !!focus)) : []),
			...(litRoutes || unrouted ? lit.map(litEdge) : [])
		];
	});

	/** Arrowheads and diamonds, grey for lines at rest and in each kind's colour when lit. */
	const MARKS = [
		['rest', 'var(--sdv-edge)'],
		...['ref', 'from', 'write', 'call'].map((t) => [t, `var(--sdv-link-${t})`])
	];
	/** Line ends are 10px on screen. */
	const mark = $derived(10 / viewport.current.zoom);

	/** The key's line entries; each hides its kinds when clicked (see `KEY_OF`). */
	const KEY_LINES: {
		id: string;
		label: string;
		token: string;
		dash?: string;
		diamond?: boolean;
	}[] = [
		{ id: 'ref', label: 'Refers to, api body uses', token: 'ref' },
		{ id: 'model', label: 'Holds', token: 'ref', diamond: true },
		{ id: 'from', label: 'Derives from', token: 'from', dash: '4 3' },
		{ id: 'reads', label: 'Reads', token: 'ref' },
		{ id: 'writes', label: 'Writes', token: 'write' },
		{ id: 'calls', label: 'Calls, handled by', token: 'call', dash: '1.5 2.5' }
	];

	/** What an end shows: an api by method and path, else its name. */
	function endName(end: End) {
		const def = el(end.leaf)?.def;
		if (def?.kind === 'api') return `${def.method} ${def.path}`;
		return refLabel(model, end.leaf) ?? el(end.leaf)?.name ?? end.leaf;
	}

	/**
	 * Lit lines' ends off the canvas: a wedge on its edge, on the way from the centre to the
	 * end and pointing at it. Clicking it flies there.
	 */
	const wedges = $derived.by(() => {
		const { x: vx, y: vy, zoom } = viewport.current;
		const cx = cw / 2;
		const cy = ch / 2;
		const inset = 16;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and returned whole
		const out = new Map<
			string,
			{ key: string; x: number; y: number; angle: number; kind: LinkKind; end: End; name: string }
		>();
		for (const l of lit) {
			const route = litRoutes?.get(l.id);
			for (const [end, side, at] of [
				[l.s, l.sides[0], route?.[0]],
				[l.t, l.sides[1], route?.at(-1)]
			] as const) {
				// Where the line ends: as routed, or on the side it would leave by.
				const px = (at?.x ?? (side === 'l' ? end.x0 : end.x1)) * zoom + vx;
				const py = end.y * zoom + vy;
				const key = `${end.node.id}|${end.anchor}`;
				if ((px >= 0 && px <= cw && py >= 0 && py <= ch) || out.has(key)) continue;
				const dx = px - cx;
				const dy = py - cy;
				const k = Math.min(Math.abs((cx - inset) / dx), Math.abs((cy - inset) / dy));
				out.set(key, {
					key,
					x: cx + dx * k,
					y: cy + dy * k,
					angle: (Math.atan2(dy, dx) * 180) / Math.PI,
					kind: l.kind,
					end,
					name: endName(end)
				});
			}
		}
		return [...out.values()];
	});

	/** Flies to a line's end: its row, or the box it ends on. */
	function goEnd(end: End) {
		if (end.anchor.startsWith('row:')) flyTo({ box: end.home, field: end.leaf });
		else flyTo({ box: end.node });
	}

	/** What each kind is called in the key and a line's hover text. */
	const KIND_NAME: Record<LinkKind, string> = {
		ref: 'refers to',
		body: 'api body uses',
		model: 'holds',
		from: 'derives from',
		reads: 'reads',
		writes: 'writes',
		calls: 'calls',
		handles: 'handled by'
	};

	// ------------------------------------------------------------ inspector
	/** Where a card sits: its enclosing entities, outermost first, boundaries skipped. */
	function whereOf(b: LandscapeBox): string {
		const names: string[] = [];
		for (
			let p = b.parentId && boxById.get(b.parentId);
			p;
			p = p.parentId && boxById.get(p.parentId)
		)
			if (!p.boundary) names.unshift(el(p.elementId)?.name ?? p.elementId);
		return names.join(' › ') + (b.view === 'table' ? ' · stored' : '');
	}

	interface Entry {
		text: string;
		where: string;
		target?: { box: LandscapeBox; field?: string };
		/** An api using the field; clicking it picks the api. */
		api?: string;
	}

	/** An element's enclosing entities and itself, outermost first. */
	function pathOf(id: string | undefined): string {
		const names: string[] = [];
		for (let e = id ? el(id) : undefined; e; e = e.parentId ? el(e.parentId) : undefined)
			names.unshift(e.name);
		return names.join(' › ');
	}

	const apiEntry = (u: ApiUse): Entry => {
		const a = el(u.api)!;
		const via = u.via ? model.apiFields.get(u.via)?.def.name : undefined;
		return {
			text: `${a.def.method} ${a.def.path} · ${partLabel(u.part)}${via ? `.${via}` : ''}`,
			where: `${a.name} · ${via ? 'own shape, keeps its own name' : 'the model itself, so a rename changes it'}`,
			api: u.api
		};
	};

	/** An api a unit handles or calls; clicking it picks the api. */
	const routeEntry = (id: string): Entry => {
		const a = el(id)!;
		return {
			text: `${a.def.method} ${a.def.path}`,
			where: `${a.name} · ${pathOf(a.parentId)}`,
			api: id
		};
	};

	interface Section {
		label: string;
		/** Colours the glyphs and hover: ref, from, writes or calls. */
		kind: string;
		glyph: string;
		entries: Entry[];
		note?: string;
	}

	/** A field's card: what it refers to, holds, comes from, and what uses it. */
	function fieldCardOf(
		f: FieldRef | null
	): { title: string; type: string; sections: Section[] } | undefined {
		const b = f && boxById.get(f.box);
		const info = f && model.fields.get(f.field);
		if (!f || !b || !info) return undefined;
		const entry = (to: string): Entry => {
			if (isApiEl(to)) return routeEntry(to);
			const t = linkTarget(model, boxes, b, to);
			return {
				text: isUnit(to) ? el(to)!.name : label(to),
				where: t ? whereOf(t) : 'not drawn',
				target: t && { box: t, field: rowOf(t, to) >= 0 ? to : undefined }
			};
		};
		const outOf = (kind: FieldLink['kind']) =>
			(rels.out.get(f.field) ?? []).filter((l) => l.kind === kind).map((l) => entry(l.to));
		const inOf = (kind: FieldLink['kind']) =>
			(rels.in.get(f.field) ?? []).filter((l) => l.kind === kind).map((l) => entry(l.field));
		// Units touching the field: by naming it, or its whole model.
		const touchedBy = (kind: 'reads' | 'writes') => [
			...inOf(kind),
			...(rels.in.get(info.modelId) ?? [])
				.filter((l) => l.kind === kind)
				.map((l) => ({ ...entry(l.field), where: `${entry(l.field).where} · whole model` }))
		];
		const def = info.def;
		return {
			title: `${el(info.modelId)?.name}.${def.name}`,
			type: typeText(def, (id) => refLabel(model, id)),
			// Glyphs point at what depends on what: → this field on the entry, ← the entry on
			// this field; dashed for lineage.
			sections: [
				{ label: 'References', kind: 'ref', glyph: '→', entries: outOf('ref') },
				{ label: 'Holds', kind: 'model', glyph: '◆', entries: outOf('model') },
				{
					label: 'Source',
					kind: 'from',
					glyph: '⇢',
					entries: outOf('from'),
					note: def.derived
				},
				{ label: 'Referenced by', kind: 'ref', glyph: '←', entries: inOf('ref') },
				{ label: 'Feeds', kind: 'from', glyph: '⇠', entries: inOf('from') },
				{
					label: 'Fed by apis',
					kind: 'from',
					glyph: '⇢',
					entries: (uses.fedBy.get(f.field) ?? []).map(apiEntry)
				},
				{
					label: 'Returned by apis',
					kind: 'from',
					glyph: '⇠',
					entries: (uses.returnedBy.get(f.field) ?? []).map(apiEntry)
				},
				{ label: 'Read by logic', kind: 'ref', glyph: '←', entries: touchedBy('reads') },
				{ label: 'Written by logic', kind: 'writes', glyph: '←', entries: touchedBy('writes') }
			].filter((s) => s.entries.length)
		};
	}
	const inspector = $derived(fieldCardOf(view.field));

	/**
	 * The clicked logic unit: its inputs, outputs and fails, and its steps as a sequence. What
	 * it handles, reads, writes and calls is all in the sequence, so it is not listed again.
	 */
	function unitCardOf(id: string | undefined) {
		const u = id && isUnit(id) ? el(id) : undefined;
		if (!u) return undefined;
		const typeOf = (x: LogicField) =>
			[
				typeText(x, (id) => refLabel(model, id)),
				x.required && 'required',
				x.nullable && 'nullable',
				x.description
			]
				.filter(Boolean)
				.join(' · ');
		return {
			title: u.name,
			sub: `Logic unit · ${pathOf(u.parentId)}`,
			inputs: (u.def.inputs ?? []).map((x) => ({ name: x.name, type: typeOf(x) })),
			outputs: (u.def.outputs ?? []).map((x) => ({ name: x.name, type: typeOf(x) })),
			fails: u.def.fails ?? [],
			seq: u.def.steps?.length ? sequenceOf(model, u.id) : undefined
		};
	}
	const unitCard = $derived(unitCardOf(view.field?.field));

	/**
	 * The clicked trigger: its schedule in words and as written, its next runs, how a run
	 * behaves, and the units it starts.
	 */
	function triggerCardOf(id: string | undefined, near: LandscapeBox | undefined) {
		const t = id && isTrigger(id) ? el(id) : undefined;
		if (!t || !near) return undefined;
		const d = t.def;
		const s = d.schedule ?? {};
		const zone = s.cron !== undefined || s.at !== undefined ? `, ${s.tz ?? 'UTC'}` : '';
		const written = s.cron ?? (s.every !== undefined ? `every ${s.every}` : `at ${s.at}`);
		const next = nextRuns(s, 3);
		const gate = d.when && el(d.when.flag);
		const OVERLAP = {
			skip: 'skip a run due while one is going',
			queue: 'queue a run due while one is going',
			allow: 'let runs overlap'
		};
		const row = (label: string, text: string | undefined, mono = false) =>
			text === undefined ? [] : [{ label, text, mono }];
		return {
			title: t.name,
			sub: `Trigger · ${pathOf(t.parentId)}`,
			schedule: [
				...row('When', scheduleWords(s) + zone),
				...row('As written', s.cron !== undefined ? `cron ${written}` : written, true),
				...row('Next', next.length ? next.join(' · ') : undefined)
			],
			run: [
				...row('Overlap', OVERLAP[d.overlap ?? 'skip']),
				...row('Timeout', d.timeout && durationWords(d.timeout)),
				...row('Retries', d.retries?.toString()),
				...row('With', d.with),
				...row('Exists when', gate ? `${gate.name} is ${d.when!.is}` : undefined)
			],
			handledBy: (rels.in.get(t.id) ?? [])
				.filter((l) => l.kind === 'handles')
				.map((l) => {
					const b = linkTarget(model, boxes, near, l.field);
					return {
						id: l.field,
						text: el(l.field)!.name,
						where: pathOf(el(l.field)!.parentId),
						target: b && { box: b, field: l.field }
					};
				})
		};
	}
	const triggerCard = $derived(
		triggerCardOf(view.field?.field, view.field ? boxById.get(view.field.box) : undefined)
	);

	/** What a sequence drawn in a card on `from` names: an api, a unit's row or a model. */
	function seqAt(id: string, from: LandscapeBox | undefined): PeekAt | undefined {
		if (isApiEl(id)) return { api: id };
		const t = from && linkTarget(model, boxes, from, id);
		return t && { target: { box: t, field: rowOf(t, id) >= 0 ? id : undefined } };
	}

	const statusClass = (s: number) => (s < 300 ? 'ok' : s < 400 ? '' : s < 500 ? 'warn' : 'bad');

	/** The picked api, for the card beside its rail row. */
	function apiCardOf(id: string | null) {
		const a = id ? el(id) : undefined;
		const host = id ? hostOf(id) : undefined;
		if (!a || !host) return undefined;
		const names = (ids: string[]) =>
			ids.map((id) => model.fields.get(id)?.def.name ?? id).join(', ');
		const d = a.def;
		const bodies = apiBodies(d).map(({ part, body }) => {
			const t = body.model ? linkTarget(model, boxes, host, body.model) : undefined;
			return {
				part,
				status: typeof part === 'number' ? part : undefined,
				description: 'description' in body ? (body.description as string | undefined) : undefined,
				model: body.model && {
					text: label(body.model) + (body.many ? '[]' : ''),
					note: body.omit
						? `without ${names(body.omit)}`
						: body.pick
							? `only ${names(body.pick)}`
							: t
								? whereOf(t)
								: 'not drawn',
					target: t && { box: t }
				},
				many: !!body.many && !!body.fields,
				fields: (body.fields ?? []).map((f) => {
					const links = (part === 'request' ? f.to : f.from) ?? [];
					return {
						id: f.id,
						name: f.name + (f.required ? '' : '?'),
						type: typeText(f, (id) => refLabel(model, id)),
						traced: links.length > 0 || !!f.model,
						title: links.length
							? `${part === 'request' ? 'Goes into' : 'Comes from'} ${links.map(label).join(', ')}${f.derived ? ` · ${f.derived}` : ''}`
							: f.model
								? undefined
								: part === 'request'
									? 'Goes into no model field: add to'
									: 'Comes from no field: add from'
					};
				})
			};
		});
		const units = (kind: 'handles' | 'calls') =>
			(rels.in.get(a.id) ?? [])
				.filter((l) => l.kind === kind)
				.map((l) => {
					const t = linkTarget(model, boxes, host, l.field);
					return {
						id: l.field,
						text: el(l.field)!.name,
						where: pathOf(el(l.field)!.parentId),
						target: t && { box: t, field: l.field }
					};
				});
		return {
			method: d.method ?? '',
			path: d.path ?? '',
			logic: [
				{ label: 'Handled by', entries: units('handles') },
				{ label: 'Called by', entries: units('calls') }
			].filter((s) => s.entries.length),
			sub: [a.name, pathOf(a.parentId), d.auth && `auth: ${d.auth}`].filter(Boolean).join(' · '),
			params: d.params ?? [],
			request: bodies.find((b) => b.part === 'request'),
			responses: bodies.filter((b) => b.part !== 'request')
		};
	}
	const apiCard = $derived(apiCardOf(view.api));

	/** Where the picked api's row is on screen: the rail's edges and the row's middle. */
	const apiAnchor = $derived.by(() => {
		const host = view.api ? hostOf(view.api) : undefined;
		const r = host && rails.get(host.id);
		if (!view.api || !host || !r) return undefined;
		const { x: vx, y: vy, zoom } = viewport.current;
		const left = host.absX + host.width - r.width / 2;
		const row = listed(host.id) ? railRowY(r, view.api) : undefined;
		const y = host.absY + r.top + (row !== undefined ? row * r.scale : r.height / 2);
		return { left: left * zoom + vx, right: (left + r.width) * zoom + vx, y: y * zoom + vy };
	});

	/** Where the clicked row is on screen, or the shown box round it while it is hidden. */
	const fieldAnchor = $derived.by(() => {
		const f = view.field;
		const b = f && boxById.get(f.box);
		if (!f || !b) return undefined;
		const s = shownBox(b);
		const row = s === b ? rowOf(b, f.field) : -1;
		const { x: vx, y: vy, zoom } = viewport.current;
		const y = row >= 0 ? b.absY + rowY(b, row) : s.absY + s.height / 2;
		return { left: s.absX * zoom + vx, right: (s.absX + s.width) * zoom + vx, y: y * zoom + vy };
	});

	const API_W = 320;
	const FIELD_W = 300;
	// The shown card's height, so it is kept inside the canvas.
	let cardH = $state(0);
	// The card folded to its header, so the lines it covers show; the pick stays.
	let cardMin = $state(false);
	$effect(() => {
		void view.field;
		void view.api;
		cardMin = false;
		peek = null;
	});
	/** A card `w` wide right of the anchor, or left of it if it does not fit, level with its row. */
	function beside(a: { left: number; right: number; y: number } | undefined, w: number) {
		if (!a) return undefined;
		const right = a.right + 14;
		// Room on neither side (a wide sequence): over the canvas, centred.
		const left =
			right + w <= cw - 8
				? right
				: a.left - 14 - w >= 8 + panelW
					? a.left - 14 - w
					: Math.max(8 + panelW, (cw + panelW - w) / 2);
		return { left, top: Math.min(Math.max(8, a.y - 24), Math.max(8, ch - cardH - 8)) };
	}
	const cardPos = $derived(beside(apiAnchor, API_W));
	const fieldPos = $derived(beside(fieldAnchor, FIELD_W));
	const unitW = $derived(Math.max(420, unitCard?.seq ? sequenceWidth(unitCard.seq) + 2 : 0));
	const unitPos = $derived(beside(fieldAnchor, unitW));

	// ------------------------------------------------------------ peek
	/** What a card's entry names: an api, a field's or unit's row, or a whole card. */
	interface PeekAt {
		api?: string;
		target?: { box: LandscapeBox; field?: string };
	}
	/**
	 * An entry clicked in the card, shown beside it without moving the camera. `from`: the
	 * entry, marked while its peek is open; `dy`: the entry's height in the card, so the peek
	 * stays level with it as the card moves; `trail`: what the peek showed before, for Back.
	 */
	let peek = $state<{ at: PeekAt; from: string; dy: number; trail: PeekAt[] } | null>(null);
	let peekH = $state(0);
	/** Where in the card the last press was. */
	let pressDy = 0;
	const keyOf = (at: PeekAt) => at.api ?? `${at.target?.box.id}|${at.target?.field ?? ''}`;

	function press(e: PointerEvent) {
		pressDy = e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top;
	}
	/** Shows what an entry of the card names in the peek, or closes it if it shows that. */
	function openPeek(at: PeekAt) {
		const from = keyOf(at);
		peek = peek?.from === from ? null : { at, from, dy: pressDy - 18, trail: [] };
	}
	/** Shows what an entry in the peek names in its place. */
	function peekTo(at: PeekAt) {
		if (peek) peek = { ...peek, at, trail: [...peek.trail, peek.at] };
	}
	function peekBack() {
		const prev = peek?.trail.at(-1);
		if (peek && prev) peek = { ...peek, at: prev, trail: peek.trail.slice(0, -1) };
	}
	/** Flies to what the peek shows and picks it, as a click on the entry did before peeks. */
	function goToPeek() {
		const at = peek?.at;
		peek = null;
		if (at?.api) return showApi(at.api);
		const t = at?.target;
		if (!t) return;
		if (!t.field) {
			unpin();
			view.selectedNodes = [t.box.id];
		}
		view.api = null;
		view.apiField = null;
		flyTo(t);
	}

	/** The card shown: its place on screen and width. */
	const shownCard = $derived(
		(inspector || triggerCard) && fieldPos
			? { ...fieldPos, w: FIELD_W }
			: unitCard && unitPos
				? { ...unitPos, w: cardMin ? FIELD_W : unitW }
				: apiCard && cardPos
					? { ...cardPos, w: API_W }
					: undefined
	);

	/** What the peek shows, drawn as that kind is drawn everywhere else. */
	const peekCard = $derived.by(() => {
		const at = peek?.at;
		if (at?.api) {
			const api = apiCardOf(at.api);
			return api && { kind: 'api' as const, api, w: API_W };
		}
		const t = at?.target;
		if (!t) return undefined;
		if (t.field && isUnit(t.field)) {
			const unit = unitCardOf(t.field);
			return (
				unit && {
					kind: 'unit' as const,
					unit,
					from: t.box,
					w: Math.max(420, unit.seq ? sequenceWidth(unit.seq) + 2 : 0)
				}
			);
		}
		if (t.field && isTrigger(t.field)) {
			const trigger = triggerCardOf(t.field, t.box);
			return trigger && { kind: 'trigger' as const, trigger, w: FIELD_W };
		}
		if (t.field) {
			const field = fieldCardOf({ box: t.box.id, field: t.field });
			return field && { kind: 'field' as const, field, id: t.field, w: FIELD_W };
		}
		// A model or logic card: the canvas's own card, its rows peeking in turn.
		const node = nodes.find((n) => n.id === t.box.id);
		if (!node) return undefined;
		const data: LandscapeNodeData = {
			...(node.data as LandscapeNodeData),
			peek: true,
			onfield: (field, ev) =>
				ev === 'click'
					? peekTo({ target: { box: t.box, field } })
					: hoverRow({ box: t.box.id, field }, ev === 'enter'),
			onbox: undefined,
			onmenu: undefined,
			rail: undefined
		};
		return { kind: 'box' as const, box: t.box, data, w: t.box.width };
	});

	/** Beside the card, right of it, else left of it, else over the canvas's right. */
	const peekPos = $derived.by(() => {
		const c = shownCard;
		const w = peekCard?.w;
		if (!c || !w || !peek) return undefined;
		const right = c.left + c.w + 8;
		const left =
			right + w <= cw - 8
				? right
				: c.left - 8 - w >= 8 + panelW
					? c.left - 8 - w
					: Math.max(8 + panelW, cw - w - 8);
		return { left, top: Math.min(Math.max(8, c.top + peek.dy), Math.max(8, ch - peekH - 8)) };
	});

	/** Picks an api from the inspector and centres on the box owning it. */
	function showApi(id: string) {
		const owner = el(id)?.parentId;
		const box = boxes.find((b) => b.elementId === owner && !b.ref);
		view.field = null;
		view.trail = [];
		view.apiField = null;
		view.api = id;
		if (box) flyTo({ box });
	}

	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * Centres the camera on the target row and picks it. The zoom stays where it is unless the
	 * area round the target would be too small to read, or the card too big for the canvas. The
	 * centre is nudged so the box round the target stays in view.
	 */
	function flyTo(target: { box: LandscapeBox; field?: string }, back = false) {
		const t = target.box;
		const area = (t.parentId && boxById.get(t.parentId)) || t;
		const fill = (b: LandscapeBox) => Math.max(b.width / cw, b.height / ch);
		const zoom = Math.min(Math.max(viewport.current.zoom, 0.8 / fill(area)), 0.92 / fill(t));
		const row = rowOf(t, target.field);
		// A row hidden in a folded card is shown by expanding the card.
		if (t.fields && row >= shownRows(t.fields.length, !!view.expanded[t.id], t.foldAt))
			view.expanded = { ...view.expanded, [t.id]: true };
		// Keep [start, start + size] on a canvas side of `side` pixels, if it fits.
		const keep = (c: number, start: number, size: number, side: number) => {
			const half = side / 2 / zoom;
			return size <= 2 * half ? Math.min(Math.max(c, start + size - half), start + half) : c;
		};
		flow.setCenter(
			keep(t.absX + t.width / 2, area.absX, area.width, cw - panelW) - panelW / 2 / zoom,
			keep(t.absY + (row >= 0 ? rowY(t, row) : t.height / 2), area.absY, area.height, ch),
			{ zoom, duration: 700 }
		);
		overRow = null;
		view.hover = null;
		if (!target.field) return;
		const ref = { box: t.id, field: target.field };
		if (!back && view.field) view.trail = [...view.trail, view.field];
		view.field = ref;
		clearTimeout(flashTimer);
		view.flash = null;
		flashTimer = setTimeout(() => {
			view.flash = ref;
			flashTimer = setTimeout(() => (view.flash = null), 1400);
		}, 700);
	}

	/** Goes to a search hit: frames a system or module, flies to a model or row, picks an api. */
	function pick(hit: Pick<Hit, 'kind' | 'id'>) {
		search.open = false;
		const outside = () => !model.elements.has(hit.id) && !model.fields.has(hit.id);
		if (view.play && outside()) stopPlay();
		if (view.focused && outside()) leaveFocus();
		if (hit.kind === 'api') return showApi(hit.id);
		view.api = null;
		view.apiField = null;
		if (hit.kind === 'system' || hit.kind === 'module') {
			view.field = null;
			view.trail = [];
			const own = boxes.filter((b) => b.elementId === hit.id && !b.ref && !b.boundary);
			const t = own.find((b) => !cardRows(b)) ?? own[0];
			if (!t) return;
			// Half its api rail sits outside its right border.
			const rail = t.apis?.length
				? railOf(model, railGroups(model, t.elementId, t.apis), t.height).width / 2
				: 0;
			const w = t.width + rail;
			const zoom = 0.9 / Math.max(w / cw, t.height / ch);
			flow.setCenter(t.absX + w / 2 - panelW / 2 / zoom, t.absY + t.height / 2, {
				zoom,
				duration: 700
			});
			return;
		}
		const modelId = hit.kind === 'field' ? model.fields.get(hit.id)?.modelId : hit.id;
		const field = hit.kind === 'model' ? undefined : hit.id;
		const fits = (b: LandscapeBox) =>
			hit.kind === 'logic-unit' || hit.kind === 'trigger'
				? !!cardRows(b) && rowOf(b, field) >= 0
				: !!b.view && b.elementId === modelId && (!field || rowOf(b, field) >= 0);
		const box = boxes.find((b) => fits(b) && !b.ref) ?? boxes.find(fits);
		if (box) flyTo({ box, field });
	}

	/**
	 * Shows only a hit and what connects to it. A new focus replaces the current one; the
	 * subject is picked, so its connections are drawn.
	 */
	function focusHit(hit: Hit, mode: FocusMode) {
		search.open = false;
		setFocus({ id: hit.id, mode, depth: 1 });
	}

	function setFocus(next: Focus) {
		if (!view.focused) beforeFocus = view.play ? beforePlay : { ...viewport.current };
		unpin();
		view.play = null;
		beforePlay = undefined;
		view.selectedNodes = [];
		view.expanded = {};
		view.focused = next;
		const id = next.id;
		const field = model.fields.get(id);
		const kind = model.elements.get(id)?.def.kind;
		if (field) {
			const box = boxes.find((b) => b.view && b.elementId === field.modelId && rowOf(b, id) >= 0);
			if (box) view.field = { box: box.id, field: id };
		} else if (kind === 'logic-unit' || kind === 'trigger') {
			const box = boxes.find((b) => rowOf(b, id) >= 0);
			if (box) view.field = { box: box.id, field: id };
		} else if (kind === 'api') view.api = id;
		else {
			const box = boxes.find((b) => b.elementId === id && !b.ref && !b.boundary && !b.logic);
			if (box) view.selectedNodes = [box.id];
		}
	}

	function leaveFocus() {
		unpin();
		view.selectedNodes = [];
		view.expanded = {};
		view.focused = null;
		keepCamera = true;
		if (beforeFocus) flow.setViewport(beforeFocus);
		beforeFocus = undefined;
	}

	/** Goes to anything with an id, as a search hit would: a scenario's change or impact. */
	function goTo(id: string) {
		const kind = el(id)?.def.kind;
		const apiField = model.apiFields.get(id);
		if (apiField) return showApi(apiField.apiId);
		if (kind === 'flag') return;
		if (kind) return pick({ kind, id });
		if (model.fields.has(id)) return pick({ kind: 'field', id });
		const owner = [...model.elements.values()].find((e) =>
			[
				...(e.def.inputs ?? []),
				...(e.def.outputs ?? []),
				...(e.def.params ?? []),
				...(e.def.indexes ?? [])
			].some((x) => x.id === id)
		);
		if (owner && owner.def.kind !== 'flag') pick({ kind: owner.def.kind, id: owner.id });
	}

	// ------------------------------------------------------------ editing a scenario
	/** Right-clicking a field or a model's name bar opens its menu while a scenario is shown. */
	const editing = $derived(changes.editable && changes.mode !== 'before');
	let menu = $state<{ target: string; x: number; y: number } | null>(null);

	/** The Changes or History panel covers the canvas's left; flying centres right of it. */
	const panelW = $derived(changes.panel ? 340 : 0);

	function goBack() {
		const prev = view.trail.at(-1);
		const box = prev && boxById.get(prev.box);
		if (!prev || !box) return;
		view.trail = view.trail.slice(0, -1);
		flyTo({ box, field: prev.field }, true);
	}

	function unpin() {
		peek = null;
		view.api = null;
		view.apiField = null;
		view.field = null;
		view.trail = [];
	}

	// ------------------------------------------------------------ play
	// A unit played step by step: each step moves the camera to where it happens on the board
	// and draws it there as a line between the real elements. Nothing moves on its own.

	/** Kept clear for the player at the bottom of the canvas, in screen px. */
	const PLAYER = 104;
	const run = $derived(
		view.play ? runOf(model, view.play.unit, view.play.choices, new Set(view.play.into)) : undefined
	);
	const playAt = $derived(run && view.play ? Math.min(view.play.at, run.steps.length - 1) : 0);
	const step = $derived(run?.steps[playAt]);
	/** At a call with steps inside not stepped into: what Into goes into, named on the board. */
	const inside = $derived.by(() => {
		if (!step?.into || step.entered) return undefined;
		const n = `${step.intoSteps} step${step.intoSteps === 1 ? '' : 's'} inside`;
		// A called api names the unit handling it.
		return isApiEl(step.to) ? `${el(step.into)!.name} · ${n}` : n;
	});

	/** Where an element a step names is drawn: a card and its row, or an api on a box's rail. */
	interface PlayEnd {
		box: LandscapeBox;
		row?: number;
		api?: string;
	}
	function playEndOf(id: string, near: LandscapeBox | undefined): PlayEnd | undefined {
		if (isApiEl(id)) {
			const owner = boxes.find((b) => b.apis?.includes(id) && !b.ref);
			return owner && { box: owner, api: id };
		}
		const fits = (b: LandscapeBox) => !!b.logic && rowOf(b, id) >= 0;
		const b = isUnit(id)
			? (boxes.find((o) => fits(o) && !o.ref) ?? boxes.find(fits))
			: near && linkTarget(model, boxes, near, id);
		if (!b) return undefined;
		const row = rowOf(b, id);
		return { box: b, row: row >= 0 ? row : undefined };
	}
	/** Both ends of a step; a model is looked for near the unit taking the step. */
	function endsOf(s: PlayStep) {
		const unitBox = playEndOf(s.frame.at(-1)!, undefined)?.box;
		return { from: playEndOf(s.from, unitBox), to: playEndOf(s.to, unitBox) };
	}
	/** An api's rail on its owner's box, as it is drawn once the box shows. */
	const ownRail = (b: LandscapeBox) =>
		railOf(model, railGroups(model, b.elementId, b.apis ?? []), b.height);

	/** An end in canvas px, and the least zoom drawing it readably. */
	function placeOf(e: PlayEnd) {
		const b = e.box;
		if (e.api) {
			const r = ownRail(b);
			const y = b.absY + r.top + (railRowY(r, e.api) ?? r.height / 2) * r.scale;
			return {
				x: b.absX + b.width - r.width / 2,
				w: r.width,
				y,
				zoom: READABLE / (RAIL.font * r.scale)
			};
		}
		const y = e.row !== undefined ? b.absY + rowY(b, e.row) : b.absY + TABLE.head / 2;
		return { x: b.absX, w: b.width, y, zoom: READABLE / TABLE.row };
	}

	/** Kept clear round what the camera brings into view, in screen px. */
	const MARGIN = 56;

	/** Fits the whole run's focus above the player, no further in than 100%. */
	function fitRun() {
		const left = Math.min(...boxes.map((b) => b.absX));
		const top = Math.min(...boxes.map((b) => b.absY));
		// Half an api rail sits outside its box's right border.
		const right = Math.max(
			...boxes.map((b) => b.absX + b.width + (rails.get(b.id)?.width ?? 0) / 2)
		);
		const bottom = Math.max(...boxes.map((b) => b.absY + b.height));
		const zoom = Math.max(
			MIN_ZOOM,
			Math.min(1, (cw - 2 * MARGIN) / (right - left), (ch - PLAYER - 2 * MARGIN) / (bottom - top))
		);
		void flow
			.setViewport({
				x: cw / 2 - ((left + right) / 2) * zoom,
				y: (ch - PLAYER) / 2 - ((top + bottom) / 2) * zoom,
				zoom
			})
			.then(() => {
				ready = true;
				if (step) keepInView(step);
			});
	}

	/**
	 * Brings both ends of a step into view above the player, if they are not: the least pan,
	 * and a zoom out only when they do not fit at this zoom. It never zooms in. When both do not
	 * fit where their rows are drawn, the receiver.
	 */
	function keepInView(s: PlayStep) {
		const { from, to } = endsOf(s);
		const ends = [from, to].filter((e) => !!e);
		if (!ends.length) return;
		// A row hidden in a folded card is shown by expanding the card.
		for (const e of ends)
			if (
				e.box.fields &&
				e.row !== undefined &&
				e.row >= shownRows(e.box.fields.length, !!view.expanded[e.box.id], e.box.foldAt)
			)
				view.expanded = { ...view.expanded, [e.box.id]: true };
		const v = flow.getViewport();
		const h = ch - PLAYER;
		const span = (list: ReturnType<typeof placeOf>[]) => {
			const f = {
				left: Math.min(...list.map((p) => p.x)),
				right: Math.max(...list.map((p) => p.x + p.w)),
				top: Math.min(...list.map((p) => p.y)) - TABLE.rowHeight,
				bottom: Math.max(...list.map((p) => p.y)) + TABLE.rowHeight,
				least: Math.max(...list.map((p) => p.zoom))
			};
			const most = Math.min(
				(cw - 2 * MARGIN) / (f.right - f.left),
				(h - 2 * MARGIN) / (f.bottom - f.top)
			);
			return { ...f, zoom: Math.max(MIN_ZOOM, Math.min(v.zoom, most)) };
		};
		let f = span(ends.map(placeOf));
		if (f.zoom < f.least && to) f = span([placeOf(to)]);
		const z = f.zoom;
		// The least move along one axis that brings [lo, hi] into [MARGIN, size - MARGIN].
		const shift = (lo: number, hi: number, at: number, size: number) =>
			lo * z + at < MARGIN
				? MARGIN - lo * z
				: hi * z + at > size - MARGIN
					? size - MARGIN - hi * z
					: at;
		const next =
			z < v.zoom
				? {
						x: cw / 2 - ((f.left + f.right) / 2) * z,
						y: h / 2 - ((f.top + f.bottom) / 2) * z,
						zoom: z
					}
				: { x: shift(f.left, f.right, v.x, cw), y: shift(f.top, f.bottom, v.y, h), zoom: z };
		if (next.x !== v.x || next.y !== v.y || next.zoom !== v.zoom)
			void flow.setViewport(next, { duration: 400 });
	}
	// Each new step brings its ends into view; panning between steps is free.
	$effect(() => {
		const s = step;
		const at = playAt;
		if (!s || !ready || fitting) return;
		untrack(() => keepInView(s));
		void at;
	});

	/** An end on screen: the edges of what is drawn for it and the height of its row. */
	function screenOf(e: PlayEnd) {
		const { x: vx, y: vy, zoom } = viewport.current;
		const host = e.api ? hostOf(e.api) : undefined;
		const r = host && rails.get(host.id);
		if (e.api && host && r) {
			const left = host.absX + host.width - r.width / 2;
			const row = listed(host.id) ? railRowY(r, e.api) : undefined;
			const y = host.absY + r.top + (row !== undefined ? row * r.scale : r.height / 2);
			return { left: left * zoom + vx, right: (left + r.width) * zoom + vx, y: y * zoom + vy };
		}
		const s = shownBox(e.box);
		const y =
			s !== e.box
				? s.absY + s.height / 2
				: e.row !== undefined
					? e.box.absY + rowY(e.box, e.row)
					: e.box.absY + TABLE.head / 2;
		return { left: s.absX * zoom + vx, right: (s.absX + s.width) * zoom + vx, y: y * zoom + vy };
	}
	const nameOf = (id: string) =>
		isApiEl(id)
			? `${el(id)!.def.method} ${el(id)!.def.path}`
			: isUnit(id)
				? el(id)!.name
				: label(id);

	/** A step's line between its ends, in screen px, with its arrow and where its number goes. */
	function lineOf(s: PlayStep) {
		const ends = endsOf(s);
		if (!ends.from || !ends.to) return undefined;
		const a = screenOf(ends.from);
		const b = screenOf(ends.to);
		let x0, x1, xm;
		if (b.left >= a.right) [x0, x1, xm] = [a.right, b.left, (a.right + b.left) / 2];
		else if (b.right <= a.left) [x0, x1, xm] = [a.left, b.right, (a.left + b.right) / 2];
		else [x0, x1, xm] = [a.right, b.right, Math.max(a.right, b.right) + 28];
		const dir = Math.sign(x1 - xm) || 1;
		const out = Math.sign(xm - x0) || 1;
		return {
			a,
			b,
			x0,
			x1,
			xm,
			d: `M${x0} ${a.y} H${xm} V${b.y} H${x1}`,
			// At the receiver: what the sender depends on, as with every connection.
			arrow: `M${x1} ${b.y} L${x1 - dir * 9} ${b.y - 4.5} L${x1 - dir * 9} ${b.y + 4.5} Z`,
			// Where a past step's number goes, and the current one's, where its line starts.
			num: { x: xm, y: (a.y + b.y) / 2 },
			start: { x: x0 + out * 16, y: a.y }
		};
	}

	/** The current step as drawn on the board, in screen px. */
	const playDraw = $derived.by(() => {
		if (!step) return undefined;
		const line = lineOf(step);
		if (!line) return undefined;
		const { a, b, x0, x1, xm, d, arrow, start } = line;
		// A step the unit takes alone is written beside its row.
		if (step.from === step.to) return { beside: { x: a.right + 12, y: a.y } };
		// When the camera framed only the receiver, the label goes beside the receiver, and the
		// sender is named where its line leaves the screen.
		const h = ch - PLAYER;
		const outX = (x: number) => x < 0 || x > cw;
		const outY = (y: number) => y < 0 || y > h;
		const off = outX(x0) || outY(a.y);
		const away = Math.sign(xm - x1) || 1;
		const clampX = (x: number) => Math.min(Math.max(x, 8), cw - 8);
		const clampY = (y: number) => Math.min(Math.max(y, 16), h - 16);
		// Where the line, followed back from the receiver, leaves the screen.
		const exit = outX(xm)
			? { x: clampX(xm), y: b.y, align: xm > cw ? 'end' : 'start' }
			: outY(a.y)
				? { x: xm, y: clampY(a.y), align: 'center' }
				: { x: clampX(x0), y: a.y, align: x0 > cw ? 'end' : 'start' };
		return {
			d,
			arrow,
			start,
			label: off
				? { x: x1 + away * 14, y: b.y, align: away > 0 ? 'start' : 'end' }
				: Math.abs(x1 - xm) > 60
					? { x: (xm + x1) / 2, y: b.y, align: 'center' }
					: { x: (x0 + xm) / 2, y: a.y, align: 'center' },
			edge: off && { ...exit, text: nameOf(step.from) },
			// Beside the receiver, on the side the line does not come in by.
			into:
				x1 === b.left
					? { x: b.right + 12, y: b.y, align: 'start' }
					: { x: b.left - 12, y: b.y, align: 'end' }
		};
	});

	/** How far a label is moved left to sit at its anchor: by its start, middle or end. */
	const SHIFT: Record<string, string> = { start: '0%', center: '-50%', end: '-100%' };

	/**
	 * The steps before the current one, as a faint trail of numbered lines. Steps inside a unit
	 * come back out of fold into the line of the call into it, numbered as a range; a line taken
	 * more than once, or back the other way (what a call gets), carries every number. Steps the
	 * unit takes alone are not drawn.
	 */
	const trail = $derived.by(() => {
		if (!run || !step) return [];
		const cur = step.frame;
		const onPath = (f: string[]) => f.length <= cur.length && f.every((u, k) => cur[k] === u);
		// The steps folded into each step drawn: the last of them, by the step drawn.
		const last: Record<number, number> = {};
		for (let i = 0; i < playAt; i++) {
			let j = i;
			while (!onPath(run.steps[j].frame)) j = callOf(run, j);
			last[j] = i;
		}
		const lines: Record<string, { at: number; s: PlayStep; nums: string[]; texts: string[] }> = {};
		for (const [k0, end] of Object.entries(last)) {
			const at = Number(k0);
			const s = run.steps[at];
			if (s.from === s.to) continue;
			const num = end > at ? `${at + 1}–${end + 1}` : `${at + 1}`;
			const l = (lines[[s.from, s.to].sort().join(' ')] ??= { at, s, nums: [], texts: [] });
			l.nums.push(num);
			l.texts.push(`${num} · ${s.text}`);
		}
		return Object.values(lines).flatMap((l) => {
			const line = lineOf(l.s);
			return line ? [{ ...l, line }] : [];
		});
	});

	function startPlay(unit: string) {
		if (!view.play) beforePlay = flow.getViewport();
		unpin();
		view.expanded = {};
		view.play = { unit, choices: {}, into: [], over: [], at: 0 };
	}
	/** Stops playing: the run's focus closes and the view goes back to where it was. */
	function stopPlay() {
		view.play = null;
		view.expanded = {};
		keepCamera = true;
		if (beforePlay) void flow.setViewport(beforePlay);
		beforePlay = undefined;
	}
	function jump(at: number) {
		if (view.play && run)
			view.play = { ...view.play, at: Math.min(Math.max(at, 0), run.steps.length - 1) };
	}
	function pickBranch(option: number) {
		if (!view.play || !step?.choice) return;
		view.play = {
			...view.play,
			choices: { ...view.play.choices, [step.key]: option },
			at: playAt + 1
		};
	}
	function forward() {
		if (step?.choice && step.choice.picked === undefined) return;
		if (view.play && step && forwardGoesInto(step, view.play.over, settings.followCalls))
			stepInto();
		else jump(playAt + 1);
	}
	/** Answers the call at step `i`: into its unit, or over it on purpose; then steps on. */
	function answer(into: boolean, i = playAt) {
		const call = run?.steps[i];
		if (!view.play || !call?.into) return;
		const key = call.key;
		const drop = (list: string[]) => list.filter((k) => k !== key);
		view.play = {
			...view.play,
			into: into ? [...drop(view.play.into), key] : drop(view.play.into),
			over: into ? drop(view.play.over) : [...drop(view.play.over), key],
			at: i + 1
		};
	}
	const stepInto = () => answer(true);
	const stepOver = () => answer(false);
	function stepOut() {
		if (!run || !step || step.frame.length < 2) return;
		const j = stepOutOf(run, playAt);
		if (run.steps[j].frame.length < step.frame.length) jump(j);
		// A choice inside not made yet stops the run before it comes back: leave by stepping over
		// the call instead.
		else answer(false, callOf(run, playAt));
	}
	/** Keys while playing; returns whether the key was one. */
	function playKey(e: KeyboardEvent) {
		if (!view.play || search.open || e.metaKey || e.ctrlKey || e.altKey) return false;
		const n = Number(e.key);
		if (e.key === 'Escape') stopPlay();
		else if (e.key === 'ArrowRight') forward();
		else if (e.key === 'ArrowLeft') jump(playAt - 1);
		else if (e.key === 'Home') jump(0);
		else if (e.key === 'i') stepInto();
		else if (e.key === 's') stepOver();
		else if (e.key === 'o') stepOut();
		else if (e.key === 'f') settings.setFollowCalls(!settings.followCalls);
		else if (step?.choice && n >= 1 && n <= step.choice.options.length) pickBranch(n - 1);
		else return false;
		e.preventDefault();
		return true;
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (playKey(e)) return;
		const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select');
		if (
			editing &&
			!typing &&
			e.key.toLowerCase() === 'z' &&
			(e.metaKey || e.ctrlKey) &&
			!e.shiftKey
		) {
			e.preventDefault();
			void changes.remove();
			return;
		}
		if (e.key === 'Escape' && peek) {
			peek = null;
			return;
		}
		if (e.key === 'Escape') {
			// In a focus, Esc unpins first, then leaves the focus.
			const pinned = view.field || view.api || view.selectedNodes.length;
			if (view.focused && !pinned && !keyOpen) leaveFocus();
			unpin();
			view.selectedNodes = [];
			keyOpen = false;
		}
	}}
/>

<div class="canvas" bind:clientWidth={cw} bind:clientHeight={ch} data-testid="canvas">
	<SvelteFlow
		bind:nodes
		{edges}
		{nodeTypes}
		{edgeTypes}
		connectionMode={ConnectionMode.Loose}
		colorMode={theme.current}
		minZoom={MIN_ZOOM}
		maxZoom={MAX_ZOOM}
		nodesDraggable={false}
		nodesConnectable={false}
		elementsSelectable={false}
		zoomOnDoubleClick={false}
		onmovestart={() => (moving = true)}
		onmoveend={() => {
			moving = false;
			hoverLater();
			router.aheadFrom(viewCentre());
		}}
		onnodeclick={({ node }) => {
			view.selectedNodes = [node.id];
			unpin();
		}}
		onpaneclick={() => {
			view.selectedNodes = [];
			unpin();
		}}
	>
		<Background
			variant={BackgroundVariant.Dots}
			gap={20}
			patternColor="var(--sdv-grid)"
			bgColor="var(--sdv-canvas-bg)"
		/>
		<Controls showLock={false}>
			<ControlButton
				class={settings.minimap ? 'on' : undefined}
				aria-label="Map"
				aria-pressed={settings.minimap}
				title="Map"
				onclick={() => settings.setMinimap(!settings.minimap)}
			>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path
						d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"
					/>
					<path d="M15 5.764v15" /><path d="M9 3.236v15" />
				</svg>
			</ControlButton>
			<ControlButton
				class={keyOpen ? 'on' : undefined}
				aria-label="Key"
				aria-pressed={keyOpen}
				title="Key"
				onclick={() => (keyOpen = !keyOpen)}
			>
				<svg viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.4">
					<rect x="1" y="1.5" width="3" height="3" /><rect x="1" y="8.5" width="3" height="3" />
					<path d="M6.5 3h5.5M6.5 10h5.5" />
				</svg>
			</ControlButton>
		</Controls>
	</SvelteFlow>
	{#if settings.minimap}
		<Minimap boxes={mapBoxes} {cw} {ch} minZoom={MIN_ZOOM} maxZoom={MAX_ZOOM} />
	{/if}
	<!-- Line ends keep one size on screen at any zoom, like the lines. -->
	<svg class="defs" aria-hidden="true">
		<defs>
			{#each MARKS as [id, color] (id)}
				<marker
					id="sdv-arrow-{id}"
					viewBox="0 0 10 10"
					refX="10"
					refY="5"
					markerWidth={mark}
					markerHeight={mark}
					markerUnits="userSpaceOnUse"
					orient="auto-start-reverse"
				>
					<path d="M0,1 L10,5 L0,9 Z" fill={color} />
				</marker>
				<marker
					id="sdv-diamond-{id}"
					viewBox="0 0 16 10"
					refX="16"
					refY="5"
					markerWidth={mark * 1.6}
					markerHeight={mark}
					markerUnits="userSpaceOnUse"
					orient="auto-start-reverse"
				>
					<path d="M0,5 L8,0 L16,5 L8,10 Z" fill={color} />
				</marker>
			{/each}
		</defs>
	</svg>
	{#each wedges as w (w.key)}
		<button
			class="wedge"
			style:left="{w.x}px"
			style:top="{w.y}px"
			style:transform="rotate({w.angle}deg)"
			style:--c="var(--sdv-link-{LINK_TOKEN[w.kind]})"
			title="Go to {w.name}"
			aria-label="Go to {w.name}"
			onclick={() => goEnd(w.end)}
		>
			<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M20 10 1 4.5v11Z" /></svg>
		</button>
	{/each}
	{#if keyOpen}
		<!-- What is drawn, beside the button that opened it. Lines and marks: the Atoms board. -->
		<aside class="key" aria-label="Key">
			<h4>Key</h4>
			<div class="k"><EntityGlyph kind="system" />System<span class="sw system"></span></div>
			<div class="k"><EntityGlyph kind="module" />Module<span class="sw module"></span></div>
			<div class="k">
				<EntityGlyph kind="class" />Model, where owned<span class="sw class"></span>
			</div>
			<div class="k"><EntityGlyph kind="table" />Stored table<span class="sw table"></span></div>
			<div class="k"><EntityGlyph kind="triggers" />Triggers<span class="sw triggers"></span></div>
			<div class="k"><EntityGlyph kind="logic" />Logic<span class="sw logic"></span></div>
			<div class="k"><EntityGlyph kind="api" />APIs<span class="sw api"></span></div>
			<hr />
			<div class="k"><span class="ex"><span class="dashed"></span></span>Owned elsewhere</div>
			<hr />
			<p class="hint">
				Grey at rest; hover or click to light. The arrow points at what the start depends on. Click
				to hide a kind.
			</p>
			{#each KEY_LINES as k (k.id)}
				<button
					class="k line"
					class:off={view.hidden[k.id]}
					aria-pressed={!view.hidden[k.id]}
					title={view.hidden[k.id] ? 'Show these lines' : 'Hide these lines'}
					onclick={() => {
						const next = { ...view.hidden };
						if (next[k.id]) delete next[k.id];
						else next[k.id] = true;
						view.hidden = next;
					}}
				>
					<svg class="ex" viewBox="0 0 30 10" style:--c="var(--sdv-link-{k.token})"
						><path
							d={k.diamond ? 'M10 5h19' : 'M1 5h21'}
							stroke="var(--c)"
							stroke-width="1.6"
							stroke-dasharray={k.dash}
						/><path
							d={k.diamond ? 'M1 5 5.5 2 10 5 5.5 8Z' : 'M29 5 22 1.5v7Z'}
							fill="var(--c)"
						/></svg
					>{k.label}
				</button>
			{/each}
		</aside>
	{/if}
	<!-- A card's body, drawn the same in the card and in the peek; `pick` shows an entry. -->
	{#snippet fieldBody(
		card: NonNullable<ReturnType<typeof fieldCardOf>>,
		pick: (at: PeekAt) => void,
		open?: string
	)}
		{#each card.sections as s (s.label)}
			<section class={s.kind}>
				<h4>{s.label}</h4>
				{#each s.entries as e, i (i)}
					<button
						class="entry"
						class:open={!!open && open === keyOf(e)}
						disabled={!e.target && !e.api}
						onclick={() => pick(e)}
						onmouseenter={() =>
							e.target?.field && hoverRow({ box: e.target.box.id, field: e.target.field }, true)}
						onmouseleave={() =>
							e.target?.field && hoverRow({ box: e.target.box.id, field: e.target.field }, false)}
						title={e.target || e.api ? 'Show here' : undefined}
					>
						<span class="text" data-glyph={s.glyph}>{e.text}</span>
						<span class="where">{e.where}</span>
					</button>
				{/each}
				{#if s.note}<p class="note">ƒ {s.note}</p>{/if}
			</section>
		{:else}
			<p class="empty">No references, sources or incoming links.</p>
		{/each}
	{/snippet}
	{#snippet unitBody(
		u: NonNullable<ReturnType<typeof unitCardOf>>,
		pick: (at: PeekAt) => void,
		from: LandscapeBox | undefined,
		id: string
	)}
		<div class="io">
			<section>
				<h4>Inputs</h4>
				{#each u.inputs as x (x.name)}
					<div class="api-field">
						<span class="name">{x.name}</span><span class="where">{x.type}</span>
					</div>
				{:else}
					<p class="empty">None.</p>
				{/each}
			</section>
			<section>
				<h4>Outputs</h4>
				{#each u.outputs as x (x.name)}
					<div class="api-field">
						<span class="name">{x.name}</span><span class="where">{x.type}</span>
					</div>
				{/each}
				{#each u.fails as x (x.name)}
					<div class="api-field">
						<span class="name">{x.name}</span><span class="where fail"
							>fails{x.description ? ` · ${x.description}` : ''}</span
						>
					</div>
				{/each}
				{#if !u.outputs.length && !u.fails.length}<p class="empty">None.</p>{/if}
			</section>
		</div>
		{#if u.seq}
			<section class="seq-section">
				<h4 class="seq-head">
					Sequence
					<button class="play" onclick={() => startPlay(id)} title="Walk the board step by step"
						><Play size={12} fill="currentColor" />Play</button
					>
				</h4>
				<SequenceDiagram
					seq={u.seq}
					onpick={(to) => {
						const at = seqAt(to, from);
						if (at) pick(at);
					}}
				/>
			</section>
		{/if}
	{/snippet}
	{#snippet apiBody(
		api: NonNullable<ReturnType<typeof apiCardOf>>,
		pick: (at: PeekAt) => void,
		open?: string
	)}
		{#if api.params.length}
			<section>
				<h4>Params</h4>
				{#each api.params as p (p.in + p.name)}
					<div class="entry">
						<span class="text">{p.name}{p.required || p.in === 'path' ? '' : '?'}</span>
						<span class="where">{p.in} · {p.type}{p.description ? ` · ${p.description}` : ''}</span>
					</div>
				{/each}
			</section>
		{/if}
		{#each [api.request, ...api.responses].filter((b) => !!b) as b (b.part)}
			<section class="body">
				<h4>
					{#if b.status}<b class="status {statusClass(b.status)}">{b.status}</b>{:else}Request{/if}
					{#if b.fields.length}<span class="shape">own shape{b.many ? ', a list' : ''}</span>{/if}
					{#if b.description}<span class="shape">{b.description}</span>{/if}
				</h4>
				{#if b.model}
					{@const m = b.model}
					<button
						class="entry"
						class:open={!!open && !!m.target && open === keyOf({ target: m.target })}
						disabled={!m.target}
						onclick={() => m.target && pick({ target: m.target })}
						title={m.target ? 'Show here' : undefined}
					>
						<span class="text">{m.text}</span>
						<span class="where">{m.note}</span>
					</button>
				{/if}
				{#each b.fields as f (f.id)}
					<div
						class="api-field"
						class:hot={view.apiField === f.id}
						role="listitem"
						title={f.title}
						onmouseenter={() => (view.apiField = f.id)}
						onmouseleave={() => (view.apiField = null)}
					>
						<span class="name">{f.name}</span>
						<span class="where">{f.type}</span>
						{#if !f.traced}<span class="untraced"><TriangleAlert size={12} /></span
							>{:else if f.title}<span class="traced">{b.part === 'request' ? '⇠' : '⇢'}</span>{/if}
					</div>
				{/each}
				{#if !b.model && !b.fields.length && !b.description}<p class="empty">No body.</p>{/if}
			</section>
		{/each}
		{#each api.logic as s (s.label)}
			<section class="calls">
				<h4>{s.label}</h4>
				{#each s.entries as e (e.id)}
					<button
						class="entry"
						class:open={!!open && !!e.target && open === keyOf({ target: e.target })}
						disabled={!e.target}
						onclick={() => e.target && pick({ target: e.target })}
						title={e.target ? 'Show here' : undefined}
					>
						<span class="text" data-glyph="ƒ">{e.text}</span>
						<span class="where">{e.where}</span>
					</button>
				{/each}
			</section>
		{/each}
	{/snippet}
	{#snippet triggerBody(
		t: NonNullable<ReturnType<typeof triggerCardOf>>,
		pick: (at: PeekAt) => void,
		open?: string
	)}
		{#each [{ label: 'Schedule', rows: t.schedule }, { label: 'Run', rows: t.run }] as s (s.label)}
			<section>
				<h4>{s.label}</h4>
				{#each s.rows as r (r.label)}
					<div class="api-field">
						<span class="where">{r.label}</span><span class:mono={r.mono}>{r.text}</span>
					</div>
				{/each}
			</section>
		{/each}
		{#if t.handledBy.length}
			<section class="calls">
				<h4>Handled by</h4>
				{#each t.handledBy as e (e.id)}
					<button
						class="entry"
						class:open={!!open && !!e.target && open === keyOf({ target: e.target })}
						disabled={!e.target}
						onclick={() => e.target && pick({ target: e.target })}
						title={e.target ? 'Show here' : undefined}
					>
						<span class="text" data-glyph="ƒ">{e.text}</span>
						<span class="where">{e.where}</span>
					</button>
				{/each}
			</section>
		{:else}
			<p class="empty">No logic unit handles it, so it starts nothing.</p>
		{/if}
	{/snippet}
	{#snippet triggerTitle(t: NonNullable<ReturnType<typeof triggerCardOf>>)}
		<div class="head">
			<div class="title"><EntityGlyph kind="trigger" /> {t.title}</div>
			<div class="type">{t.sub}</div>
		</div>
	{/snippet}
	{#snippet apiTitle(api: NonNullable<ReturnType<typeof apiCardOf>>)}
		<div class="head">
			<div class="title">
				<span style:color="var(--sdv-method-{api.method.toLowerCase()}, var(--sdv-text-muted))"
					>{api.method}</span
				>
				<span class="mono">{api.path}</span>
			</div>
			<div class="type">{api.sub}</div>
		</div>
	{/snippet}
	{#snippet minButton()}
		<button
			class="icon-btn"
			onclick={() => (cardMin = !cardMin)}
			aria-label={cardMin ? 'Expand' : 'Minimize'}
			title={cardMin ? 'Expand' : 'Minimize, keeping the selection'}
			data-testid="card-min"
			>{#if cardMin}<ChevronDown size={16} />{:else}<ChevronUp size={16} />{/if}</button
		>
		<button class="icon-btn" onclick={unpin} aria-label="Close" title="Close (Esc)"
			><X size={16} /></button
		>
	{/snippet}
	{#snippet peekButtons()}
		<button class="goto" onclick={goToPeek} title="Fly there and pick it"
			><LocateFixed size={13} />Go to</button
		>
		<button class="icon-btn" onclick={() => (peek = null)} aria-label="Close" title="Close (Esc)"
			><X size={16} /></button
		>
	{/snippet}
	{#snippet peekBackButton()}
		{#if peek?.trail.length}
			<button class="icon-btn" onclick={peekBack} title="Back to what this showed before"
				><ChevronLeft size={16} /></button
			>
		{/if}
	{/snippet}
	<!-- Beside the clicked row, moving with the canvas, so it reads next to what it describes. -->
	{#if inspector && fieldPos}
		<aside
			class="inspector"
			class:min={cardMin}
			style:left="{fieldPos.left}px"
			style:top="{fieldPos.top}px"
			style:width="{FIELD_W}px"
			bind:clientHeight={cardH}
			onpointerdowncapture={press}
			data-testid="field-inspector"
		>
			<header>
				{#if view.trail.length}
					<button class="icon-btn" onclick={goBack} title="Back to the previous field"
						><ChevronLeft size={16} /></button
					>
				{/if}
				<div class="head">
					<div class="title">{inspector.title}</div>
					<div class="type">{inspector.type}</div>
				</div>
				{@render minButton()}
			</header>
			<ChangeSection id={view.field!.field} go={goTo} />
			{@render fieldBody(inspector, openPeek, peek?.from)}
		</aside>
	{:else if triggerCard && fieldPos}
		<aside
			class="inspector trigger"
			class:min={cardMin}
			style:left="{fieldPos.left}px"
			style:top="{fieldPos.top}px"
			style:width="{FIELD_W}px"
			bind:clientHeight={cardH}
			onpointerdowncapture={press}
			data-testid="trigger-card"
		>
			<header>
				{#if view.trail.length}
					<button class="icon-btn" onclick={goBack} title="Back to the previous row"
						><ChevronLeft size={16} /></button
					>
				{/if}
				{@render triggerTitle(triggerCard)}
				{@render minButton()}
			</header>
			<ChangeSection id={view.field!.field} go={goTo} />
			{@render triggerBody(triggerCard, openPeek, peek?.from)}
		</aside>
	{:else if unitCard && unitPos}
		{@const u = unitCard}
		<aside
			class="inspector unit"
			class:min={cardMin}
			style:left="{unitPos.left}px"
			style:top="{unitPos.top}px"
			style:width="{cardMin ? FIELD_W : unitW}px"
			bind:clientHeight={cardH}
			onpointerdowncapture={press}
			data-testid="unit-card"
		>
			<header>
				{#if view.trail.length}
					<button class="icon-btn" onclick={goBack} title="Back to the previous row"
						><ChevronLeft size={16} /></button
					>
				{/if}
				<div class="head">
					<div class="title"><i class="fn">ƒ</i> {u.title}</div>
					<div class="type">{u.sub}</div>
				</div>
				{@render minButton()}
			</header>
			<ChangeSection id={view.field!.field} go={goTo} />
			{@render unitBody(u, openPeek, boxById.get(view.field!.box), view.field!.field)}
		</aside>
	{:else if apiCard && cardPos}
		<!-- Beside the picked row, moving with the canvas, so the api and what it uses share a view. -->
		<aside
			class="inspector"
			class:min={cardMin}
			style:left="{cardPos.left}px"
			style:top="{cardPos.top}px"
			style:width="{API_W}px"
			bind:clientHeight={cardH}
			onpointerdowncapture={press}
			data-testid="api-inspector"
		>
			<header>
				{@render apiTitle(apiCard)}
				{@render minButton()}
			</header>
			<ChangeSection id={view.api!} go={goTo} />
			{@render apiBody(apiCard, openPeek, peek?.from)}
		</aside>
	{/if}
	<!-- What an entry of the card names, beside the card; the camera stays where it is. -->
	{#if peekCard && peekPos}
		{@const p = peekCard}
		{#if p.kind === 'box'}
			<aside
				class="peek-card"
				style:left="{peekPos.left}px"
				style:top="{peekPos.top}px"
				style:width="{p.w}px"
				style:height={view.expanded[p.box.id] ? undefined : `${p.box.height}px`}
				bind:clientHeight={peekH}
				data-testid="peek"
			>
				<LandscapeNode
					{...{} as NodeProps}
					id={p.box.id}
					data={p.data}
					width={p.box.width}
					height={p.box.height}
				/>
				<div class="peek-head" style:height="{TABLE.head}px">
					{@render peekBackButton()}{@render peekButtons()}
				</div>
			</aside>
		{:else}
			<aside
				class="inspector peek"
				class:unit={p.kind === 'unit'}
				style:left="{peekPos.left}px"
				style:top="{peekPos.top}px"
				style:width="{p.w}px"
				bind:clientHeight={peekH}
				data-testid="peek"
			>
				<header>
					{@render peekBackButton()}
					{#if p.kind === 'api'}
						{@render apiTitle(p.api)}
					{:else if p.kind === 'unit'}
						<div class="head">
							<div class="title"><i class="fn">ƒ</i> {p.unit.title}</div>
							<div class="type">{p.unit.sub}</div>
						</div>
					{:else if p.kind === 'trigger'}
						{@render triggerTitle(p.trigger)}
					{:else}
						<div class="head">
							<div class="title">{p.field.title}</div>
							<div class="type">{p.field.type}</div>
						</div>
					{/if}
					{@render peekButtons()}
				</header>
				{#if p.kind === 'api'}
					{@render apiBody(p.api, peekTo)}
				{:else if p.kind === 'unit'}
					{@render unitBody(p.unit, peekTo, p.from, peek!.at.target!.field!)}
				{:else if p.kind === 'trigger'}
					{@render triggerBody(p.trigger, peekTo)}
				{:else}
					{@render fieldBody(p.field, peekTo)}
				{/if}
			</aside>
		{/if}
	{/if}
	{#if run && step}
		<svg class="play-lines trail" aria-hidden="true">
			{#each trail as t (t.at)}
				<path class="line {t.s.kind}" d={t.line.d} />
				<path class="head {t.s.kind}" d={t.line.arrow} />
			{/each}
		</svg>
		{#each trail as t (t.at)}
			<button
				class="play-num {t.s.kind}"
				style:left="{t.line.num.x}px"
				style:top="{t.line.num.y}px"
				title={t.texts.join('\n')}
				aria-label="Step {t.nums.join(', ')}: {t.s.text}. Jump there"
				onclick={() => jump(t.at)}>{t.nums.join(', ')}</button
			>
		{/each}
		{#if playDraw?.d}
			<svg class="play-lines" aria-hidden="true">
				<path class="line {step.kind}" d={playDraw.d} />
				<path class="head {step.kind}" d={playDraw.arrow} />
			</svg>
			<div
				class="play-num now {step.kind}"
				style:left="{playDraw.start.x}px"
				style:top="{playDraw.start.y}px"
			>
				{playAt + 1}
			</div>
			<div
				class="play-label {step.kind}"
				style:left="{playDraw.label.x}px"
				style:top="{playDraw.label.y}px"
				style:--ax={SHIFT[playDraw.label.align]}
			>
				{#if step.method}<b style:color="var(--sdv-method-{step.method.toLowerCase()})"
						>{step.method}</b
					>{step.text.slice(step.method.length)}{:else}{step.text}{/if}
			</div>
			{#if playDraw.edge}
				<div
					class="play-edge"
					style:left="{playDraw.edge.x}px"
					style:top="{playDraw.edge.y}px"
					style:--ax={SHIFT[playDraw.edge.align]}
				>
					{playDraw.edge.text}
				</div>
			{/if}
			{#if inside}
				<div
					class="play-into"
					style:left="{playDraw.into.x}px"
					style:top="{playDraw.into.y}px"
					style:--ax={SHIFT[playDraw.into.align]}
				>
					<i>ƒ</i>{inside}<kbd>{settings.followCalls ? '→' : 'I'}</kbd>
				</div>
			{/if}
		{:else if playDraw?.beside}
			<div
				class="play-beside {step.kind}"
				style:left="{playDraw.beside.x}px"
				style:top="{playDraw.beside.y}px"
			>
				{#if step.choice}<i>{step.choice.label}</i>{/if}{step.text}
			</div>
		{/if}
		<PlayerBar
			{run}
			at={playAt}
			names={(id) => el(id)?.name ?? id}
			onjump={jump}
			onpick={pickBranch}
			over={view.play?.over ?? []}
			follow={settings.followCalls}
			onforward={forward}
			oninto={stepInto}
			onover={stepOver}
			onout={stepOut}
			onfollow={() => settings.setFollowCalls(!settings.followCalls)}
			onstop={stopPlay}
		/>
	{/if}
	{#if view.focused && !view.play}
		<FocusBar
			focus={view.focused}
			name={refLabel(changes.shown, view.focused.id) ?? ''}
			kind={changes.shown.fields.has(view.focused.id)
				? 'field'
				: focusedEl?.def.kind === 'module' && !focusedEl.parentId
					? 'system'
					: (focusedEl?.def.kind ?? 'model')}
			onchange={setFocus}
			onleave={leaveFocus}
		/>
	{/if}
	{#if search.open}
		<SearchPalette onpick={pick} onfocus={focusHit} onclose={() => (search.open = false)} />
	{/if}
	<ChangesPanel go={goTo} />
	{#if menu && editing}
		<EditMenu {...menu} onclose={() => (menu = null)} />
	{/if}
</div>

<style>
	.canvas {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
	.canvas :global(.svelte-flow__node) {
		border: none;
		background: transparent;
		padding: 0;
		border-radius: 0;
		box-shadow: none;
	}
	/* Boxes and lines fade in when mounted. */
	.canvas :global(.svelte-flow__node),
	.canvas :global(.svelte-flow__edge.conn.rest) {
		transition: opacity 0.18s ease-out 0.1s;
		@starting-style {
			opacity: 0;
		}
	}
	/* Every line keeps its width on screen at any zoom: at rest 1, 1.75 or 2.5px by how many
	   connections it merges (hover one for the count), lit 2px. Solid is structure, dashed
	   lineage, dotted control. */
	.canvas :global(.conn .svelte-flow__edge-path) {
		stroke: var(--sdv-edge);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
		transition: opacity 0.12s;
	}
	.canvas :global(.conn.w2 .svelte-flow__edge-path) {
		stroke-width: 1.75;
	}
	.canvas :global(.conn.w3 .svelte-flow__edge-path) {
		stroke-width: 2.5;
	}
	.canvas :global(.conn.from .svelte-flow__edge-path) {
		stroke-dasharray: 5 4;
	}
	.canvas :global(.conn.calls .svelte-flow__edge-path),
	.canvas :global(.conn.handles .svelte-flow__edge-path) {
		stroke-dasharray: 2 3;
	}
	.canvas :global(.conn.dim .svelte-flow__edge-path) {
		opacity: 0.25;
	}
	/* Lit lines are over the cards, so they never take the pointer from a row. */
	.canvas :global(.svelte-flow__edge.conn.lit) {
		pointer-events: none;
	}
	.canvas :global(.conn.lit .svelte-flow__edge-path) {
		stroke: var(--sdv-link-ref);
		stroke-width: 2;
	}
	.canvas :global(.conn.lit.from .svelte-flow__edge-path) {
		stroke: var(--sdv-link-from);
	}
	.canvas :global(.conn.lit.writes .svelte-flow__edge-path) {
		stroke: var(--sdv-link-write);
	}
	.canvas :global(.conn.lit.calls .svelte-flow__edge-path),
	.canvas :global(.conn.lit.handles .svelte-flow__edge-path) {
		stroke: var(--sdv-link-call);
	}
	.wedge {
		position: absolute;
		z-index: 9;
		width: 22px;
		height: 22px;
		margin: -11px 0 0 -11px;
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
	}
	.wedge svg {
		display: block;
		width: 100%;
		height: 100%;
		fill: var(--c);
		filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.25));
	}
	.key .line {
		width: 100%;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.key .line:hover {
		background: color-mix(in srgb, var(--sdv-selection) 8%, transparent);
	}
	.key .line.off {
		color: var(--sdv-text-muted);
		text-decoration: line-through;
	}
	.key .line.off .ex {
		opacity: 0.35;
	}
	.key .hint {
		margin: 2px 12px 4px;
		font-size: 11px;
		line-height: 1.35;
		color: var(--sdv-text-muted);
	}
	.canvas :global(.svelte-flow__controls-button.on) {
		color: var(--sdv-selection);
		background: color-mix(in srgb, var(--sdv-selection) 14%, var(--sdv-model-fill));
	}
	.key {
		position: absolute;
		left: 52px;
		bottom: 15px;
		width: 236px;
		z-index: 10;
		box-sizing: border-box;
		padding-bottom: 4px;
		background: var(--sdv-model-fill);
		border: 1px solid var(--sdv-model-stroke);
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
		color: var(--sdv-model-text);
		font-size: 12px;
	}
	.key h4 {
		margin: 0 0 4px;
		padding: 8px 12px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--sdv-text-muted);
		border-bottom: 1px solid var(--sdv-model-stroke);
	}
	.key .k {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 22px;
		padding: 2px 12px;
		/* Glyphs at their 12px size, centred in the 30px example column. */
		--glyph-opacity: 0.75;
	}
	.key .k > :global(.glyph) {
		width: 12px;
		height: 12px;
		margin: 0 9px;
		text-align: center;
	}
	.key .ex {
		width: 30px;
		height: 10px;
		flex: none;
		display: flex;
		justify-content: center;
	}
	.key .dashed {
		width: 24px;
		height: 12px;
		box-sizing: border-box;
		border: 1.5px dashed var(--sdv-kind-class);
		border-radius: 3px;
	}
	.key .sw {
		width: 22px;
		height: 14px;
		margin-left: auto;
		box-sizing: border-box;
		border: 1px solid var(--sdv-model-stroke);
	}
	/* Each kind's line and corner, as drawn on the canvas. */
	.key .sw.system {
		border: 1.5px solid var(--sdv-system-stroke);
		border-radius: 5px;
	}
	.key .sw.module {
		background: var(--sdv-module-fill);
		border-color: var(--sdv-module-stroke);
		border-radius: 4px;
	}
	.key .sw.class {
		border: 1.5px solid var(--sdv-kind-class);
		border-radius: 3px;
	}
	.key .sw.table {
		border: 1.5px solid var(--sdv-kind-table);
		border-radius: 1px;
		background: linear-gradient(
			to bottom,
			transparent 3px,
			var(--sdv-kind-table) 3px 4.5px,
			transparent 4.5px
		);
	}
	.key .sw.logic {
		width: 18px;
		height: 10px;
		margin-right: 2px;
		border-color: var(--sdv-kind-logic);
		border-radius: 4px;
		box-shadow:
			0 0 0 1.5px var(--sdv-model-fill),
			0 0 0 2.5px var(--sdv-kind-logic);
	}
	.key .sw.triggers {
		border: 1.5px solid var(--sdv-kind-trigger);
		border-radius: 2px;
		background: linear-gradient(
			to bottom,
			var(--sdv-kind-trigger-head) 3px,
			var(--sdv-kind-trigger) 3px 4.5px,
			transparent 4.5px
		);
	}
	.key .sw.api {
		border-color: var(--sdv-system-stroke);
		border-radius: 999px;
	}
	.key hr {
		border: none;
		border-top: 1px solid var(--sdv-model-stroke);
		margin: 4px 0;
	}
	.inspector {
		position: absolute;
		max-height: calc(100% - 16px);
		z-index: 10;
		box-sizing: border-box;
		background: var(--sdv-model-fill);
		border: 1px solid var(--sdv-model-stroke);
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
		color: var(--sdv-model-text);
		font-size: 13px;
		overflow: auto;
	}
	.inspector.min > :not(header) {
		display: none;
	}
	.inspector.min header {
		border-bottom: none;
	}
	.inspector header {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		padding: 10px 12px 8px;
		border-bottom: 1px solid var(--sdv-model-stroke);
		background: var(--sdv-model-fill);
	}
	.inspector .title {
		font-weight: 600;
		font-size: 14px;
		line-height: 20px;
	}
	.inspector .type,
	.inspector .where,
	.inspector .empty,
	.inspector .note {
		color: var(--sdv-text-muted);
		font-size: 12px;
	}
	.inspector .head {
		flex: 1;
	}
	.inspector .icon-btn {
		border: none;
		background: none;
		color: var(--sdv-text-muted);
		display: flex;
		cursor: pointer;
		/* 20px, the title's line, so the icon centres on it. */
		padding: 2px;
	}
	.inspector section {
		padding: 6px 0;
		border-top: 1px solid var(--sdv-model-stroke);
	}
	.inspector header + section {
		border-top: none;
	}
	.inspector h4 {
		margin: 2px 12px 4px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--sdv-text-muted);
	}
	.inspector .entry {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		width: 100%;
		padding: 4px 12px 4px 10px;
		border: none;
		border-left: 2px solid transparent;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.inspector .entry:hover:not(:disabled) {
		background: var(--sdv-row-hover);
		border-left-color: var(--sdv-link-ref);
	}
	.inspector .from .entry:hover:not(:disabled) {
		border-left-color: var(--sdv-link-from);
	}
	.inspector .entry:disabled {
		cursor: default;
	}
	.inspector .entry .text {
		font-weight: 500;
	}
	.inspector .entry .text::before {
		content: attr(data-glyph) ' ';
		color: var(--sdv-link-ref);
	}
	.inspector .from .entry .text::before {
		color: var(--sdv-link-from);
	}
	.inspector .writes .entry .text::before {
		color: var(--sdv-link-write);
	}
	.inspector .writes .entry:hover:not(:disabled) {
		border-left-color: var(--sdv-link-write);
	}
	.inspector .calls .entry .text::before {
		color: var(--sdv-link-call);
	}
	.inspector .calls .entry:hover:not(:disabled) {
		border-left-color: var(--sdv-link-call);
	}
	.inspector .fn {
		font-family: Georgia, serif;
		color: var(--sdv-kind-logic-icon);
	}
	.inspector .io {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.inspector .io section {
		border-top: none;
	}
	.inspector .io section + section {
		border-left: 1px solid var(--sdv-model-stroke);
	}
	.inspector .where.fail {
		color: var(--sdv-method-put);
	}
	.inspector .seq-section {
		overflow-x: auto;
	}
	.inspector .status {
		font-variant-numeric: tabular-nums;
		margin-right: 6px;
	}
	.inspector div.entry {
		cursor: default;
	}
	.inspector .note,
	.inspector .empty {
		margin: 4px 12px;
	}
	/* The entry whose peek is open. */
	.inspector .entry.open {
		background: var(--sdv-row-self);
		border-left-color: var(--sdv-selection);
	}
	.inspector.peek {
		z-index: 11;
		box-shadow: 0 10px 32px rgba(0, 0, 0, 0.22);
	}
	.goto {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 0 8px;
		font: inherit;
		font-size: 12px;
		line-height: 20px;
		white-space: nowrap;
		color: var(--sdv-model-text);
		background: var(--sdv-model-fill);
		border: 1px solid var(--sdv-model-stroke);
		cursor: pointer;
	}
	.goto:hover {
		border-color: var(--sdv-selection);
	}
	/* A model or logic card in the peek: the canvas's card at full size, the peek's buttons
	   in its name bar. */
	.peek-card {
		position: absolute;
		z-index: 11;
		box-shadow: 0 10px 32px rgba(0, 0, 0, 0.22);
	}
	/* Outlines mark a card's place on the canvas; the peek is not on it. */
	.peek-card :global(.node) {
		outline: none;
	}
	.peek-head {
		position: absolute;
		top: 0;
		right: 0;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 6px;
	}
	.peek-head .icon-btn {
		border: none;
		background: none;
		color: var(--sdv-text-muted);
		display: flex;
		cursor: pointer;
		padding: 2px;
	}
	.inspector .mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 13px;
	}
	.inspector .body h4 {
		display: flex;
		gap: 6px;
		align-items: baseline;
	}
	.inspector .shape {
		font-weight: 400;
		letter-spacing: 0;
	}
	.status.ok {
		color: var(--sdv-method-get);
	}
	.status.warn {
		color: var(--sdv-method-put);
	}
	.status.bad {
		color: var(--sdv-method-delete);
	}
	.api-field {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 8px;
		align-items: baseline;
		line-height: 18px;
		padding: 3px 12px 3px 10px;
		border-left: 2px solid transparent;
		cursor: default;
	}
	.api-field.hot {
		background: var(--sdv-row-hover);
		border-left-color: var(--sdv-link-from);
	}
	.api-field .name {
		font-weight: 500;
	}
	.api-field .traced {
		color: var(--sdv-link-from);
	}
	/* One line tall and centred in it: an icon has no baseline to align by. */
	.api-field .untraced {
		align-self: start;
		display: flex;
		align-items: center;
		height: 18px;
		color: var(--sdv-method-put);
	}
	.inspector .seq-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.inspector .play {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 1px 8px 1px 6px;
		border: 1px solid var(--sdv-model-stroke);
		background: var(--sdv-model-fill);
		color: var(--sdv-model-text);
		font: inherit;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0;
		cursor: pointer;
	}
	.inspector .play:hover {
		border-color: var(--sdv-selection);
		color: var(--sdv-selection);
	}
	.play-lines {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		z-index: 9;
		pointer-events: none;
		overflow: visible;
	}
	.play-lines .line {
		fill: none;
		stroke-width: 2.5;
		stroke: var(--sdv-model-text);
	}
	.play-lines .head {
		fill: var(--sdv-model-text);
	}
	.play-lines .line.call {
		stroke: var(--sdv-link-call);
		stroke-dasharray: 2 4;
		stroke-linecap: round;
	}
	.play-lines .head.call {
		fill: var(--sdv-link-call);
	}
	.play-lines .line.read {
		stroke: var(--sdv-link-ref);
	}
	.play-lines .head.read {
		fill: var(--sdv-link-ref);
	}
	.play-lines .line.write {
		stroke: var(--sdv-link-write);
	}
	.play-lines .head.write {
		fill: var(--sdv-link-write);
	}
	.play-lines .line.gets,
	.play-lines .line.return,
	.play-lines .line.fail {
		stroke-dasharray: 6 4;
	}
	.play-lines .line.gets {
		stroke: var(--sdv-text-muted);
	}
	.play-lines .head.gets {
		fill: var(--sdv-text-muted);
	}
	.play-lines .line.fail {
		stroke: var(--sdv-method-put);
	}
	.play-lines .head.fail {
		fill: var(--sdv-method-put);
	}
	.play-lines.trail {
		opacity: 0.4;
	}
	.play-lines.trail .line {
		stroke-width: 1.5;
	}
	.play-num {
		position: absolute;
		z-index: 9;
		transform: translate(-50%, -50%);
		min-width: 20px;
		height: 20px;
		box-sizing: border-box;
		padding: 0 5px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font: inherit;
		font-size: 11px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		background: var(--sdv-canvas-bg);
		border: 1.5px solid var(--c);
		border-radius: 10px;
		color: var(--c);
		--c: var(--sdv-model-text);
		cursor: pointer;
	}
	button.play-num {
		opacity: 0.6;
	}
	button.play-num:hover {
		opacity: 1;
	}
	.play-num.now {
		pointer-events: none;
		background: var(--c);
		color: var(--sdv-canvas-bg);
	}
	.play-num.call {
		--c: var(--sdv-link-call);
	}
	.play-num.read {
		--c: var(--sdv-link-ref);
	}
	.play-num.write {
		--c: var(--sdv-link-write);
	}
	.play-num.gets {
		--c: var(--sdv-text-muted);
	}
	.play-num.fail {
		--c: var(--sdv-method-put);
	}
	.play-label,
	.play-edge,
	.play-beside {
		position: absolute;
		z-index: 9;
		pointer-events: none;
		white-space: nowrap;
		font-size: 12px;
		padding: 2px 8px;
		background: var(--sdv-canvas-bg);
		border: 1px solid currentColor;
		color: var(--sdv-model-text);
	}
	.play-label {
		transform: translate(var(--ax), calc(-100% - 6px));
	}
	.play-label b {
		margin-right: 0.3em;
	}
	.play-label.call {
		color: var(--sdv-link-call);
	}
	.play-label.read {
		color: var(--sdv-link-ref);
	}
	.play-label.write {
		color: var(--sdv-link-write);
	}
	.play-label.gets {
		color: var(--sdv-text-muted);
	}
	.play-label.fail {
		color: var(--sdv-method-put);
	}
	.play-edge {
		transform: translate(var(--ax), -50%);
		color: var(--sdv-text-muted);
		border-style: dashed;
	}
	.play-into {
		position: absolute;
		z-index: 9;
		pointer-events: none;
		white-space: nowrap;
		font-size: 12px;
		padding: 2px 8px;
		background: var(--sdv-canvas-bg);
		border: 1px dashed currentColor;
		color: var(--sdv-link-call);
		transform: translate(var(--ax), -50%);
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.play-into i {
		font-family: Georgia, serif;
	}
	.play-into kbd {
		font: inherit;
		font-size: 11px;
		line-height: 16px;
		padding: 0 5px;
		border: 1px solid var(--ui-border);
		background: var(--ui-panel);
		color: var(--ui-muted);
	}
	.play-beside {
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.play-beside.choice {
		border-color: var(--sdv-selection);
	}
	.play-beside.note {
		font-style: italic;
		border-color: var(--sdv-model-stroke);
	}
	.play-beside i {
		font-style: normal;
		font-size: 11px;
		font-weight: 700;
		color: var(--sdv-selection);
	}
	.defs {
		position: absolute;
		width: 0;
		height: 0;
	}
</style>

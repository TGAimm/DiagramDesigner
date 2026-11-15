<script lang="ts">
	import { ChevronLeft, TriangleAlert, X } from '@lucide/svelte';
	import {
		Background,
		BackgroundVariant,
		ControlButton,
		Controls,
		MarkerType,
		SvelteFlow,
		useSvelteFlow,
		useViewport,
		type Edge,
		type Node
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { design } from '#lib/client/store.svelte.ts';
	import { settings } from '#lib/client/settings.svelte.ts';
	import { theme } from '#lib/client/theme.svelte.ts';
	import type { ViewState } from '#lib/client/view-state.svelte.ts';
	import {
		fieldRowY,
		focusLinks,
		incomingCount,
		layoutLandscape,
		linkTarget,
		logicRowY,
		modelLinks,
		refLabel,
		relationsOf,
		shownRows,
		TABLE,
		typeText,
		type FieldLink,
		type LandscapeBox,
		type ModelLink
	} from '#lib/landscape/layout.ts';
	import { apiHosts, openBoxes, railOpen, READABLE } from '#lib/landscape/open.ts';
	import { sequenceOf, sequenceWidth } from '#lib/landscape/sequence.ts';
	import SequenceDiagram from './SequenceDiagram.svelte';
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
	import { untrack } from 'svelte';
	import LandscapeNode, { type LandscapeNodeData } from './LandscapeNode.svelte';
	import EntityGlyph from './EntityGlyph.svelte';

	/**
	 * The whole model, laid out once. Only boxes inside open boxes are mounted; which boxes are
	 * open follows whether their contents would be readable on screen (see open.ts), and opening
	 * fades over a fixed time.
	 */
	let { view }: { view: ViewState } = $props();

	const flow = useSvelteFlow();
	const viewport = useViewport();
	const nodeTypes = { landscape: LandscapeNode };
	// How long a closed box's children stay mounted while they fade out (the CSS transitions).
	const FADE_MS = 300;

	let cw = $state(1);
	let ch = $state(1);
	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let fitted = false;
	// Set once the first fit has landed; before it the camera is a placeholder.
	let ready = $state(false);
	/** The key explaining the canvas's marks is shown. */
	let keyOpen = $state(false);

	// Render everything: every box and rail open, every card unfolded, at any zoom.
	const all = $derived(settings.detail === 'all');
	const boxes = $derived(layoutLandscape(design.model, !all));
	const rels = $derived(relationsOf(design.model));
	const boxById = $derived(new Map(boxes.map((b) => [b.id, b])));
	// The row being looked at: under the pointer, else clicked. Its links are drawn wherever
	// the other end is, so a link across modules or systems shows too.
	const focus = $derived(view.hover ?? view.field);
	const focused = $derived(
		focus ? focusLinks(design.model, rels, boxes, focus.box, focus.field) : []
	);
	const label = (id: string) => refLabel(design.model, id) ?? id;
	/** Where row `i` of a card sits, folded or expanded as it is now; logic cards never fold. */
	const rowY = (b: LandscapeBox, i: number) =>
		b.logic ? logicRowY(i) : fieldRowY(i, b.fields?.length ?? 0, all || !!view.expanded[b.id]);
	/** The row of a field or logic unit in a card, or -1. */
	const rowOf = (b: LandscapeBox, id: string | undefined) =>
		b.logic
			? b.logic.rows.findIndex((r) => r.id === id)
			: (b.fields?.findIndex((f) => f.id === id) ?? -1);
	const el = (id: string) => design.model.elements.get(id);
	const isUnit = (id: string) => el(id)?.def.kind === 'logic-unit';
	const isApiEl = (id: string) => el(id)?.def.kind === 'api';

	// State, not derived, so a pan that changes nothing stops here instead of rebuilding nodes
	// every frame, and the boxes that just closed are known.
	let open = $state.raw(new Set<string>());
	// Boxes that just closed; their children stay mounted until they have faded out.
	let closing = $state.raw(new Set<string>());
	// Hosts whose rail rows read at READABLE px, so the rail lists them.
	let openRails = $state.raw(new Set<string>());
	const sameSet = (a: Set<string>, b: Set<string>) =>
		a.size === b.size && [...a].every((id) => b.has(id));
	$effect(() => {
		const { x, y, zoom } = viewport.current;
		if (!ready) return;
		const was = untrack(() => open);
		const next = all
			? new Set(boxes.filter((b) => b.group).map((b) => b.id))
			: openBoxes(boxes, { x, y, zoom, width: cw, height: ch });
		const listed = new Set(
			[...railsFor(next)].filter(([, r]) => all || railOpen(r, zoom)).map(([id]) => id)
		);
		if (
			!sameSet(
				listed,
				untrack(() => openRails)
			)
		)
			openRails = listed;
		if (sameSet(next, was)) return;
		const shut = [...was].filter((id) => !next.has(id));
		open = next;
		if (!shut.length) return;
		closing = new Set([...untrack(() => closing), ...shut]);
		setTimeout(() => {
			closing = new Set([...closing].filter((id) => !shut.includes(id) || open.has(id)));
		}, FADE_MS);
	});

	// Mounted: roots, children of open or closing boxes, and the far ends of focused lines
	// (with the boxes round them), so a line to a closed box still has an end.
	const mounted = $derived.by(() => {
		const out = boxes
			.filter((b) => !b.parentId || open.has(b.parentId) || closing.has(b.parentId))
			.map((b) => b.id);
		for (const l of focused)
			for (let id: string | undefined = l.source === focus?.box ? l.target : l.source; id;) {
				out.push(id);
				id = boxById.get(id)?.parentId;
			}
		return new Set(out);
	});

	// Apis sit on a rail across the right border of their parent's box, or of the nearest shown
	// box round it, one rail per box.
	function railsFor(openSet: Set<string>): Map<string, Rail> {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and returned whole
		const out = new Map<string, Rail>();
		for (const [id, apis] of apiHosts(boxes, openSet)) {
			const b = boxById.get(id)!;
			out.set(id, railOf(design.model, railGroups(design.model, b.elementId, apis), b.height));
		}
		return out;
	}
	const rails = $derived(railsFor(open));
	const uses = $derived(apiUses(design.model));
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

	function onfield(box: string, field: string, ev: 'enter' | 'leave' | 'click') {
		if (ev === 'enter') view.hover = { box, field };
		else if (ev === 'leave') view.hover = null;
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
			open: openRails.has(id),
			groups: r.groups.map((g) => ({
				title: g.title,
				apis: g.apis.map((a) => {
					const def = el(a)!.def;
					return { id: a, name: el(a)!.name, method: def.method ?? '', path: def.path ?? '' };
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

	/** The rows a field of the picked api's own shape sends into or comes from. */
	function apiFieldTargets(id: string | null) {
		const f = id ? design.model.apiFields.get(id) : undefined;
		const host = f && hostOf(f.apiId);
		if (!f || !host) return [];
		return (f.def.to ?? f.def.from ?? []).flatMap((field) => {
			const box = linkTarget(design.model, boxes, host, field);
			return box ? [{ box, field }] : [];
		});
	}

	// Boxes the picked api's bodies use, outlined with the parts using them, and the rows a
	// trimmed body leaves out, dimmed. A model in a hidden box outlines the box that shows.
	$effect(() => {
		const host = view.api ? hostOf(view.api) : undefined;
		const parts: Record<string, string[]> = {};
		const kept: Record<string, Set<string> | 'all'> = {};
		if (view.api && host)
			for (const u of bodyModels(design.model, view.api)) {
				const t = linkTarget(design.model, boxes, host, u.model);
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

	// Rows to light, by box: the focused row, and the row at the far end of each of its lines.
	// Nodes read it from the view state, so focus changes never rebuild them.
	$effect(() => {
		const out: Record<string, Record<string, 'self' | 'peer'>> = {};
		const lit = (box: string, field: string | undefined, how: 'self' | 'peer') => {
			if (!field) return;
			const rows = (out[box] ??= {});
			if (rows[field] !== 'self') rows[field] = how;
		};
		if (focus) lit(focus.box, focus.field, 'self');
		for (const t of apiFieldTargets(view.apiField)) lit(t.box.id, t.field, 'peer');
		// The units handling or calling the picked api.
		for (const l of view.api ? (rels.in.get(view.api) ?? []) : []) {
			const u = boxes.find((b) => b.logic?.rows.some((r) => r.id === l.field));
			if (u) lit(u.id, l.field, 'peer');
		}
		for (const l of focused) {
			lit(l.source, l.sourceField, 'peer');
			lit(l.target, l.targetField, 'peer');
		}
		view.hot = out;
		// A far end inside a closed box is hidden; outline the closed box that shows instead.
		const far = focused.flatMap((l) => (l.source === focus?.box ? [l.target] : [l.source]));
		const peers: Record<string, true> = {};
		for (const id of far) {
			let shown = boxById.get(id);
			while (shown?.parentId && !open.has(shown.parentId)) shown = boxById.get(shown.parentId);
			if (shown && shown.id !== id) peers[shown.id] = true;
		}
		// Apis a focused unit handles or calls light their rail rows, or a closed rail's box.
		const apis: Record<string, true> = {};
		for (const l of focus && isUnit(focus.field) ? (rels.out.get(focus.field) ?? []) : [])
			if (isApiEl(l.to)) {
				apis[l.to] = true;
				const host = hostOf(l.to);
				if (host && !openRails.has(host.id)) peers[host.id] = true;
			}
		view.hotApis = apis;
		view.peerBoxes = peers;
	});

	$effect(() => {
		const counts = Object.fromEntries(
			[...design.model.fields.keys()].map((id) => [
				id,
				{
					ref: incomingCount(rels, id, 'ref'),
					from: incomingCount(rels, id, 'from'),
					api: incomingCount(rels, id, 'api')
				}
			])
		);
		nodes = boxes
			.filter((b) => mounted.has(b.id))
			.map((b) => {
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
					class:
						[b.parentId && !open.has(b.parentId) && 'ghost', open.has(b.id) && 'open']
							.filter(Boolean)
							.join(' ') || undefined,
					data: {
						name: info.name,
						// A closed boundary reads as the model it is drawn round.
						kind: b.boundary ? 'model' : info.def.kind,
						group: b.group,
						owner: b.ref ? el(info.parentId ?? '')?.name : undefined,
						fields: b.fields,
						indexes: b.view === 'table' ? info.def.indexes : undefined,
						table: b.table,
						logic: b.logic,
						view: b.view,
						labels: Object.fromEntries(
							(b.fields ?? [])
								.flatMap((f) => [f.ref, f.model, ...(f.from ?? [])])
								.flatMap((id) => {
									const label = id && refLabel(design.model, id);
									return label ? [[id, label]] : [];
								})
						),
						incoming: counts,
						state: view,
						onfield: (field, ev) => onfield(b.id, field, ev),
						rail: railView(b.id),
						onapi,
						onrail: () => openRail(b.id)
					} satisfies LandscapeNodeData
				};
			});
		if (!fitted && boxes.length) {
			fitted = true;
			requestAnimationFrame(() =>
				requestAnimationFrame(() => flow.fitView({ padding: 0.08 }).then(() => (ready = true)))
			);
		}
	});

	$effect(() => {
		// Lines fade with their box's children, through the same CSS variables as the nodes.
		// While a row is focused its lines are lit, drawn over the cards so none reads as
		// another row's, and the rest dimmed. Lines to cards in other boxes are added and
		// always visible.
		const lit = new Set(focused.map((l) => l.id));
		const base = modelLinks(design.model, boxes).filter(
			(l) => mounted.has(l.source) && mounted.has(l.target)
		);
		const baseIds = new Set(base.map((l) => l.id));
		edges = [
			...base.map((l) => edge(l, focus ? (lit.has(l.id) ? 'hot' : 'dim') : '')),
			...focused.filter((l) => !baseIds.has(l.id)).map((l) => edge(l, 'hot cross'))
		];
	});

	/** The colour token of each kind of line. */
	const LINK_TOKEN: Record<FieldLink['kind'], string> = {
		ref: 'ref',
		model: 'ref',
		from: 'from',
		handles: 'ref',
		reads: 'ref',
		writes: 'write',
		calls: 'call'
	};

	function edge(l: ModelLink, state: string) {
		const parent = l.parentId ? boxById.get(l.parentId) : undefined;
		const hotLine = state.includes('hot');
		const color = hotLine ? `var(--sdv-link-${LINK_TOKEN[l.kind]})` : 'var(--sdv-edge)';
		const arrow = { type: MarkerType.ArrowClosed, width: 14, height: 14, color };
		return {
			...l,
			// Svelte Flow adds this to the higher level of the two tables, so the line sits one
			// level below them: under the tables, over their module. A lit line goes on top.
			zIndex: hotLine ? 1000 : -1,
			type: 'smoothstep',
			pathOptions: { borderRadius: 0 },
			class: `model-link ${l.kind} ${state} ${parent && !open.has(parent.id) ? 'off' : ''}`,
			// A foreign key points at the key; a held model has a UML composition diamond at the
			// holder (defined below); lineage points at the derived field, the way data flows, and
			// so do a unit's reads (at the unit) and writes (at the model). A call points at the callee.
			...(l.kind === 'ref' || l.kind === 'writes' || l.kind === 'calls'
				? { markerEnd: arrow }
				: l.kind === 'from' || l.kind === 'reads'
					? { markerStart: arrow }
					: { markerStart: hotLine ? 'sdv-composition-hot' : 'sdv-composition' })
		};
	}

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
		const via = u.via ? design.model.apiFields.get(u.via)?.def.name : undefined;
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

	const inspector = $derived.by(
		(): { title: string; type: string; sections: Section[] } | undefined => {
			const f = view.field;
			const b = f && boxById.get(f.box);
			const info = f && design.model.fields.get(f.field);
			if (!f || !b || !info) return undefined;
			const entry = (to: string): Entry => {
				if (isApiEl(to)) return routeEntry(to);
				const t = linkTarget(design.model, boxes, b, to);
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
				type: typeText(def, (id) => refLabel(design.model, id)),
				// Glyphs point the way the link goes: → this field to the entry, ← the entry to it.
				sections: [
					{ label: 'References', kind: 'ref', glyph: '→', entries: outOf('ref') },
					{ label: 'Holds', kind: 'model', glyph: '◆', entries: outOf('model') },
					{
						label: 'Source',
						kind: 'from',
						glyph: '⇠',
						entries: outOf('from'),
						note: def.derived
					},
					{ label: 'Referenced by', kind: 'ref', glyph: '←', entries: inOf('ref') },
					{ label: 'Feeds', kind: 'from', glyph: '⇢', entries: inOf('from') },
					{
						label: 'Fed by apis',
						kind: 'from',
						glyph: '⇠',
						entries: (uses.fedBy.get(f.field) ?? []).map(apiEntry)
					},
					{
						label: 'Returned by apis',
						kind: 'from',
						glyph: '⇢',
						entries: (uses.returnedBy.get(f.field) ?? []).map(apiEntry)
					},
					{ label: 'Read by logic', kind: 'ref', glyph: '⇢', entries: touchedBy('reads') },
					{ label: 'Written by logic', kind: 'writes', glyph: '⇠', entries: touchedBy('writes') }
				].filter((s) => s.entries.length)
			};
		}
	);

	/**
	 * The clicked logic unit: its inputs, outputs and fails, and its steps as a sequence. What
	 * it handles, reads, writes and calls is all in the sequence, so it is not listed again.
	 */
	const unitCard = $derived.by(() => {
		const u = view.field && isUnit(view.field.field) ? el(view.field.field) : undefined;
		if (!u) return undefined;
		const typeOf = (x: LogicField) =>
			[
				typeText(x, (id) => refLabel(design.model, id)),
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
			seq: u.def.steps?.length ? sequenceOf(design.model, u.id) : undefined
		};
	});

	/** Goes to what a sequence names: picks an api, or flies to a unit's row or a model. */
	function go(id: string) {
		if (isApiEl(id)) return showApi(id);
		const from = view.field && boxById.get(view.field.box);
		const t = from && linkTarget(design.model, boxes, from, id);
		if (t) flyTo({ box: t, field: rowOf(t, id) >= 0 ? id : undefined });
	}

	const statusClass = (s: number) => (s < 300 ? 'ok' : s < 400 ? '' : s < 500 ? 'warn' : 'bad');

	/** The picked api, for the card beside its rail row. */
	const apiCard = $derived.by(() => {
		const a = view.api ? el(view.api) : undefined;
		const host = view.api ? hostOf(view.api) : undefined;
		if (!a || !host) return undefined;
		const names = (ids: string[]) =>
			ids.map((id) => design.model.fields.get(id)?.def.name ?? id).join(', ');
		const d = a.def;
		const bodies = apiBodies(d).map(({ part, body }) => {
			const t = body.model ? linkTarget(design.model, boxes, host, body.model) : undefined;
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
						type: typeText(f, (id) => refLabel(design.model, id)),
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
					const t = linkTarget(design.model, boxes, host, l.field);
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
	});

	/** Where the picked api's row is on screen: the rail's edges and the row's middle. */
	const apiAnchor = $derived.by(() => {
		const host = view.api ? hostOf(view.api) : undefined;
		const r = host && rails.get(host.id);
		if (!view.api || !host || !r) return undefined;
		const { x: vx, y: vy, zoom } = viewport.current;
		const left = host.absX + host.width - r.width / 2;
		const row = openRails.has(host.id) ? railRowY(r, view.api) : undefined;
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
	/** A card `w` wide right of the anchor, or left of it if it does not fit, level with its row. */
	function beside(a: { left: number; right: number; y: number } | undefined, w: number) {
		if (!a) return undefined;
		const right = a.right + 14;
		// Room on neither side (a wide sequence): over the canvas, centred.
		const left =
			right + w <= cw - 8
				? right
				: a.left - 14 - w >= 8
					? a.left - 14 - w
					: Math.max(8, (cw - w) / 2);
		return { left, top: Math.min(Math.max(8, a.y - 24), Math.max(8, ch - cardH - 8)) };
	}
	const cardPos = $derived(beside(apiAnchor, API_W));
	const fieldPos = $derived(beside(fieldAnchor, FIELD_W));
	const unitW = $derived(Math.max(420, unitCard?.seq ? sequenceWidth(unitCard.seq) + 2 : 0));
	const unitPos = $derived(beside(fieldAnchor, unitW));

	/**
	 * Lines from the picked api's row, in screen px: solid to each model its bodies use, and
	 * dashed to the fields a hovered field of its own shape sends into or comes from.
	 */
	const apiLines = $derived.by(() => {
		const host = view.api ? hostOf(view.api) : undefined;
		if (!view.api || !host || !apiAnchor) return [];
		const { x: vx, y: vy, zoom } = viewport.current;
		const out: { d: string; arrow: string; kind: 'ref' | 'from' }[] = [];
		const draw = (t: LandscapeBox, y: number, kind: 'ref' | 'from', arrowAtRail = false) => {
			const tl = t.absX * zoom + vx;
			const tr = (t.absX + t.width) * zoom + vx;
			const ty = y * zoom + vy;
			const leftward = tr <= apiAnchor.left;
			const x0 = leftward ? apiAnchor.left : apiAnchor.right;
			const x1 = x0 + (leftward ? -12 : 12);
			const tx = leftward ? tr : tl;
			const head = (x: number, y: number, dir: number) =>
				`M${x} ${y} L${x - dir * 9} ${y - 4.5} L${x - dir * 9} ${y + 4.5} Z`;
			out.push({
				d: `M${x0} ${apiAnchor.y} H${x1} V${ty} H${tx}`,
				arrow: arrowAtRail
					? head(x0, apiAnchor.y, leftward ? 1 : -1)
					: head(tx, ty, tx < x1 ? -1 : 1),
				kind
			});
		};
		for (const u of bodyModels(design.model, view.api)) {
			const t = linkTarget(design.model, boxes, host, u.model);
			if (!t) continue;
			const s = shownBox(t);
			draw(s, s === t && t.view ? t.absY + TABLE.head / 2 : s.absY + s.height / 2, 'ref');
		}
		const f = view.apiField ? design.model.apiFields.get(view.apiField) : undefined;
		for (const t of apiFieldTargets(view.apiField)) {
			const s = shownBox(t.box);
			const i = t.box.fields?.findIndex((x) => x.id === t.field) ?? -1;
			draw(
				s,
				s === t.box && i >= 0 ? t.box.absY + rowY(t.box, i) : s.absY + s.height / 2,
				'from',
				f?.part !== 'request'
			);
		}
		return out;
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
	 * target's box would be too closed to show it, or the card too big for the canvas. The
	 * centre is nudged so the box round the target stays in view, which is what opens it.
	 */
	function flyTo(target: { box: LandscapeBox; field?: string }, back = false) {
		const t = target.box;
		const area = (t.parentId && boxById.get(t.parentId)) || t;
		const fill = (b: LandscapeBox) => Math.max(b.width / cw, b.height / ch);
		const zoom = Math.min(Math.max(viewport.current.zoom, 0.8 / fill(area)), 0.92 / fill(t));
		const row = rowOf(t, target.field);
		// A row hidden in a folded card is shown by expanding the card.
		if (!all && t.fields && row >= shownRows(t.fields.length, !!view.expanded[t.id]))
			view.expanded = { ...view.expanded, [t.id]: true };
		// Keep [start, start + size] on a canvas side of `side` pixels, if it fits.
		const keep = (c: number, start: number, size: number, side: number) => {
			const half = side / 2 / zoom;
			return size <= 2 * half ? Math.min(Math.max(c, start + size - half), start + half) : c;
		};
		flow.setCenter(
			keep(t.absX + t.width / 2, area.absX, area.width, cw),
			keep(t.absY + (row >= 0 ? rowY(t, row) : t.height / 2), area.absY, area.height, ch),
			{ zoom, duration: 700 }
		);
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

	function goBack() {
		const prev = view.trail.at(-1);
		const box = prev && boxById.get(prev.box);
		if (!prev || !box) return;
		view.trail = view.trail.slice(0, -1);
		flyTo({ box, field: prev.field }, true);
	}

	function unpin() {
		view.api = null;
		view.apiField = null;
		view.field = null;
		view.trail = [];
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			unpin();
			keyOpen = false;
		}
	}}
/>

<div
	class="canvas"
	bind:clientWidth={cw}
	bind:clientHeight={ch}
	style:--z={viewport.current.zoom}
	data-testid="canvas"
>
	<SvelteFlow
		bind:nodes
		{edges}
		{nodeTypes}
		colorMode={theme.current}
		minZoom={0.05}
		maxZoom={64}
		nodesDraggable={false}
		nodesConnectable={false}
		elementsSelectable={false}
		zoomOnDoubleClick={false}
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
				class={keyOpen ? 'key-on' : undefined}
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
	<svg class="defs" aria-hidden="true">
		<defs>
			<marker
				id="sdv-composition"
				viewBox="0 0 16 10"
				refX="16"
				refY="5"
				markerWidth="16"
				markerHeight="10"
				markerUnits="userSpaceOnUse"
				orient="auto-start-reverse"
			>
				<path d="M0,5 L8,0 L16,5 L8,10 Z" fill="var(--sdv-edge)" />
			</marker>
			<marker
				id="sdv-composition-hot"
				viewBox="0 0 16 10"
				refX="16"
				refY="5"
				markerWidth="16"
				markerHeight="10"
				markerUnits="userSpaceOnUse"
				orient="auto-start-reverse"
			>
				<path d="M0,5 L8,0 L16,5 L8,10 Z" fill="var(--sdv-link-ref)" />
			</marker>
		</defs>
	</svg>
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
			<div class="k"><EntityGlyph kind="logic" />Logic<span class="sw logic"></span></div>
			<div class="k"><EntityGlyph kind="api" />APIs<span class="sw api"></span></div>
			<hr />
			<div class="k"><span class="ex"><span class="dashed"></span></span>Owned elsewhere</div>
			<div class="k">
				<svg class="ex" viewBox="0 0 30 10"
					><path d="M1 5h22" stroke="var(--sdv-edge)" stroke-width="1.4" /><path
						d="M29 5 22 1.5v7Z"
						fill="var(--sdv-edge)"
					/></svg
				>Refers to (key)
			</div>
			<div class="k">
				<svg class="ex" viewBox="0 0 30 10"
					><path
						d="M8 5h21"
						stroke="var(--sdv-edge)"
						stroke-width="1.4"
						stroke-dasharray="4 3"
					/><path d="M1 5 8 1.5v7Z" fill="var(--sdv-edge)" /></svg
				>Derives from
			</div>
		</aside>
	{/if}
	<!-- Beside the clicked row, moving with the canvas, so it reads next to what it describes. -->
	{#if inspector && fieldPos}
		<aside
			class="inspector"
			style:left="{fieldPos.left}px"
			style:top="{fieldPos.top}px"
			style:width="{FIELD_W}px"
			bind:clientHeight={cardH}
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
				<button class="icon-btn" onclick={unpin} aria-label="Close" title="Close (Esc)"
					><X size={16} /></button
				>
			</header>
			{#each inspector.sections as s (s.label)}
				<section class={s.kind}>
					<h4>{s.label}</h4>
					{#each s.entries as e, i (i)}
						<button
							class="entry"
							disabled={!e.target && !e.api}
							onclick={() => (e.api ? showApi(e.api) : e.target && flyTo(e.target))}
							onmouseenter={() =>
								(view.hover = e.target?.field
									? { box: e.target.box.id, field: e.target.field }
									: null)}
							onmouseleave={() => (view.hover = null)}
							title={e.target ? 'Go to' : undefined}
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
		</aside>
	{:else if unitCard && unitPos}
		{@const u = unitCard}
		<aside
			class="inspector unit"
			style:left="{unitPos.left}px"
			style:top="{unitPos.top}px"
			style:width="{unitW}px"
			bind:clientHeight={cardH}
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
				<button class="icon-btn" onclick={unpin} aria-label="Close" title="Close (Esc)"
					><X size={16} /></button
				>
			</header>
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
					<h4>Sequence</h4>
					<SequenceDiagram seq={u.seq} onpick={go} />
				</section>
			{/if}
		</aside>
	{:else if apiCard && cardPos}
		{@const api = apiCard}
		<svg class="api-lines" aria-hidden="true">
			{#each apiLines as l, i (i)}
				<path class="line {l.kind}" d={l.d} />
				<path class="head {l.kind}" d={l.arrow} />
			{/each}
		</svg>
		<!-- Beside the picked row, moving with the canvas, so the api and what it uses share a view. -->
		<aside
			class="inspector"
			style:left="{cardPos.left}px"
			style:top="{cardPos.top}px"
			style:width="{API_W}px"
			bind:clientHeight={cardH}
			data-testid="api-inspector"
		>
			<header>
				<div class="head">
					<div class="title">
						<span style:color="var(--sdv-method-{api.method.toLowerCase()}, var(--sdv-text-muted))"
							>{api.method}</span
						>
						<span class="mono">{api.path}</span>
					</div>
					<div class="type">{api.sub}</div>
				</div>
				<button class="icon-btn" onclick={unpin} aria-label="Close" title="Close (Esc)"
					><X size={16} /></button
				>
			</header>
			{#if api.params.length}
				<section>
					<h4>Params</h4>
					{#each api.params as p (p.in + p.name)}
						<div class="entry">
							<span class="text">{p.name}{p.required || p.in === 'path' ? '' : '?'}</span>
							<span class="where"
								>{p.in} · {p.type}{p.description ? ` · ${p.description}` : ''}</span
							>
						</div>
					{/each}
				</section>
			{/if}
			{#each [api.request, ...api.responses].filter((b) => !!b) as b (b.part)}
				<section class="body">
					<h4>
						{#if b.status}<b class="status {statusClass(b.status)}">{b.status}</b
							>{:else}Request{/if}
						{#if b.fields.length}<span class="shape">own shape{b.many ? ', a list' : ''}</span>{/if}
						{#if b.description}<span class="shape">{b.description}</span>{/if}
					</h4>
					{#if b.model}
						{@const m = b.model}
						<button
							class="entry"
							disabled={!m.target}
							onclick={() => m.target && flyTo(m.target)}
							title={m.target ? 'Go to' : undefined}
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
								>{:else if f.title}<span class="traced">{b.part === 'request' ? '→' : '←'}</span
								>{/if}
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
							disabled={!e.target}
							onclick={() => {
								if (!e.target) return;
								view.api = null;
								flyTo(e.target);
							}}
							title={e.target ? 'Go to' : undefined}
						>
							<span class="text" data-glyph="ƒ">{e.text}</span>
							<span class="where">{e.where}</span>
						</button>
					{/each}
				</section>
			{/each}
		</aside>
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
	/* Boxes and lines fade in when mounted and out before they are unmounted (FADE_MS). Children
	   come in after their box's face has gone, and go before it returns, so labels never overlap. */
	.canvas :global(.svelte-flow__node),
	.canvas :global(.svelte-flow__edge.model-link) {
		transition: opacity 0.18s ease-out 0.1s;
		@starting-style {
			opacity: 0;
		}
	}
	.canvas :global(.svelte-flow__node.ghost),
	.canvas :global(.svelte-flow__edge.model-link.off) {
		opacity: 0;
		transition-delay: 0s;
	}
	.canvas :global(.svelte-flow__edge.model-link) {
		pointer-events: none;
	}
	.canvas :global(.model-link .svelte-flow__edge-path) {
		stroke: var(--sdv-edge);
		transition: opacity 0.12s;
	}
	.canvas :global(.model-link.from .svelte-flow__edge-path) {
		stroke-dasharray: 5 4;
	}
	.canvas :global(.model-link.dim .svelte-flow__edge-path) {
		opacity: 0.25;
	}
	/* A lit line keeps 2px on screen at any zoom, so it is found from far out too. */
	.canvas :global(.model-link.hot .svelte-flow__edge-path) {
		stroke: var(--sdv-link-ref);
		stroke-width: 2;
		vector-effect: non-scaling-stroke;
	}
	.canvas :global(.model-link.hot.from .svelte-flow__edge-path) {
		stroke: var(--sdv-link-from);
	}
	.canvas :global(.model-link.hot.writes .svelte-flow__edge-path) {
		stroke: var(--sdv-link-write);
	}
	.canvas :global(.model-link.calls .svelte-flow__edge-path) {
		stroke-dasharray: 2 3;
	}
	.canvas :global(.model-link.hot.calls .svelte-flow__edge-path) {
		stroke: var(--sdv-link-call);
	}
	/* A line to another box is drawn whatever the zoom, so it shows where the other end is. */
	.canvas :global(.svelte-flow__edge.model-link.cross) {
		opacity: 1;
		transition: none;
	}
	.canvas :global(.svelte-flow__controls-button.key-on) {
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
		border: 1px dashed var(--sdv-text-muted);
	}
	.key .sw {
		width: 22px;
		height: 14px;
		margin-left: auto;
		box-sizing: border-box;
		border: 1px solid var(--sdv-model-stroke);
	}
	.key .sw.system {
		background: var(--sdv-system-fill);
		border-color: var(--sdv-system-stroke);
	}
	.key .sw.module {
		background: var(--sdv-container-fill);
		border-color: var(--sdv-container-stroke);
	}
	.key .sw.class {
		background: var(--sdv-model-class-head);
	}
	.key .sw.table {
		background: var(--sdv-model-header);
	}
	.key .sw.logic {
		background: var(--sdv-logic-head);
	}
	.key .sw.api {
		background: var(--sdv-api-fill);
		border-color: var(--sdv-api-stroke);
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
	.inspector header {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		padding: 10px 12px 8px;
		border-bottom: 1px solid var(--sdv-model-stroke);
		background: var(--sdv-model-class-head);
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
	.inspector.unit header {
		background: var(--sdv-logic-head);
	}
	.inspector .fn {
		font-family: Georgia, serif;
		color: var(--sdv-link-call);
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
	.api-lines {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		z-index: 9;
		pointer-events: none;
		overflow: visible;
	}
	.api-lines .line {
		fill: none;
		stroke-width: 2;
	}
	.api-lines .line.ref {
		stroke: var(--sdv-link-ref);
	}
	.api-lines .line.from {
		stroke: var(--sdv-link-from);
		stroke-dasharray: 5 4;
	}
	.api-lines .head.ref {
		fill: var(--sdv-link-ref);
	}
	.api-lines .head.from {
		fill: var(--sdv-link-from);
	}
	.defs {
		position: absolute;
		width: 0;
		height: 0;
	}
	.canvas :global(.svelte-flow__node.ghost) {
		pointer-events: none;
	}
</style>

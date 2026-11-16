<script lang="ts" module>
	import type { ModelField, ModelIndex } from '#lib/model/schema.ts';
	import type { LogicRow, ModelView, TableColumn } from '#lib/landscape/layout.ts';
	import type { ViewState } from '#lib/client/view-state.svelte.ts';

	export interface LandscapeNodeData extends Record<string, unknown> {
		name: string;
		/** The entity drawn: for change marks and their roll-up on a closed box. */
		element: string;
		kind: string;
		group: boolean;
		/** Owner's name when the model is owned elsewhere. */
		owner?: string;
		/** The fields that exist in this view. */
		fields?: ModelField[];
		/** Rows shown folded, when not `FOLD`: a focus's neighbour shows its connecting ones. */
		foldAt?: number;
		indexes?: ModelIndex[];
		/** Field columns; set when the box is a model card. */
		table?: TableColumn[];
		/** Set when the box is a module's logic card: its columns and one row per unit. */
		logic?: { cols: TableColumn[]; rows: LogicRow[] };
		view?: ModelView;
		/** Names of the models and fields the fields point at (ref, model, from), by id. */
		labels?: Record<string, string>;
		/** How many fields refer to and derive from each field, and api fields use it, by field id. */
		incoming?: Record<string, { ref: number; from: number; api: number }>;
		/** Selection, focus and flash; read here so they never rebuild the nodes. */
		state: ViewState;
		/** A field row, a logic card's unit row or a rail's api row was hovered, left or clicked. */
		onfield?: (field: string, ev: 'enter' | 'leave' | 'click') => void;
		/** The box is open, its children shown. */
		open?: boolean;
		/** The name bar (a card's, an open box's tab, or a closed box) was hovered or left. */
		onbox?: (ev: 'enter' | 'leave') => void;
		/** Rail on this box's right border: its own apis, and those of hidden boxes inside it. */
		rail?: RailView;
		onapi?: (api: string) => void;
		/** The closed rail was clicked: zoom in until it opens. */
		onrail?: () => void;
		/** While a scenario is edited: a field row or a model's name bar was right-clicked. */
		onmenu?: (target: string, x: number, y: number) => void;
	}

	export interface RailView {
		top: number;
		width: number;
		height: number;
		scale: number;
		methodWidth: number;
		groups: {
			title?: string;
			/** `y`: the row's middle in the rail at full size. */
			apis: { id: string; name: string; method: string; path: string; y: number }[];
		}[];
	}
</script>

<script lang="ts">
	import { ChevronDown, ChevronUp } from '@lucide/svelte';
	import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/svelte';
	import {
		fieldRowY,
		FOLD,
		logicRowY,
		foldable,
		groupFont,
		HEADER,
		indexFields,
		indexKind,
		KEY_TITLES,
		keysOf,
		LEAF,
		LINK,
		logicNote,
		slotCount,
		shownRows,
		subtitle,
		TABLE,
		typeText
	} from '#lib/landscape/layout.ts';
	import { RAIL } from '#lib/landscape/apis.ts';
	import { NAME_MIN } from '#lib/landscape/open.ts';
	import { GLYPH, textWidth } from '#lib/render/text.ts';
	import { changes } from '#lib/client/changes.svelte.ts';
	import { untrack } from 'svelte';
	import EntityGlyph from './EntityGlyph.svelte';

	let { id, data, width = 0, height = 0 }: NodeProps = $props();
	const d = $derived(data as LandscapeNodeData);
	const hot = $derived(d.state.hot[id]);
	const picked = $derived(d.state.field?.box === id ? d.state.field.field : undefined);
	const flash = $derived(d.state.flash?.box === id ? d.state.flash.field : undefined);
	const apiParts = $derived(d.state.apiBoxes[id]);
	const dim = $derived(d.state.apiDim[id]);
	// A card of over FOLD fields (or `foldAt`) shows the first ones and a row to show all. Expanded, it keeps
	// its laid-out size and draws over whatever is below it (see `.node.expanded`).
	const count = $derived(d.fields?.length ?? 0);
	const expanded = $derived(!!d.state.expanded[id]);
	const at = $derived(d.foldAt ?? FOLD);
	const shown = $derived(d.fields?.slice(0, shownRows(count, expanded, at)) ?? []);
	// A lit row hidden in the fold lights the toggle row instead.
	const hiddenHot = $derived(
		!expanded && (d.fields ?? []).slice(at).some((f) => hot?.[f.id] || picked === f.id)
	);
	// In adaptive detail a card shows its rows, and a rail its endpoints, only near the screen
	// and while they read, or while looked at or at the end of a lit line (see open.ts).
	// Otherwise a card is its frame and name, a rail its name.
	const full = $derived(!!d.state.near[id] || !!d.state.full[id]);
	const railListed = $derived(!!d.rail && (!!d.state.near[id] || !!d.state.full[id]));
	const updateNodeInternals = useUpdateNodeInternals();
	// Handles move with their rows, come with them, and move as rails open; Svelte Flow measures
	// them only when told.
	$effect(() => {
		void expanded;
		void full;
		void railListed;
		updateNodeInternals(id);
	});
	// Opening or closing swaps the hovered part (the whole box, or its tab) without a leave.
	const isOpen = $derived(!!d.open);
	$effect(() => {
		void isOpen;
		return () => untrack(() => d.onbox?.('leave'));
	});
	function toggle(e: MouseEvent) {
		e.stopPropagation();
		const next = { ...d.state.expanded };
		if (expanded) delete next[id];
		else next[id] = true;
		d.state.expanded = next;
	}
	const INCOMING = { inRef: 'ref', inFrom: 'from', inApi: 'api' } as const;
	const plural = (n: number, one: string, many: string) =>
		`${n} field${n > 1 ? 's' : ''} ${n > 1 ? many : one}`;
	// A leaf is fitted round its name, so the name keeps one size.
	const font = $derived(d.group ? groupFont(width, height) : LEAF.font);
	/** The largest font, in canvas px, at which `text` and its glyph fit `w` by `h`. */
	const fit = (text: string, w: number, h: number) =>
		Math.max(0, Math.min(w / (textWidth(text, 100, true) / 100 + GLYPH), h));
	/**
	 * A name's font: `base` canvas px, grown as the canvas zooms out so it stays NAME_MIN px on
	 * screen, but never past `max`, the most its box has room for.
	 */
	const nameFont = (base: number, max: number) =>
		`clamp(${base}px, calc(${NAME_MIN}px / var(--z, 1)), ${Math.max(base, max)}px)`;
	const cardName = $derived(d.logic ? 'Logic' : d.name);
	// A card's title grows within its name bar; its frame alone shows its name across the card.
	const titleFont = $derived(
		nameFont(
			TABLE.title,
			Math.min(fit(cardName, width - 2 * TABLE.pad, Infinity), TABLE.head / 2.2)
		)
	);
	const bodyFont = $derived(
		nameFont(TABLE.title, fit(cardName, width - 2 * TABLE.pad, height * 0.6))
	);
	const leafFont = $derived(
		nameFont(font, fit(d.name, width - (d.rail ? d.rail.width / 2 : 0) - 16, height * 0.6))
	);
	// A closed boundary reads as the model it is drawn round.
	const glyph = $derived(d.kind === 'system' ? 'system' : d.kind === 'model' ? 'class' : 'module');
	// Largest name tab font: the tab (about 1.8em tall) stays inside the header room above the
	// children of every open box. It cannot grow past that: the boxes inside draw over it.
	const hdr = HEADER / 2;
	const label = (id: string) => d.labels?.[id];
	const names = (ids: string[]) => ids.map((id) => label(id) ?? id).join(', ');
	// The last column takes any width the card has to spare.
	const METHOD_TOKEN: Record<string, string> = { PATCH: 'put' };
	const methodColor = (m: string) =>
		['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m)
			? `var(--sdv-method-${METHOD_TOKEN[m] ?? m.toLowerCase()})`
			: 'var(--sdv-text-muted)';
	// Change marks while a scenario or commit is compared: a glyph on what changed, a bar in
	// its severity on what breaks, the rest faded; a closed box carries one count for inside.
	const marks = $derived(changes.marks);
	const comparing = $derived(!!changes.comparison);
	const lv = (id: string) => {
		const l = marks.level.get(id);
		return l === 'breaking' || l === 'check' ? l : undefined;
	};
	const marked = (id: string) =>
		marks.glyph.has(id) || (marks.level.has(id) && marks.level.get(id) !== 'stopped');
	const roll = $derived(marks.rollup.get(d.element));
	const faded = $derived(comparing && !roll);
	const template = (cols: TableColumn[]) =>
		cols
			.map((c, i) => (i < cols.length - 1 ? `${c.width}px` : `minmax(${c.width}px, 1fr)`))
			.join(' ');
</script>

<!-- Open/closed comes from the wrapper's `open` class (set by the canvas), so it never
     re-renders nodes. -->
<div
	class="node"
	class:group={d.group}
	class:selected={d.state.selectedNodes.includes(id)}
	class:peer-box={d.state.peerBoxes[id]}
	class:api-box={apiParts}
	class:expanded={d.table && expanded && full}
	class:system={d.kind === 'system'}
	class:faded={faded && !d.group}
	style:--tab={d.kind === 'model' ? 'var(--sdv-model-class-head)' : 'var(--fill)'}
	style:--fill="var(--sdv-{d.kind}-fill, var(--sdv-container-fill))"
	style:--stroke="var(--sdv-{d.kind}-stroke, var(--sdv-container-stroke))"
	style:--text="var(--sdv-{d.kind}-text, var(--sdv-container-text))"
	style:--hdr="{hdr}px"
	style:--hdrn={hdr}
>
	{#if d.group}
		<!-- Open, the box wears its closed colour as a name tab, so its type still reads. -->
		<div
			class="header"
			role="presentation"
			onmouseenter={() => d.onbox?.('enter')}
			onmouseleave={() => d.onbox?.('leave')}
		>
			<EntityGlyph kind={glyph} />{d.name}
		</div>
	{/if}
	{#if d.table}
		{@const cols = d.table}
		<div
			class="face table"
			class:class={d.view === 'class'}
			class:ref={d.owner && d.view === 'class'}
			class:brief={!full}
			style:--pad="{TABLE.pad}px"
			style:--row="{TABLE.rowHeight}px"
		>
			<div
				class="thead"
				role="presentation"
				style:height="{TABLE.head}px"
				oncontextmenu={(e) => {
					if (!d.onmenu || d.view !== 'class') return;
					e.preventDefault();
					d.onmenu(d.element, e.clientX, e.clientY);
				}}
				onmouseenter={() => d.onbox?.('enter')}
				onmouseleave={() => d.onbox?.('leave')}
			>
				{#if full}
					<div class="name" style:font-size={titleFont}>
						<EntityGlyph
							kind={d.view === 'table' ? 'table' : 'class'}
						/>{#if marks.glyph.has(d.element)}<span class="op">{marks.glyph.get(d.element)}</span
							>{/if}{d.name}
					</div>
					<div class="note" style:font-size="{TABLE.note}px">
						{subtitle(d.view ?? 'class', d.owner)}{#if apiParts}<span class="api-parts">
								· {apiParts.join(', ')}</span
							>{/if}
					</div>
				{/if}
			</div>
			{#if !full}
				<div class="brief-name" style:font-size={bodyFont}>
					<EntityGlyph kind={d.view === 'table' ? 'table' : 'class'} /><span>{d.name}</span>
				</div>
			{/if}
			{#if full && d.fields?.length}
				<div
					class="grid"
					style:font-size="{TABLE.row}px"
					style:grid-template-columns={template(cols)}
				>
					{#each cols as c, ci (c.key)}
						<div
							class="cell th"
							class:first={ci === 0}
							class:mark={c.key === 'required' || c.key === 'nullable'}
							style:font-size="{TABLE.label}px"
							title={c.title}
						>
							{c.label}
						</div>
					{/each}
					{#each shown as f (f.id)}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							class="row"
							class:hot={hot?.[f.id] === 'peer'}
							class:self={hot?.[f.id] === 'self'}
							class:picked={picked === f.id}
							class:flash={flash === f.id}
							class:dim={dim?.[f.id]}
							class:faded={comparing && !marked(f.id)}
							class:gone={marks.dropped.has(f.id)}
							class:sev-break={lv(f.id) === 'breaking'}
							class:sev-check={lv(f.id) === 'check'}
							role="button"
							tabindex="-1"
							oncontextmenu={(e) => {
								if (!d.onmenu) return;
								e.preventDefault();
								d.onmenu(f.id, e.clientX, e.clientY);
							}}
							onmouseenter={() => d.onfield?.(f.id, 'enter')}
							onmouseleave={() => d.onfield?.(f.id, 'leave')}
							onclick={(e) => {
								e.stopPropagation();
								d.onfield?.(f.id, 'click');
							}}
						>
							{#each cols as c, ci (c.key)}
								<div
									class="cell"
									class:first={ci === 0}
									class:muted={c.key === 'type'}
									class:mark={c.key === 'required' || c.key === 'nullable'}
									class:links={c.key === 'links'}
								>
									{#if c.key === 'name'}{#if marks.glyph.has(f.id)}<span class="op"
												>{marks.glyph.get(f.id)}</span
											>{/if}<span class="fname">{f.name}</span
										>{#each d.view === 'table' ? keysOf(f) : [] as k (k)}<span
												class="badge"
												style:font-size="{TABLE.badge}px"
												title={KEY_TITLES[k]}>{k}</span
											>{/each}
									{:else if c.key === 'type'}{typeText(f, label)}
									{:else if c.key === 'required'}{f.required ? TABLE.check : ''}
									{:else if c.key === 'nullable'}{f.nullable ? TABLE.check : ''}
									{:else if c.key === 'constraints'}
										{#each f.constraints ?? [] as k (k)}<span
												class="badge plain"
												style:font-size="{TABLE.badge}px">{k}</span
											>{/each}
									{:else}
										{#each c.slots ?? [] as s (s)}
											{@const n =
												s === 'inRef' || s === 'inFrom' || s === 'inApi'
													? (d.incoming?.[f.id]?.[INCOMING[s]] ?? 0)
													: 0}
											<span
												class="slot {s}"
												style:min-width="{LINK.slot}px"
												style:font-size="{LINK.count}px"
												title={s === 'ref' && f.ref
													? `References ${names([f.ref])}`
													: s === 'from' && f.from?.length
														? `From ${names(f.from)}${f.derived ? ` · ${f.derived}` : ''}`
														: s === 'inRef' && n
															? plural(n, 'refers here', 'refer here')
															: s === 'inFrom' && n
																? plural(n, 'derives from this', 'derive from this')
																: s === 'inApi' && n
																	? `${n} api field${n > 1 ? 's' : ''} send into or return this`
																	: undefined}
											>
												{#if s === 'ref' && f.ref}
													<svg width={LINK.icon} height={LINK.icon} viewBox="0 0 14 14">
														<path d="M1 7h8" /><path class="fill" d="M8 3.5 13 7 8 10.5Z" />
													</svg>
												{:else if s === 'from' && f.from?.length}
													<svg width={LINK.icon} height={LINK.icon} viewBox="0 0 14 14">
														<path d="M1 7h8" stroke-dasharray="2 1.6" /><path
															class="fill"
															d="M8 3.5 13 7 8 10.5Z"
														/>
													</svg>{#if f.derived}<i>ƒ</i>{/if}
												{:else if (s === 'inRef' || s === 'inFrom' || s === 'inApi') && n}
													<span class="count">{slotCount(s, n)}</span>
												{/if}
											</span>
										{/each}
									{/if}
								</div>
							{/each}
						</div>
					{/each}
					{#if foldable(count, at)}
						<button
							class="cell fold"
							class:hot={hiddenHot}
							style:font-size="{TABLE.label}px"
							title={expanded ? 'Show the first fields only' : 'Show every field'}
							onclick={toggle}
						>
							{#if expanded}<ChevronUp size={TABLE.label} />Collapse{:else}<ChevronDown
									size={TABLE.label}
								/>Show all {count} fields ({count - at} more){/if}
						</button>
					{/if}
				</div>
			{/if}
			{#if full && d.indexes?.length}
				<div class="list" style:font-size="{TABLE.row}px">
					<div class="cell th" style:font-size="{TABLE.label}px">Indexes</div>
					{#each d.indexes as ix (ix.name)}
						<div
							class="cell"
							class:gone={!!ix.id && marks.dropped.has(ix.id)}
							class:faded={comparing && !(ix.id && marked(ix.id))}
						>
							{#if ix.id && marks.glyph.has(ix.id)}<span class="op">{marks.glyph.get(ix.id)}</span
								>{/if}
							<span class="badge" class:plain={!ix.unique} style:font-size="{TABLE.badge}px"
								>{indexKind(ix)}</span
							>{ix.name}<span class="muted ix-fields">{indexFields(ix, d.fields ?? [])}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
		<!-- Invisible line ends, each side of the name bar and of every row. -->
		<Handle type="source" id="head:l" position={Position.Left} style="top:{TABLE.head / 2}px" />
		<Handle type="source" id="head:r" position={Position.Right} style="top:{TABLE.head / 2}px" />
		{#each full ? (d.fields ?? []) : [] as f, i (f.id)}
			{@const y = fieldRowY(i, count, expanded, at)}
			<Handle type="source" id="row:{f.id}:l" position={Position.Left} style="top:{y}px" />
			<Handle type="source" id="row:{f.id}:r" position={Position.Right} style="top:{y}px" />
		{/each}
	{:else if d.logic}
		{@const cols = d.logic.cols}
		{@const rows = d.logic.rows}
		<div
			class="face table logic"
			class:brief={!full}
			style:--pad="{TABLE.pad}px"
			style:--row="{TABLE.rowHeight}px"
		>
			<div
				class="thead"
				role="presentation"
				style:height="{TABLE.head}px"
				onmouseenter={() => d.onbox?.('enter')}
				onmouseleave={() => d.onbox?.('leave')}
			>
				{#if full}
					<div class="name" style:font-size={titleFont}>
						<EntityGlyph kind="logic" />Logic
					</div>
					<div class="note" style:font-size="{TABLE.note}px">{logicNote(rows.length)}</div>
				{/if}
			</div>
			{#if !full}
				<div class="brief-name" style:font-size={bodyFont}>
					<EntityGlyph kind="logic" /><span>Logic</span>
				</div>
			{/if}
			<div
				class="grid"
				style:font-size="{TABLE.row}px"
				style:grid-template-columns={template(cols)}
			>
				{#each full ? rows : [] as u (u.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div
						class="row"
						class:hot={hot?.[u.id] === 'peer'}
						class:self={hot?.[u.id] === 'self'}
						class:picked={picked === u.id}
						class:flash={flash === u.id}
						class:faded={comparing && !marked(u.id)}
						class:gone={marks.dropped.has(u.id)}
						class:hid={changes.hidden.has(u.id)}
						class:sev-break={lv(u.id) === 'breaking'}
						class:sev-check={lv(u.id) === 'check'}
						role="button"
						tabindex="-1"
						onmouseenter={() => d.onfield?.(u.id, 'enter')}
						onmouseleave={() => d.onfield?.(u.id, 'leave')}
						onclick={(e) => {
							e.stopPropagation();
							d.onfield?.(u.id, 'click');
						}}
					>
						<div class="cell first">
							<i class="fn">ƒ</i>{#if marks.glyph.has(u.id)}<span class="op"
									>{marks.glyph.get(u.id)}</span
								>{/if}<span class="fname">{u.name}</span>
						</div>
						<div class="cell sig" style:font-size="{TABLE.signature}px">{u.signature}</div>
					</div>
				{/each}
			</div>
		</div>
		<Handle type="source" id="head:l" position={Position.Left} style="top:{TABLE.head / 2}px" />
		<Handle type="source" id="head:r" position={Position.Right} style="top:{TABLE.head / 2}px" />
		{#each full ? rows : [] as u, i (u.id)}
			{@const y = logicRowY(i)}
			<Handle type="source" id="row:{u.id}:l" position={Position.Left} style="top:{y}px" />
			<Handle type="source" id="row:{u.id}:r" position={Position.Right} style="top:{y}px" />
		{/each}
	{:else}
		<!-- Closed, the whole box is its name bar; lines at rest end on its sides. -->
		{#if !d.open}
			<div
				class="hit"
				role="presentation"
				onmouseenter={() => d.onbox?.('enter')}
				onmouseleave={() => d.onbox?.('leave')}
			></div>
		{/if}
		<Handle type="source" id="head:l" position={Position.Left} />
		<Handle type="source" id="head:r" position={Position.Right} />
		<!-- Open, a box is drawn by its border and name tab alone. -->
		{#if !d.open}
			<div
				class="face"
				style:font-size={leafFont}
				style:--fs={font}
				style:padding-right={!d.group && d.rail ? `${d.rail.width / 2}px` : undefined}
			>
				<div class="name">
					<EntityGlyph kind={glyph} />{#if marks.glyph.has(d.element)}<span class="op"
							>{marks.glyph.get(d.element)}</span
						>{/if}{d.name}
				</div>
			</div>
		{/if}
		{#if roll && !d.open}
			<span
				class="roll"
				class:sev-break={roll.level === 'breaking'}
				class:sev-check={roll.level === 'check'}
				title="{roll.count} changed or affected inside">{roll.count}</span
			>
		{/if}
	{/if}
	{#if d.rail}
		{@const r = d.rail}
		<!-- Straddles the right border; its rows are laid out at full size, then scaled to fit. -->
		<div
			class="rail"
			class:closed={!railListed}
			style:left="{width - r.width / 2}px"
			style:top="{r.top}px"
			style:width="{r.width}px"
			style:height="{r.height}px"
		>
			<!-- An api's line ends on its row, or the rail's middle while the rail is closed. -->
			{#each r.groups.flatMap((g) => g.apis) as a (a.id)}
				{@const y = railListed ? a.y * r.scale : r.height / 2}
				<Handle type="source" id="api:{a.id}:l" position={Position.Left} style="top:{y}px" />
				<Handle type="source" id="api:{a.id}:r" position={Position.Right} style="top:{y}px" />
			{/each}
			{#if railListed}
				<div
					class="rail-inner"
					style:width="{r.width / r.scale}px"
					style:transform="scale({r.scale})"
				>
					<div class="rail-head" style:height="{RAIL.head}px" style:font-size="{RAIL.label}px">
						<EntityGlyph kind="api" />APIs
					</div>
					{#each r.groups as g, gi (gi)}
						{#if g.title}
							<div
								class="rail-group"
								style:height="{RAIL.group}px"
								style:font-size="{RAIL.label}px"
							>
								{g.title}
							</div>
						{/if}
						{#each g.apis as a (a.id)}
							<button
								class="rail-row"
								class:picked={d.state.api === a.id}
								class:hot={d.state.hotApis[a.id]}
								class:faded={comparing && !marked(a.id)}
								class:gone={marks.dropped.has(a.id)}
								class:hid={changes.hidden.has(a.id)}
								class:sev-break={lv(a.id) === 'breaking'}
								class:sev-check={lv(a.id) === 'check'}
								style:height="{RAIL.row}px"
								style:font-size="{RAIL.font}px"
								style:padding="0 {RAIL.pad}px"
								style:gap="{RAIL.gap}px"
								title={a.name}
								onmouseenter={() => d.onfield?.(a.id, 'enter')}
								onmouseleave={() => d.onfield?.(a.id, 'leave')}
								onclick={(e) => {
									e.stopPropagation();
									d.onapi?.(a.id);
								}}
							>
								{#if marks.glyph.has(a.id)}<span class="op">{marks.glyph.get(a.id)}</span>{/if}<b
									style:color={methodColor(a.method)}
									style:min-width="{r.methodWidth}px">{a.method}</b
								><span>{a.path}</span>
							</button>
						{/each}
					{/each}
				</div>
			{:else}
				<button
					class="rail-name"
					style:font-size={nameFont(
						Math.min(RAIL.font, fit('APIs', r.width - 8, r.height * 0.6)),
						fit('APIs', r.width - 8, r.height * 0.6)
					)}
					title="Zoom in to list the apis"
					onclick={(e) => {
						e.stopPropagation();
						d.onrail?.();
					}}><EntityGlyph kind="api" />APIs</button
				>
			{/if}
		</div>
	{/if}
</div>

<style>
	.node {
		position: relative;
		width: 100%;
		height: 100%;
		box-sizing: border-box;
		cursor: pointer;
	}
	.node.group {
		/* Solid: dashed is kept for "owned elsewhere". At least one screen pixel wide. */
		--bw: max(1px, calc(1px / var(--z)));
		border: var(--bw) solid var(--stroke);
		background: var(--sdv-boundary-fill);
	}
	.node.group.system {
		border-color: color-mix(in srgb, var(--sdv-system-fill) 55%, transparent);
	}
	/* Opening: the face goes at once, the header and children come in after (see the canvas).
	   Closing: the children go at once, the face comes back after. */
	.node.group > .face,
	.node.group > .header {
		transition: opacity 0.15s ease-out 0.1s;
	}
	.node.group > .header,
	:global(.svelte-flow__node.open) > .node.group > .face {
		opacity: 0;
		transition-delay: 0s;
	}
	:global(.svelte-flow__node.open) > .node.group > .header {
		opacity: 1;
		transition-delay: 0.1s;
		/* Open, the tab is the box's name bar: hovering it draws the box's connections. */
		pointer-events: auto;
	}
	.node.peer-box {
		outline: 2px solid var(--sdv-link-ref);
		outline-offset: 3px;
	}
	.node.selected {
		outline: 2px solid var(--sdv-selection);
		outline-offset: 2px;
	}
	.hit {
		position: absolute;
		inset: 0;
	}
	.face {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.2em;
		padding: 0.4em;
		box-sizing: border-box;
		text-align: center;
		background: var(--fill);
		border: 1px solid var(--stroke);
		color: var(--text);
		pointer-events: none;
	}
	.name {
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
		font-weight: 600;
	}
	/* Below 9px on screen a glyph can't be read; lightness and form still tell types apart. */
	.face:not(.table) .name {
		--glyph-opacity: clamp(0, calc((var(--fs) * var(--z) - 8) * 0.75), 0.75);
	}
	/* Model as a table card: a name bar, then a fields table and an indexes table. */
	.face.table {
		justify-content: flex-start;
		align-items: stretch;
		gap: 0;
		padding: 0;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		background: var(--sdv-model-fill);
		border-color: var(--sdv-model-stroke);
		color: var(--sdv-model-text);
	}
	/* A card drawn as its frame: its name across the whole card, as large as reads. Its name
	   bar stays for hovering, untinted, so the name does not straddle it. */
	.node .face.table.brief .thead {
		background: none;
	}
	.brief-name {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35em;
		padding: 0 var(--pad);
		font-weight: 600;
		white-space: nowrap;
		pointer-events: none;
	}
	.brief-name span {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Rows take the pointer. */
	.face.table {
		pointer-events: inherit;
	}
	.face.table.ref {
		border-style: dashed;
	}
	/* A class has a tinted name bar; a table a plain one. */
	.face.table.class .thead {
		background: var(--sdv-model-class-head);
	}
	.thead {
		display: flex;
		flex-direction: column;
		justify-content: center;
		flex-shrink: 0;
		padding: 0 var(--pad);
		line-height: 1.35;
	}
	.note,
	.muted {
		color: var(--sdv-text-muted);
	}
	.grid {
		display: grid;
		grid-auto-rows: var(--row);
	}
	/* A field row: one subgrid line, so it can be hovered, lit and clicked as a whole. */
	.row {
		display: grid;
		grid-column: 1 / -1;
		grid-template-columns: subgrid;
		outline: none;
	}
	.row:hover {
		background: var(--sdv-row-hover);
	}
	.row.hot {
		background: var(--sdv-row-peer);
	}
	.row.self,
	.row.picked {
		background: var(--sdv-row-self);
		box-shadow: inset 3px 0 0 var(--sdv-selection);
	}
	.row.flash {
		animation: flash 1.4s ease-out;
	}
	@keyframes flash {
		0%,
		35% {
			background: var(--sdv-row-flash);
		}
	}
	.cell.links {
		gap: 0;
		padding-left: 4px;
		padding-right: 6px;
	}
	.slot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 1px;
		height: 100%;
		color: var(--sdv-text-muted);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.slot.ref {
		color: var(--sdv-link-ref);
	}
	.slot.from {
		color: var(--sdv-link-from);
	}
	/* Incoming links: a count in a pill, like a badge, so it reads as "used by n". */
	.slot .count {
		min-width: 8px;
		padding: 0 4px;
		line-height: 15px;
		border-radius: 8px;
		text-align: center;
		color: var(--sdv-model-fill);
	}
	.slot.inRef .count {
		background: var(--sdv-link-ref);
	}
	.slot.inFrom .count {
		background: var(--sdv-link-from);
	}
	.slot i {
		font-family: Georgia, serif;
		font-size: 11px;
		margin-left: -1px;
	}
	.slot svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
	}
	.slot svg .fill {
		fill: currentColor;
		stroke: none;
	}
	/* The toggle row of a folded card. */
	.cell.fold {
		grid-column: 1 / -1;
		gap: 3px;
		justify-content: center;
		border-left: none;
		border-right: none;
		border-bottom: none;
		background: var(--sdv-model-header);
		color: var(--sdv-text-muted);
		font-family: inherit;
		font-weight: 600;
		letter-spacing: 0.02em;
		cursor: pointer;
	}
	.cell.fold:hover {
		background: var(--sdv-row-hover);
		color: var(--sdv-model-text);
	}
	.cell.fold.hot {
		background: var(--sdv-row-peer);
	}
	/* Expanded, the card grows past its laid-out size, over the boxes below it. */
	.node.expanded {
		height: auto;
		min-height: 100%;
	}
	.node.expanded > .face.table {
		position: relative;
		inset: auto;
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.25);
	}
	:global(.svelte-flow__node:has(> .node.expanded)) {
		z-index: 999 !important;
	}
	/* A module's logic card: a tinted name bar, then a unit per row with its signature. */
	.face.table.logic .thead {
		background: var(--sdv-logic-head);
	}
	.fn {
		width: 10px;
		margin-right: 0;
		font-family: Georgia, serif;
		color: var(--sdv-link-call);
	}
	/* A unit's signature: names in, outputs out; muted, so the unit's name leads. */
	.cell.sig {
		color: var(--sdv-text-muted);
		white-space: nowrap;
	}
	.list {
		display: grid;
		grid-auto-rows: var(--row);
	}
	.list .cell {
		border-left: none;
	}
	.ix-fields {
		margin-left: 4px;
	}
	.cell {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 var(--pad);
		border-top: 1px solid var(--sdv-model-stroke);
		border-left: 1px solid var(--sdv-model-stroke);
	}
	.cell.first {
		border-left: none;
	}
	.cell.mark {
		justify-content: center;
	}
	.th {
		background: var(--sdv-model-header);
		color: var(--sdv-text-muted);
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	.badge {
		padding: 0 6px;
		line-height: 1.6;
		font-weight: 600;
		background: var(--sdv-model-key-fill);
		color: var(--sdv-model-key-text);
	}
	.badge.plain {
		background: var(--sdv-model-header);
		color: var(--sdv-text-muted);
	}
	.node :global(.svelte-flow__handle) {
		opacity: 0;
		pointer-events: none;
	}
	.node.api-box {
		outline: 2px solid var(--sdv-link-ref);
		outline-offset: 3px;
	}
	.api-parts {
		color: var(--sdv-link-ref);
		font-weight: 600;
	}
	.row.dim {
		opacity: 0.35;
	}
	/* Change marks. */
	.faded {
		opacity: 0.38;
	}
	.node.faded {
		opacity: 0.45;
	}
	.op {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.15em;
		height: 1.15em;
		margin-right: 0.35em;
		flex: none;
		border-radius: 0.2em;
		background: var(--sdv-op-fill);
		color: var(--sdv-op-text);
		font-weight: 700;
		font-size: 0.85em;
		line-height: 1;
	}
	.sev-break {
		box-shadow: inset 3px 0 0 var(--sdv-sev-break);
		background: color-mix(in srgb, var(--sdv-sev-break) 8%, transparent);
	}
	.sev-check {
		box-shadow: inset 3px 0 0 var(--sdv-sev-check);
		background: color-mix(in srgb, var(--sdv-sev-check) 9%, transparent);
	}
	/* Gated off in the shown flag state: its room is kept so setting a flag moves nothing. */
	.hid {
		visibility: hidden;
	}
	.gone {
		background: repeating-linear-gradient(
			135deg,
			transparent 0 6px,
			color-mix(in srgb, var(--sdv-edge) 12%, transparent) 6px 7px
		);
	}
	.gone .fname {
		text-decoration: line-through;
		color: var(--sdv-text-muted);
	}
	/* One count per closed box: what changed or is affected inside, in the worst severity. */
	.roll {
		position: absolute;
		top: 0;
		right: 0;
		transform: translate(40%, -40%) scale(calc(1 / var(--z, 1)));
		min-width: 22px;
		height: 22px;
		box-sizing: border-box;
		padding: 0 7px;
		border-radius: 11px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 13px;
		font-weight: 700;
		color: #fff;
		background: var(--sdv-edge);
		pointer-events: none;
		z-index: 2;
	}
	.roll.sev-break {
		background: var(--sdv-sev-break);
		box-shadow: none;
	}
	.roll.sev-check {
		background: var(--sdv-sev-check);
		box-shadow: none;
	}

	.slot.inApi .count {
		background: var(--sdv-api-stroke);
	}
	/* The rail straddles the right border; the half outside sits in room the layout keeps. */
	.rail {
		position: absolute;
		box-sizing: border-box;
		overflow: hidden;
		background: var(--sdv-api-fill);
		border: 1px solid var(--sdv-api-stroke);
		color: var(--sdv-api-text);
		pointer-events: auto;
		cursor: default;
	}
	.rail-inner {
		transform-origin: 0 0;
	}
	.rail-head,
	.rail-group {
		display: flex;
		align-items: center;
		gap: 0.4em;
		padding: 0 10px;
		font-weight: 600;
		letter-spacing: 0.02em;
		white-space: nowrap;
		color: var(--sdv-text-muted);
		background: var(--sdv-model-header);
		border-bottom: 1px solid var(--sdv-model-stroke);
	}
	.rail-row {
		display: flex;
		align-items: center;
		width: 100%;
		box-sizing: border-box;
		border: none;
		border-bottom: 1px solid var(--sdv-model-stroke);
		background: none;
		color: inherit;
		font-family: inherit;
		text-align: left;
		white-space: nowrap;
		cursor: pointer;
	}
	.rail-row b {
		font-weight: 700;
	}
	.rail-row:hover {
		background: var(--sdv-row-hover);
	}
	.rail-row.hot {
		background: var(--sdv-row-peer);
	}
	.rail-row.picked {
		background: var(--sdv-row-self);
		box-shadow: inset 3px 0 0 var(--sdv-selection);
	}
	.rail-name {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.3em;
		width: 100%;
		height: 100%;
		border: none;
		background: none;
		color: inherit;
		font-family: inherit;
		font-weight: 600;
		cursor: zoom-in;
		padding: 0;
	}
	.header {
		position: absolute;
		left: calc(-1 * var(--bw));
		top: calc(-1 * var(--bw));
		display: flex;
		align-items: center;
		gap: 0.4em;
		padding: 0.3em 0.75em 0.3em 0.55em;
		font-size: min(calc(13px / var(--z)), var(--hdr));
		line-height: 1.2;
		--glyph-opacity: clamp(0, calc((min(13, var(--hdrn) * var(--z)) - 8) * 0.75), 0.75);
		font-weight: 600;
		background: var(--tab);
		border: var(--bw) solid var(--stroke);
		color: var(--text);
		white-space: nowrap;
		pointer-events: none;
	}
</style>

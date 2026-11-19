<script lang="ts" module>
	import type { ModelField, ModelIndex } from '#lib/model/schema.ts';
	import type { LogicRow, ModelView, TableColumn } from '#lib/landscape/layout.ts';
	import type { ViewState } from '#lib/client/view-state.svelte.ts';

	/** A model, logic or triggers card, as the peek draws it. */
	export interface CardData {
		name: string;
		/** The entity drawn: for change marks. */
		element: string;
		/** Owner's name when the model is owned elsewhere. */
		owner?: string;
		/** The fields that exist in this view. */
		fields?: ModelField[];
		/** Rows shown folded, when not `FOLD`: a focus's neighbour shows its connecting ones. */
		foldAt?: number;
		indexes?: ModelIndex[];
		/** Field columns; set when the card is a model card. */
		table?: TableColumn[];
		/** Set when the card is a module's logic card: its columns and one row per unit. */
		logic?: { cols: TableColumn[]; rows: LogicRow[] };
		/** Set when the card is a module's triggers card: one row per trigger, its schedule in words. */
		triggers?: { cols: TableColumn[]; rows: LogicRow[] };
		view?: ModelView;
		/** Names of the models and fields the fields point at (ref, model, from), by id. */
		labels?: Record<string, string>;
		/** How many fields refer to and derive from each field, and api fields use it, by field id. */
		incoming?: Record<string, { ref: number; from: number; api: number }>;
		/** Lit rows, the pick and the flash, read as the canvas lights them. */
		state: ViewState;
		/** A field, unit or trigger row was hovered, left or clicked. */
		onfield: (field: string, ev: 'enter' | 'leave' | 'click') => void;
	}
</script>

<script lang="ts">
	import { ChevronDown, ChevronUp } from '@lucide/svelte';
	import {
		FOLD,
		foldable,
		indexFields,
		indexKind,
		KEY_TITLES,
		keysOf,
		LINK,
		logicNote,
		triggersNote,
		kindWord,
		ownerNote,
		slotCount,
		shownRows,
		TABLE,
		typeText
	} from '#lib/landscape/layout.ts';
	import { changes } from '#lib/client/changes.svelte.ts';
	import EntityGlyph from './EntityGlyph.svelte';

	/**
	 * A card of the canvas drawn as page elements, at full size, for the peek beside the
	 * inspector: what the canvas draws on its WebGL layer (see GlLayer), rows and all, so it can
	 * be read, hovered and clicked away from where it sits. It folds on its own.
	 */
	let { id, data: d }: { id: string; data: CardData } = $props();
	const hot = $derived(d.state.hot[id]);
	const picked = $derived(d.state.field?.box === id ? d.state.field.field : undefined);
	const flash = $derived(d.state.flash?.box === id ? d.state.flash.field : undefined);
	const apiParts = $derived(d.state.apiBoxes[id]);
	const dim = $derived(d.state.apiDim[id]);
	// A card of over FOLD fields (or `foldAt`) shows the first ones and a row to show all.
	const count = $derived(d.fields?.length ?? 0);
	let expanded = $state(false);
	const at = $derived(d.foldAt ?? FOLD);
	const shown = $derived(d.fields?.slice(0, shownRows(count, expanded, at)) ?? []);
	// A lit row hidden in the fold lights the toggle row instead.
	const hiddenHot = $derived(
		!expanded && (d.fields ?? []).slice(at).some((f) => hot?.[f.id] || picked === f.id)
	);
	function toggle(e: MouseEvent) {
		e.stopPropagation();
		expanded = !expanded;
	}
	const INCOMING = { inRef: 'ref', inFrom: 'from', inApi: 'api' } as const;
	const plural = (n: number, one: string, many: string) =>
		`${n} field${n > 1 ? 's' : ''} ${n > 1 ? many : one}`;
	const cardName = $derived(d.logic ? 'Logic' : d.triggers ? 'Triggers' : d.name);
	const label = (id: string) => d.labels?.[id];
	const names = (ids: string[]) => ids.map((id) => label(id) ?? id).join(', ');
	// Change marks while a scenario or commit is compared: a glyph on what changed, a bar in
	// its severity on what breaks, the rest faded.
	const marks = $derived(changes.marks);
	const comparing = $derived(!!changes.comparison);
	const lv = (id: string) => {
		const l = marks.level.get(id);
		return l === 'breaking' || l === 'check' ? l : undefined;
	};
	const marked = (id: string) =>
		marks.glyph.has(id) || (marks.level.has(id) && marks.level.get(id) !== 'stopped');
	// The last column takes any width the card has to spare.
	const template = (cols: TableColumn[]) =>
		cols
			.map((c, i) => (i < cols.length - 1 ? `${c.width}px` : `minmax(${c.width}px, 1fr)`))
			.join(' ');
</script>

<div class="node" class:expanded={d.table && expanded}>
	{#if d.table}
		{@const cols = d.table}
		<div
			class="face table"
			class:class={d.view === 'class'}
			class:stored={d.view === 'table'}
			class:ref={d.owner && d.view === 'class'}
			style:--pad="{TABLE.pad}px"
			style:--row="{TABLE.rowHeight}px"
		>
			<div class="thead" style:height="{TABLE.head}px">
				<div class="title-row">
					<div class="name" style:font-size="{TABLE.title}px">
						<EntityGlyph
							kind={d.view === 'table' ? 'table' : 'class'}
						/>{#if marks.glyph.has(d.element)}<span class="op">{marks.glyph.get(d.element)}</span
							>{/if}{d.name}
					</div>
					<span class="kind-word" style:font-size="{TABLE.label}px"
						>{kindWord(d.view ?? 'class')}</span
					>
				</div>
				<div class="note" style:font-size="{TABLE.note}px">
					{ownerNote(d.owner)}{#if apiParts}<span class="api-parts"
							>{d.owner ? ' · ' : ''}{apiParts.join(', ')}</span
						>{/if}
				</div>
			</div>
			{#if d.fields?.length}
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
							onmouseenter={() => d.onfield(f.id, 'enter')}
							onmouseleave={() => d.onfield(f.id, 'leave')}
							onclick={(e) => {
								e.stopPropagation();
								d.onfield(f.id, 'click');
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
			{#if d.indexes?.length}
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
	{:else if d.logic || d.triggers}
		{@const card = (d.logic ?? d.triggers)!}
		{@const cols = card.cols}
		{@const rows = card.rows}
		<div
			class="face table"
			class:logic={!!d.logic}
			class:triggers={!!d.triggers}
			style:--pad="{TABLE.pad}px"
			style:--row="{TABLE.rowHeight}px"
		>
			<div class="thead" style:height="{TABLE.head}px">
				<div class="name" style:font-size="{TABLE.title}px">
					<EntityGlyph kind={d.logic ? 'logic' : 'triggers'} />{cardName}
				</div>
				<div class="note" style:font-size="{TABLE.note}px">
					{d.logic ? logicNote(rows.length) : triggersNote(rows.length)}
				</div>
			</div>
			<div
				class="grid"
				style:font-size="{TABLE.row}px"
				style:grid-template-columns={template(cols)}
			>
				{#each rows as u (u.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div
						class="row"
						class:hot={hot?.[u.id] === 'peer'}
						class:self={hot?.[u.id] === 'self'}
						class:caller={hot?.[u.id] === 'caller'}
						class:picked={picked === u.id}
						class:flash={flash === u.id}
						class:faded={comparing && !marked(u.id)}
						class:gone={marks.dropped.has(u.id)}
						class:hid={changes.hidden.has(u.id)}
						class:sev-break={lv(u.id) === 'breaking'}
						class:sev-check={lv(u.id) === 'check'}
						role="button"
						tabindex="-1"
						onmouseenter={() => d.onfield(u.id, 'enter')}
						onmouseleave={() => d.onfield(u.id, 'leave')}
						onclick={(e) => {
							e.stopPropagation();
							d.onfield(u.id, 'click');
						}}
					>
						<div class="cell first">
							{#if d.logic}<i class="fn">ƒ</i>{:else}<EntityGlyph
									kind={u.message ? 'message' : 'trigger'}
								/>{/if}{#if marks.glyph.has(u.id)}<span class="op">{marks.glyph.get(u.id)}</span
								>{/if}<span class="fname">{u.name}</span>
						</div>
						<div class="cell sig" style:font-size="{TABLE.signature}px">{u.signature}</div>
					</div>
				{/each}
			</div>
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
	.face {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
	}
	.name {
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
		font-weight: 600;
	}
	/* A card: a name bar, then a fields table and an indexes table. Its kind shows in its
	   line, corner, icon and name colour: line (--kl), icon (--ki), name (--kt), rules (--ks). */
	.face.table {
		--kl: var(--sdv-kind-class);
		--ki: var(--sdv-kind-class-icon);
		--kt: var(--sdv-kind-class-text);
		--ks: var(--sdv-kind-class-soft);
		justify-content: flex-start;
		align-items: stretch;
		gap: 0;
		padding: 0;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		background: var(--sdv-model-fill);
		border: 1.5px solid var(--kl);
		border-radius: 8px;
		color: var(--sdv-model-text);
	}
	/* A stored table: near-square, with its name bar ruled off in the line colour. */
	.face.table.stored {
		--kl: var(--sdv-kind-table);
		--ki: var(--sdv-kind-table-icon);
		--kt: var(--sdv-kind-table-text);
		--ks: var(--sdv-kind-table-soft);
		border-radius: 3px;
	}
	.face.table.stored .thead {
		border-bottom: 1.5px solid var(--kl);
	}
	/* Logic: a thinner line and a ring 2px outside it. */
	.face.table.logic {
		--kl: var(--sdv-kind-logic);
		--ki: var(--sdv-kind-logic-icon);
		--kt: var(--sdv-kind-logic-text);
		--ks: var(--sdv-kind-logic-soft);
		border-radius: 10px;
		border-width: 1px;
		box-shadow:
			0 0 0 2px var(--sdv-model-fill),
			0 0 0 3px var(--kl);
	}
	/* Triggers: the one kind whose name bar is tinted, ruled off in the line colour. */
	.face.table.triggers {
		--kl: var(--sdv-kind-trigger);
		--ki: var(--sdv-kind-trigger-icon);
		--kt: var(--sdv-kind-trigger-text);
		--ks: var(--sdv-kind-trigger-soft);
		border-radius: 6px;
	}
	.face.table.triggers .thead {
		background: var(--sdv-kind-trigger-head);
		border-bottom: 1.5px solid var(--kl);
	}
	.face.table .name {
		color: var(--kt);
	}
	.face.table.ref {
		border-style: dashed;
	}
	/* The name, and the card's type word at the right. */
	.title-row {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.kind-word {
		margin-left: auto;
		flex: none;
		letter-spacing: 0.07em;
		font-weight: 600;
		color: var(--kt);
		opacity: 0.75;
	}
	.thead {
		border-bottom: 1px solid var(--ks);
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
	.row.caller {
		box-shadow: inset 3px 0 0 var(--sdv-link-call);
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
	.slot.inApi .count {
		background: var(--sdv-api-stroke);
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
	/* Expanded, the card grows past its laid-out size. */
	.node.expanded {
		height: auto;
		min-height: 100%;
	}
	.node.expanded > .face.table {
		position: relative;
		inset: auto;
	}
	/* A module's logic card: a name bar, then a unit per row with its signature. The name bar's
	   rule is the first row's top. */
	.face.table.logic .grid > .row:first-child > .cell,
	.face.table.triggers .grid > .row:first-child > .cell {
		border-top: none;
	}
	.fn {
		width: 10px;
		margin-right: 0;
		font-family: Georgia, serif;
		color: var(--sdv-kind-logic-icon);
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
		border-top: 1px solid var(--ks, var(--sdv-model-stroke));
		border-left: 1px solid var(--ks, var(--sdv-model-stroke));
	}
	/* The name bar's rule is the column labels' top. */
	.grid > .th {
		border-top: none;
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
</style>

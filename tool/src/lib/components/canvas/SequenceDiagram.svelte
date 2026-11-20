<script lang="ts">
	import EntityGlyph, { type GlyphKind } from './EntityGlyph.svelte';
	import Ident from '../Ident.svelte';
	import { SEQ, sequenceWidth, type Lifeline, type Sequence } from '#lib/landscape/sequence.ts';
	import { methodColor } from '#lib/theme/tokens.ts';
	import { textWidth } from '#lib/render/text.ts';

	// A logic unit's steps as a sequence diagram: a lifeline per participant, a row per
	// message, alt and loop boxes round branches. Clicking a name or message goes to it.
	// Labels, notes and guards wrap to their room and their rows grow to fit; the heads stay on
	// top while the pane scrolls. `col`: the lifelines' spacing, closed up to fit the pane.
	let {
		seq,
		col = SEQ.col,
		onpick
	}: { seq: Sequence; col?: number; onpick: (id: string) => void } = $props();

	const GLYPH: Record<string, GlyphKind | undefined> = {
		self: 'logic',
		unit: 'module',
		owner: 'module',
		model: 'class'
	};
	const width = $derived(sequenceWidth(seq, col));
	const headW = $derived(col - 12);
	const headTop = 4;
	const x = (lane: number) => SEQ.edge + lane * col;
	const inset = (depth: number) => 14 + depth * 8;

	/** A unit's lane leads with the unit, its module under it: lanes into one module differ. */
	const headOf = (l: Lifeline) =>
		l.kind === 'unit' && l.subs[0]
			? { name: l.subs[0].text, target: l.subs[0].target, subs: [{ text: l.name }] }
			: { name: l.name, target: l.target, subs: l.subs };

	// Measured: each head's height, and the text in each row (label, note or guard).
	let headHs = $state<number[]>([]);
	let fit = $state<number[]>([]);
	const headH = $derived(
		Math.max(
			24 + Math.max(1, ...seq.lifelines.map((l) => l.subs.length)) * SEQ.sub,
			...headHs.slice(0, seq.lifelines.length).filter(Boolean)
		)
	);

	/** What each row holds, and so how much room round its text it needs. */
	const kinds = $derived.by(() => {
		const k: ('msg' | 'note' | 'frag' | 'div')[] = Array(seq.rows).fill('msg');
		for (const n of seq.notes) k[n.row] = 'note';
		for (const f of seq.frags) {
			k[f.top] = 'frag';
			for (const d of f.dividers) k[d.row] = 'div';
		}
		return k;
	});
	const PAD = { msg: 15, note: 8, frag: 10, div: 12 };
	const heights = $derived(
		kinds.map((k, r) => Math.max(SEQ.row, (fit[r] || (k === 'note' ? 16 : 14)) + PAD[k]))
	);
	const tops = $derived.by(() => {
		const t: number[] = [];
		let y = headTop + headH + 15;
		for (const h of heights) {
			t.push(y);
			y += h;
		}
		t.push(y);
		return t;
	});
	const top = (row: number) => tops[row];
	const bottomOf = (row: number) => tops[row + 1];
	/** A message's arrow: 15 px above its row's foot, its label above that. */
	const arrowY = (row: number) => bottomOf(row) - 15;
	const last = $derived(seq.rows - 1);
	const bottom = $derived(bottomOf(last) + 6);
	const height = $derived(bottom + 4);
	/** The unit's activation bar: from its first row to its last. */
	const bar = $derived({ top: top(0) + 7, bottom: bottomOf(last) - 7 });
	/** Ends of a message, stopping at the activation bar. */
	const ends = (from: number, to: number) => {
		const off = (lane: number, toward: number) =>
			lane === 1 ? x(lane) + Math.sign(x(toward) - x(lane)) * 5 : x(lane);
		return [off(from, to), off(to, from)];
	};
	/** A label's box: its arrow's span less 8 px a side, at least 200 px, inside the diagram. */
	const labelBox = (from: number, to: number) => {
		const lo = Math.min(x(from), x(to));
		const hi = Math.max(x(from), x(to));
		let w = hi - lo - 16;
		let left = lo + 8;
		if (w < 200) {
			w = Math.min(200, width - 8);
			left = (lo + hi) / 2 - w / 2;
		}
		return { left: Math.max(4, Math.min(left, width - 4 - w)), w };
	};
	/** An input message too long for its box names how many inputs; the pane lists them. */
	const labelText = (m: Sequence['messages'][number], w: number) => {
		const count = m.text.split(', ').length;
		return m.tone === 'input' && count > 1 && textWidth(m.text, 12) > 2 * w
			? `${count} inputs`
			: m.text;
	};
	const COLOR = {
		input: 'var(--sdv-model-text)',
		return: 'var(--sdv-text-muted)',
		call: 'var(--sdv-link-call)',
		read: 'var(--sdv-link-ref)',
		write: 'var(--sdv-link-write)',
		fail: 'var(--sdv-method-put)'
	};
</script>

<div class="seq" style:width="{width}px" style:height="{height}px">
	<svg {width} {height} aria-hidden="true">
		{#each seq.frags as f, i (i)}
			{@const ins = inset(f.depth)}
			<rect
				class="frag"
				x={ins}
				y={top(f.top) + 2}
				width={width - 2 * ins}
				height={bottomOf(f.bottom) - top(f.top) - 4}
			/>
			{#each f.dividers as d (d.row)}
				<path class="divider" d="M{ins} {top(d.row) + 4} H{width - ins}" />
			{/each}
		{/each}
		{#each seq.lifelines as l, i (l.key)}
			<path class="lifeline" d="M{x(i)} {headTop + (headHs[i] || headH)} V{bottom}" />
		{/each}
		<rect class="bar" x={x(1) - 5} y={bar.top} width="10" height={bar.bottom - bar.top} />
		{#each seq.messages as m (m.row)}
			{@const [x1, x2] = ends(m.from, m.to)}
			{@const dir = Math.sign(x2 - x1)}
			{@const yy = arrowY(m.row)}
			<g class:dim={m.dim}>
				<path
					d="M{x1} {yy} H{x2 - dir * (m.dashed || m.async ? 1 : 9)}"
					stroke={COLOR[m.tone]}
					stroke-dasharray={m.dashed ? '4 3' : undefined}
					class="msg"
				/>
				<!-- A return, or a message sent without waiting: an open arrowhead. -->
				{#if m.dashed || m.async}
					<path
						d="M{x2 - dir * 8} {yy - 4} L{x2} {yy} L{x2 - dir * 8} {yy + 4}"
						stroke={COLOR[m.tone]}
						class="msg"
					/>
				{:else}
					<path
						d="M{x2} {yy} L{x2 - dir * 9} {yy - 4.5} L{x2 - dir * 9} {yy + 4.5} Z"
						fill={COLOR[m.tone]}
					/>
				{/if}
			</g>
		{/each}
	</svg>
	<!-- On top while the pane scrolls, so each lane stays named. -->
	<div class="heads" style:height="{headTop + headH + 8}px">
		{#each seq.lifelines as l, i (l.key)}
			{@const h = headOf(l)}
			<div
				class="head"
				class:self={l.kind === 'self'}
				class:model={l.kind === 'model'}
				style:left="{x(i) - headW / 2}px"
				style:top="{headTop}px"
				style:width="{headW}px"
				bind:clientHeight={headHs[i]}
			>
				<button class="name" disabled={!h.target} onclick={() => h.target && onpick(h.target)}>
					{#if GLYPH[l.kind]}<EntityGlyph kind={GLYPH[l.kind]!} />{/if}<Ident text={h.name} />
				</button>
				{#each h.subs as s, si (si)}
					<button
						class="sub"
						disabled={!('target' in s) || !s.target}
						onclick={() => 'target' in s && s.target && onpick(s.target)}
						>{#if 'method' in s && s.method}<b style:color={methodColor(s.method)}>{s.method}</b
							><Ident
								text={s.text.slice(s.method.length + 1)}
							/>{:else if 'trigger' in s && s.trigger}<EntityGlyph
								kind={(s.glyph ?? 'trigger') as GlyphKind}
							/><Ident text={s.text} />{:else}<Ident text={s.text} />{/if}</button
					>
				{/each}
			</div>
		{/each}
	</div>
	{#each seq.frags as f, i (i)}
		{@const ins = inset(f.depth)}
		<div class="tag" style:left="{ins}px" style:top="{top(f.top) + 2}px">{f.label}</div>
		<div
			class="guard"
			class:dim={f.dim}
			style:left="{ins + 46}px"
			style:top="{top(f.top) + 4}px"
			style:max-width="{width - 2 * ins - 54}px"
			bind:clientHeight={fit[f.top]}
		>
			{f.guard}
		</div>
		{#each f.dividers as d (d.row)}
			<div
				class="guard"
				class:dim={d.dim}
				style:left="{ins + 8}px"
				style:top="{top(d.row) + 7}px"
				style:max-width="{width - 2 * ins - 16}px"
				bind:clientHeight={fit[d.row]}
			>
				{d.guard}
			</div>
		{/each}
	{/each}
	{#each seq.messages as m (m.row)}
		{@const box = labelBox(m.from, m.to)}
		{@const text = labelText(m, box.w)}
		<button
			class="label {m.tone}"
			class:dim={m.dim}
			disabled={!m.target}
			title={text === m.text ? undefined : m.text}
			style:left="{box.left}px"
			style:width="{box.w}px"
			style:top="{arrowY(m.row) - 2 - (fit[m.row] || 14)}px"
			bind:clientHeight={fit[m.row]}
			onclick={() => m.target && onpick(m.target)}
			>{#if m.method}<b style:color={methodColor(m.method)}>{m.method}</b><Ident
					text={text.slice(m.method.length + 1)}
				/>{:else}<Ident {text} />{/if}</button
		>
	{/each}
	{#each seq.notes as n (n.row)}
		<div
			class="note"
			class:dim={n.dim}
			style:left="{x(1) + 12}px"
			style:max-width="{width - x(1) - 26}px"
			style:top="{top(n.row) + (heights[n.row] - (fit[n.row] || 16)) / 2}px"
			bind:clientHeight={fit[n.row]}
		>
			<Ident text={n.text} />
		</div>
	{/each}
</div>

<style>
	/* A flag branch the shown state doesn't take: still code, not running. */
	.dim {
		opacity: 0.35;
	}
	.seq {
		position: relative;
		font-size: 12px;
		margin: 0 0 8px;
	}
	svg {
		position: absolute;
		left: 0;
		top: 0;
		overflow: visible;
	}
	.lifeline {
		stroke: var(--sdv-boundary-stroke);
		stroke-dasharray: 3 3;
		fill: none;
	}
	.bar {
		fill: var(--sdv-kind-logic-soft);
		stroke: var(--sdv-kind-logic);
	}
	.msg {
		fill: none;
		stroke-width: 1.5;
	}
	.frag {
		fill: none;
		stroke: var(--sdv-api-stroke);
	}
	.divider {
		stroke: var(--sdv-api-stroke);
		stroke-dasharray: 5 4;
		fill: none;
	}
	.heads {
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--sdv-model-fill);
	}
	.head {
		position: absolute;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 3px 6px;
		border: 1px solid var(--sdv-model-stroke);
		border-radius: 6px;
		background: var(--sdv-model-fill);
		line-height: 1.3;
		text-align: center;
	}
	/* Participants wear their card's line: logic amber, models sky. */
	.head.self {
		border-color: var(--sdv-kind-logic);
	}
	.head.model {
		border-color: var(--sdv-kind-class);
	}
	button {
		border: none;
		background: none;
		padding: 0;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	button:disabled {
		cursor: default;
	}
	/* The method before a route, spaced like a word. */
	b {
		margin-right: 0.3em;
	}
	.head .name {
		font-weight: 600;
		max-width: 100%;
	}
	.head .name :global(svg) {
		margin-right: 0.35em;
		vertical-align: -0.1em;
	}
	.head .sub {
		display: block;
		max-width: 100%;
		font-size: 11px;
		color: var(--sdv-text-muted);
	}
	.head button:hover:not(:disabled) {
		text-decoration: underline;
	}
	.label {
		position: absolute;
		line-height: 1.2;
		text-align: center;
		color: var(--sdv-model-text);
	}
	.label:hover:not(:disabled) {
		text-decoration: underline;
	}
	.label.call {
		color: var(--sdv-link-call);
	}
	.label.read {
		color: var(--sdv-link-ref);
	}
	.label.write {
		color: var(--sdv-link-write);
	}
	.label.return {
		color: var(--sdv-text-muted);
	}
	.label.fail {
		color: var(--sdv-method-put);
	}
	.tag {
		position: absolute;
		padding: 1px 8px;
		font-size: 11px;
		font-weight: 700;
		background: var(--sdv-model-header);
		border: 1px solid var(--sdv-api-stroke);
		margin: -1px 0 0 -1px;
	}
	.guard {
		position: absolute;
		font-size: 11px;
		line-height: 14px;
		color: var(--sdv-text-muted);
	}
	/* Work the unit does itself: a tinted card, so the lifelines do not run through it. */
	.note {
		position: absolute;
		box-sizing: border-box;
		padding: 1px 7px;
		font-style: italic;
		line-height: 16px;
		color: var(--sdv-text-muted);
		background: var(--sdv-model-header);
		border: 1px solid var(--sdv-model-stroke);
	}
</style>

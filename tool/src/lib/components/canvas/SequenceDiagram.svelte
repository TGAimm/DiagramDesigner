<script lang="ts">
	import EntityGlyph, { type GlyphKind } from './EntityGlyph.svelte';
	import { SEQ, sequenceWidth, type Sequence } from '#lib/landscape/sequence.ts';

	// A logic unit's steps as a sequence diagram: a lifeline per participant, a row per
	// message, alt and loop boxes round branches. Clicking a name or message goes to it.
	let { seq, onpick }: { seq: Sequence; onpick: (id: string) => void } = $props();

	const GLYPH: Record<string, GlyphKind | undefined> = {
		self: 'logic',
		unit: 'module',
		owner: 'module',
		model: 'class'
	};
	const width = $derived(sequenceWidth(seq));
	const subs = $derived(Math.max(1, ...seq.lifelines.map((l) => l.subs.length)));
	const headH = $derived(24 + subs * SEQ.sub);
	const headTop = 4;
	const x = (lane: number) => SEQ.edge + lane * SEQ.col;
	const y = (row: number) => headTop + headH + 30 + row * SEQ.row;
	const bottom = $derived(y(seq.rows - 1) + SEQ.row / 2 + 6);
	const height = $derived(bottom + 4);
	/** The unit's activation bar: from its first message to its last. */
	const bar = $derived({ top: y(0) - 8, bottom: y(seq.rows - 1) + 8 });
	/** Ends of a message, stopping at the activation bar. */
	const ends = (from: number, to: number) => {
		const off = (lane: number, toward: number) =>
			lane === 1 ? x(lane) + Math.sign(x(toward) - x(lane)) * 5 : x(lane);
		return [off(from, to), off(to, from)];
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
			{@const inset = 14 + f.depth * 8}
			<rect
				class="frag"
				x={inset}
				y={y(f.top) - SEQ.row / 2 + 2}
				width={width - 2 * inset}
				height={y(f.bottom) - y(f.top) + SEQ.row - 4}
			/>
			{#each f.dividers as d (d.row)}
				<path class="divider" d="M{inset} {y(d.row) - SEQ.row / 2 + 4} H{width - inset}" />
			{/each}
		{/each}
		{#each seq.lifelines as l, i (l.key)}
			<path class="lifeline" d="M{x(i)} {headTop + headH} V{bottom}" />
		{/each}
		<rect class="bar" x={x(1) - 5} y={bar.top} width="10" height={bar.bottom - bar.top} />
		{#each seq.messages as m (m.row)}
			{@const [x1, x2] = ends(m.from, m.to)}
			{@const dir = Math.sign(x2 - x1)}
			{@const yy = y(m.row)}
			<g class:dim={m.dim}>
				<path
					d="M{x1} {yy} H{x2 - dir * (m.dashed ? 1 : 9)}"
					stroke={COLOR[m.tone]}
					stroke-dasharray={m.dashed ? '4 3' : undefined}
					class="msg"
				/>
				{#if m.dashed}
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
	{#each seq.lifelines as l, i (l.key)}
		<div
			class="head"
			class:self={l.kind === 'self'}
			class:model={l.kind === 'model'}
			style:left="{x(i) - SEQ.headW / 2}px"
			style:top="{headTop}px"
			style:width="{SEQ.headW}px"
			style:height="{headH}px"
		>
			<button class="name" disabled={!l.target} onclick={() => l.target && onpick(l.target)}>
				{#if GLYPH[l.kind]}<EntityGlyph kind={GLYPH[l.kind]!} />{/if}{l.name}
			</button>
			{#each l.subs as s, si (si)}
				<button
					class="sub"
					disabled={!s.target}
					title={s.text}
					onclick={() => s.target && onpick(s.target)}
					>{#if s.method}<b style:color="var(--sdv-method-{s.method.toLowerCase()})">{s.method}</b
						>{s.text.slice(s.method.length + 1)}{:else}{s.text}{/if}</button
				>
			{/each}
		</div>
	{/each}
	{#each seq.frags as f, i (i)}
		{@const inset = 14 + f.depth * 8}
		{@const top = y(f.top) - SEQ.row / 2 + 2}
		<div class="tag" style:left="{inset}px" style:top="{top}px">{f.label}</div>
		<div class="guard" class:dim={f.dim} style:left="{inset + 40}px" style:top="{top + 2}px">
			{f.guard}
		</div>
		{#each f.dividers as d (d.row)}
			<div
				class="guard"
				class:dim={d.dim}
				style:left="{inset + 8}px"
				style:top="{y(d.row) - SEQ.row / 2 + 6}px"
			>
				{d.guard}
			</div>
		{/each}
	{/each}
	{#each seq.messages as m (m.row)}
		<button
			class="label {m.tone}"
			class:dim={m.dim}
			disabled={!m.target}
			style:left="{(x(m.from) + x(m.to)) / 2}px"
			style:top="{y(m.row) - 17}px"
			onclick={() => m.target && onpick(m.target)}
			>{#if m.method}<b style:color="var(--sdv-method-{m.method.toLowerCase()})">{m.method}</b
				>{m.text.slice(m.method.length + 1)}{:else}{m.text}{/if}</button
		>
	{/each}
	{#each seq.notes as n (n.row)}
		<div class="note" class:dim={n.dim} style:left="{x(1) + 12}px" style:top="{y(n.row) - 8}px">
			{n.text}
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
		fill: var(--sdv-logic-head);
		stroke: var(--sdv-link-call);
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
	.head {
		position: absolute;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 3px 6px;
		border: 1px solid var(--sdv-model-stroke);
		background: var(--sdv-model-header);
		line-height: 1.3;
	}
	.head.self {
		background: var(--sdv-logic-head);
		border-color: var(--sdv-link-call);
	}
	.head.model {
		background: var(--sdv-model-class-head);
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
		display: flex;
		align-items: center;
		gap: 0.35em;
		font-weight: 600;
		max-width: 100%;
		white-space: nowrap;
		overflow: hidden;
	}
	.head .sub {
		display: block;
		max-width: 100%;
		font-size: 11px;
		color: var(--sdv-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		height: 15px;
	}
	.head button:hover:not(:disabled) {
		text-decoration: underline;
	}
	.label {
		position: absolute;
		transform: translateX(-50%);
		white-space: nowrap;
		line-height: 1.2;
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
	.guard,
	.note {
		position: absolute;
		font-size: 11px;
		color: var(--sdv-text-muted);
		white-space: nowrap;
	}
	.note {
		font-style: italic;
		font-size: 12px;
	}
</style>

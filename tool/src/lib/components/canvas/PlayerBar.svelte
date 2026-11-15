<script lang="ts">
	import { ChevronLeft, ChevronRight, CornerDownRight, CornerLeftUp, X } from '@lucide/svelte';
	import type { Run } from '#lib/landscape/play.ts';

	// The controls for playing a unit, docked under the canvas. It holds no facts about a
	// step: those are drawn on the board. The track has a mark per step on the chosen path.
	let {
		run,
		at,
		names,
		onjump,
		onpick,
		onforward,
		oninto,
		onout,
		onstop
	}: {
		run: Run;
		at: number;
		/** A unit's name, by id, for the breadcrumb and the track's brackets. */
		names: (id: string) => string;
		onjump: (i: number) => void;
		onpick: (option: number) => void;
		onforward: () => void;
		oninto: () => void;
		onout: () => void;
		onstop: () => void;
	} = $props();

	const W = 380;
	const BASE = 30;
	const step = $derived(run.steps[at]);
	const last = $derived(run.steps.length - 1);
	// Marks close up to fit the track, keeping room for the dashed tail past a pending choice.
	const gap = $derived(Math.min(36, (W - 40) / Math.max(1, last + (run.pending ? 1 : 0))));
	const x = (i: number) => 10 + i * gap;
	/** Runs of steps inside a unit stepped into, a bracket each, deeper ones higher. */
	const brackets = $derived.by(() => {
		const out: { from: number; to: number; depth: number; id: string }[] = [];
		run.steps.forEach((s, i) => {
			for (let d = 2; d <= s.frame.length; d++) {
				const b = out.findLast((o) => o.depth === d);
				if (b && b.to === i - 1 && b.id === s.frame[d - 1]) b.to = i;
				else out.push({ from: i, to: i, depth: d, id: s.frame[d - 1] });
			}
		});
		return out;
	});
	const COLOR: Record<string, string> = {
		input: 'var(--sdv-model-text)',
		call: 'var(--sdv-link-call)',
		read: 'var(--sdv-link-ref)',
		write: 'var(--sdv-link-write)',
		note: 'var(--sdv-text-muted)'
	};

	let hover = $state<number | null>(null);
	let dragging = false;
	const nearest = (e: PointerEvent) => {
		const box = (e.currentTarget as SVGElement).getBoundingClientRect();
		return Math.min(last, Math.max(0, Math.round((e.clientX - box.left - 10) / gap)));
	};
</script>

<div class="player" data-testid="player">
	<div class="head">
		<span class="crumb"
			><i class="fn">ƒ</i>
			{#each step.frame as id, i (i)}{#if i}<span class="sep">›</span>{/if}<b
					class:on={i === step.frame.length - 1}>{names(id)}</b
				>{/each}</span
		>
		<span class="count">· step {at + 1}</span>
		<span class="fill"></span>
		<button class="x" onclick={onstop} aria-label="Stop playing" title="Stop (Esc)"
			><X size={16} /></button
		>
	</div>
	<div class="body">
		<button
			class="tb"
			disabled={at === 0}
			onclick={() => onjump(at - 1)}
			aria-label="Step back"
			title="Step back (←)"><ChevronLeft size={16} /></button
		>
		{#if step.choice}
			{#each step.choice.options as o, i (i)}
				<button
					class="chip"
					class:picked={step.choice.picked === i}
					title={o.label}
					onclick={() => onpick(i)}><span>{o.label}</span><kbd>{i + 1}</kbd></button
				>
			{/each}
		{:else}
			<button
				class="tb main"
				disabled={at === last}
				onclick={onforward}
				aria-label="Step forward"
				title="Step forward (→)"><ChevronRight size={16} /></button
			>
		{/if}
		<span class="tsep"></span>
		<button
			class="tb"
			disabled={!step.into}
			onclick={oninto}
			aria-label="Step into"
			title="Step into (I)"><CornerDownRight size={16} /></button
		>
		<button
			class="tb"
			disabled={step.frame.length < 2}
			onclick={onout}
			aria-label="Step out"
			title="Step out (O)"><CornerLeftUp size={16} /></button
		>
		<div class="track">
			<svg
				width={W}
				height="52"
				role="slider"
				tabindex="-1"
				aria-label="Steps"
				aria-valuemin={1}
				aria-valuemax={last + 1}
				aria-valuenow={at + 1}
				onpointerdown={(e) => {
					dragging = true;
					(e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
					onjump(nearest(e));
				}}
				onpointermove={(e) => {
					hover = nearest(e);
					if (dragging && hover !== at) onjump(hover);
				}}
				onpointerup={() => (dragging = false)}
				onpointerleave={() => (hover = null)}
			>
				{#each brackets as b, i (i)}
					{@const y = BASE - 12 - (b.depth - 2) * 7}
					<path class="bracket" d="M{x(b.from)} {y + 5} V{y} H{x(b.to)} V{y + 5}" />
					{#if b.depth === 2}<text class="bname" x={(x(b.from) + x(b.to)) / 2} y={y - 3}
							>{names(b.id)}</text
						>{/if}
				{/each}
				<path class="done" d="M{x(0)} {BASE} H{x(at)}" />
				<path class="todo" d="M{x(at)} {BASE} H{x(last)}" />
				{#if run.pending}<path class="tail" d="M{x(last) + 12} {BASE} H{W - 6}" />{/if}
				{#each run.steps as s, i (s.key)}
					{@const cx = x(i)}
					<g class:future={i > at}>
						{#if s.choice}
							<path
								class="diamond"
								class:open={s.choice.picked === undefined}
								d="M{cx} {BASE - 6} L{cx + 6} {BASE} L{cx} {BASE + 6} L{cx - 6} {BASE} Z"
							/>
							{#if s.choice.picked !== undefined}
								<text class="short" x={cx} y={BASE + 18}
									>{s.choice.options[s.choice.picked].short}</text
								>
							{/if}
						{:else if (s.kind === 'return' || s.kind === 'fail') && s.frame.length === 1}
							{#if s.kind === 'return'}
								<rect
									x={cx - 4.5}
									y={BASE - 4.5}
									width="9"
									height="9"
									fill="var(--sdv-model-text)"
								/>
							{:else}
								<path
									class="cross"
									d="M{cx - 4} {BASE - 4} L{cx + 4} {BASE + 4} M{cx + 4} {BASE - 4} L{cx -
										4} {BASE + 4}"
								/>
							{/if}
						{:else if s.kind === 'gets' || s.kind === 'return' || s.kind === 'fail'}
							<circle
								class="hollow"
								{cx}
								cy={BASE}
								r="3.5"
								stroke={s.kind === 'fail' ? 'var(--sdv-method-put)' : 'var(--sdv-text-muted)'}
							/>
						{:else}
							<circle {cx} cy={BASE} r={s.kind === 'note' ? 2.5 : 4} fill={COLOR[s.kind]} />
						{/if}
					</g>
				{/each}
				<circle class="ring" cx={x(at)} cy={BASE} r="10" />
			</svg>
			{#if hover !== null}
				<div class="tip" style:left="{x(hover)}px">
					step {hover + 1} · {run.steps[hover].text}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.player {
		position: absolute;
		/* Anchored by its left edge, so branch buttons widen it to the right without moving it. */
		left: max(60px, calc(50% - 290px));
		bottom: 16px;
		z-index: 11;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
		color: var(--ui-text);
		font-size: 13px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 6px 4px 12px;
		border-bottom: 1px solid var(--ui-border);
	}
	.crumb {
		display: flex;
		align-items: center;
		gap: 0.35em;
		color: var(--ui-muted);
	}
	.crumb b {
		font-weight: 500;
	}
	.crumb b.on {
		color: var(--ui-text);
		font-weight: 600;
	}
	.fn {
		font-family: Georgia, serif;
		color: var(--sdv-link-call);
	}
	.count {
		font-size: 12px;
		color: var(--ui-muted);
		font-variant-numeric: tabular-nums;
	}
	.fill {
		flex: 1;
	}
	button {
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	.x {
		border: none;
		background: none;
		color: var(--ui-muted);
		display: flex;
		padding: 4px;
	}
	.body {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 12px;
	}
	.tb {
		width: 32px;
		height: 32px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 1px solid var(--ui-border);
		background: var(--ui-panel);
	}
	.tb.main {
		background: var(--sdv-selection);
		border-color: var(--sdv-selection);
		color: #fff;
	}
	.tb:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		max-width: 200px;
		padding: 0 12px;
		border: 1px solid var(--sdv-selection);
		background: var(--ui-panel);
		color: var(--sdv-selection);
		font-weight: 600;
	}
	.chip span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip.picked {
		background: var(--ui-accent-bg);
	}
	.chip kbd {
		font: inherit;
		font-size: 11px;
		font-weight: 400;
		opacity: 0.7;
	}
	.tsep {
		width: 1px;
		height: 20px;
		margin: 0 4px;
		background: var(--ui-border);
	}
	.track {
		position: relative;
		margin-left: 8px;
	}
	svg {
		display: block;
		cursor: pointer;
		touch-action: none;
	}
	.done {
		stroke: var(--sdv-selection);
		stroke-width: 3;
	}
	.todo {
		stroke: var(--sdv-boundary-stroke);
		stroke-width: 2;
	}
	.tail {
		stroke: var(--sdv-text-muted);
		stroke-width: 1.5;
		stroke-dasharray: 3 4;
	}
	.future {
		opacity: 0.45;
	}
	.diamond {
		fill: var(--ui-panel);
		stroke: var(--sdv-api-stroke);
		stroke-width: 1.5;
	}
	.diamond.open {
		stroke-dasharray: 3 2;
	}
	.hollow {
		fill: var(--ui-panel);
		stroke-width: 1.5;
	}
	.cross {
		stroke: var(--sdv-method-put);
		stroke-width: 2;
	}
	.ring {
		fill: none;
		stroke: var(--sdv-selection);
		stroke-width: 2;
	}
	.bracket {
		fill: none;
		stroke: var(--sdv-link-call);
		stroke-width: 1.2;
	}
	text {
		font-size: 10px;
		text-anchor: middle;
		fill: var(--sdv-text-muted);
	}
	.bname {
		fill: var(--sdv-link-call);
	}
	.tip {
		position: absolute;
		bottom: calc(100% + 2px);
		transform: translateX(-50%);
		white-space: nowrap;
		padding: 3px 8px;
		font-size: 12px;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
		color: var(--ui-muted);
		pointer-events: none;
	}
</style>

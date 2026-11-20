<script lang="ts">
	/**
	 * Shown while the lines at rest are routed, which on a large landscape takes seconds: how
	 * many, and how long is left, judged by how long they took last time. Routing is one call
	 * into libavoid that cannot tell how far it has got, so the bar runs on time. The first
	 * time there is nothing to judge by, and it only says how long it has taken so far. It ticks
	 * on its own clock, from when routing started, and shows only once routing has taken a
	 * moment, so routing that ends at once shows nothing.
	 */
	let {
		count,
		since,
		expected
	}: {
		/** Lines still being routed. */
		count: number;
		/** `performance.now()` when routing started. */
		since: number;
		/** Ms they took last time, if known. */
		expected?: number;
	} = $props();

	/** Shown once routing has taken this long. */
	const AFTER = 400;
	let now = $state(performance.now());
	$effect(() => {
		const tick = setInterval(() => (now = performance.now()), 250);
		return () => clearInterval(tick);
	});
	const elapsed = $derived(Math.max(0, now - since));

	const share = $derived(expected ? Math.min(0.97, elapsed / expected) : undefined);
	const secs = (ms: number) => Math.max(1, Math.round(ms / 1000));
	const left = $derived(
		!expected
			? `${secs(elapsed)} s so far`
			: elapsed < expected
				? `about ${secs(expected - elapsed)} s left`
				: 'almost done'
	);
</script>

{#if elapsed > AFTER}
	<div class="routing" role="status" aria-live="polite">
		<div class="text">
			<span>Routing {count} connection{count === 1 ? '' : 's'}</span>
			<span class="left">{left}</span>
		</div>
		<div
			class="track"
			role="progressbar"
			aria-label="Routing connections"
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={share === undefined ? undefined : Math.round(share * 100)}
		>
			<div
				class="bar"
				class:unknown={share === undefined}
				style:width={share === undefined ? undefined : `${share * 100}%`}
			></div>
		</div>
	</div>
{/if}

<style>
	.routing {
		position: absolute;
		left: 50%;
		top: 12px;
		transform: translateX(-50%);
		z-index: 12;
		width: 280px;
		max-width: calc(100% - 32px);
		box-sizing: border-box;
		padding: 8px 12px 10px;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		border-radius: 8px;
		box-shadow: var(--ui-shadow);
		color: var(--ui-text);
		font-size: 12px;
		pointer-events: none;
	}
	.text {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 6px;
	}
	.left {
		color: var(--ui-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.track {
		position: relative;
		height: 4px;
		overflow: hidden;
		border-radius: 2px;
		background: var(--ui-accent-bg);
	}
	.bar {
		height: 100%;
		border-radius: 2px;
		background: var(--ui-accent);
		transition: width 0.25s linear;
	}
	/* Nothing to judge by: a stretch sweeping across, not a share. */
	.bar.unknown {
		position: absolute;
		width: 30%;
		animation: sweep 1.4s ease-in-out infinite;
	}
	@keyframes sweep {
		from {
			left: -30%;
		}
		to {
			left: 100%;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bar {
			transition: none;
		}
		.bar.unknown {
			left: 0;
			width: 100%;
			opacity: 0.4;
			animation: none;
		}
	}
</style>

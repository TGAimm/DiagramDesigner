<script lang="ts">
	import { ChevronDown, ChevronRight, Crosshair, Flag } from '@lucide/svelte';
	import { flagAsk } from '#lib/client/search.svelte.ts';
	import { changes } from '#lib/client/changes.svelte.ts';
	import { design } from '#lib/client/store.svelte.ts';
	import { flagHome, flagKeys } from '#lib/model/flags.ts';

	/**
	 * Topbar: the design's feature flags, one row per key. A key's switch sets every
	 * definition; opened, each definition (one per system or module checking it) is set
	 * alone, which is how a split is made. A key's crosshair focuses the canvas on what it reaches. What the state breaks is listed at the bottom.
	 */
	const keys = $derived(
		[...flagKeys(design.model)]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, defs]) => ({
				key,
				defs,
				name: design.model.elements.get(defs[0])!.name,
				on: defs.filter((d) => changes.flagState.get(d)).length
			}))
	);
	const moved = $derived(
		[...changes.flagState].filter(([id, on]) => on !== changes.flagDefaults.get(id)).length
	);
	const breaking = $derived(changes.findings.some((f) => f.level === 'breaking'));
	let shown = $state<Record<string, boolean>>({});
	const isOpen = (k: { key: string; defs: string[]; on: number }) =>
		shown[k.key] ?? (k.on > 0 && k.on < k.defs.length);
</script>

{#if keys.length}
	<div class="wrap">
		<button
			class="pick"
			class:on={changes.flagged}
			aria-haspopup="menu"
			aria-expanded={changes.flagsOpen}
			onclick={() => (changes.flagsOpen = !changes.flagsOpen)}
			title="Feature flags"
			data-testid="flags-menu"
		>
			<Flag size={14} />Flags{#if moved}<span> · {moved}</span>{/if}{#if breaking}<span
					class="dot"
					aria-label="breaks something"
				></span>{/if}<ChevronDown size={12} />
		</button>
		{#if changes.flagsOpen}
			<div class="menu" role="menu" aria-label="Flags">
				<div class="head">
					<span class="title">Flags</span>
					<button disabled={!changes.flagged} onclick={() => changes.resetFlags()}
						>Reset to production</button
					>
				</div>
				{#each keys as k (k.key)}
					{@const open = isOpen(k)}
					{@const mixed = k.on > 0 && k.on < k.defs.length}
					<div class="key">
						<div class="krow">
							<button
								class="chev"
								aria-label={open ? 'Hide definitions' : 'Show definitions'}
								aria-expanded={open}
								onclick={() => (shown = { ...shown, [k.key]: !open })}
							>
								{#if open}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
							</button>
							<span class="kname">{k.name}</span><code>{k.key}</code>
							<span class="spacer"></span>
							{#if mixed}<span class="split">split</span>{/if}
							<button
								class="focus"
								aria-label="Focus on {k.name}"
								title="Focus on this flag: only what it reaches"
								onclick={() => {
									changes.flagsOpen = false;
									flagAsk.key = k.key;
								}}><Crosshair size={14} /></button
							>
							<button
								class="sw"
								class:is-on={k.on === k.defs.length}
								class:mixed
								role="switch"
								aria-checked={mixed ? 'mixed' : k.on === k.defs.length}
								aria-label="{k.name} everywhere"
								onclick={() => changes.setFlags(k.defs, k.on < k.defs.length)}
							></button>
						</div>
						{#if open}
							{#each k.defs as id (id)}
								{@const on = !!changes.flagState.get(id)}
								<div class="def">
									<span class="home">{flagHome(design.model, id)}</span>
									<span class="dflt">default {changes.flagDefaults.get(id) ? 'on' : 'off'}</span>
									<div
										class="seg"
										role="group"
										aria-label="{k.name} in {flagHome(design.model, id)}"
									>
										<button aria-pressed={!on} onclick={() => changes.setFlags([id], false)}
											>Off</button
										><button aria-pressed={on} onclick={() => changes.setFlags([id], true)}
											>On</button
										>
									</div>
								</div>
							{/each}
						{/if}
					</div>
				{/each}
				{#if changes.findings.length}
					<div class="finds">
						{#each changes.findings as f, i (i)}
							<p class:k={f.level === 'breaking'} class:w={f.level === 'check'}>
								<b>{f.level}</b>
								{f.message}
							</p>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.wrap {
		position: relative;
		margin-left: 6px;
	}
	.pick {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 30px;
	}
	.pick.on {
		background: var(--ui-accent-bg);
		border-color: var(--ui-accent);
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--sdv-sev-break);
	}
	.menu {
		position: absolute;
		left: 0;
		top: calc(100% + 4px);
		width: 420px;
		z-index: 30;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		box-shadow: var(--ui-shadow);
		font-size: 13px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--ui-border);
	}
	.head button {
		font-size: 12px;
	}
	.title {
		flex: 1;
		font-weight: 600;
	}
	.key {
		padding: 8px 12px;
		border-bottom: 1px solid var(--ui-border);
	}
	.krow {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.kname {
		font-weight: 600;
	}
	code {
		font-size: 11.5px;
		color: var(--ui-muted);
	}
	.spacer {
		flex: 1;
	}
	.chev {
		border: none;
		background: none;
		padding: 0;
		display: flex;
		color: var(--ui-muted);
	}
	.focus {
		border: none;
		background: none;
		padding: 2px;
		display: flex;
		color: var(--ui-muted);
	}
	.focus:hover {
		color: var(--sdv-selection);
	}
	.split {
		font-size: 11px;
		font-weight: 600;
		padding: 0 6px;
		line-height: 18px;
		color: var(--sdv-sev-check);
		background: color-mix(in srgb, var(--sdv-sev-check) 16%, transparent);
	}
	.sw {
		position: relative;
		width: 30px;
		height: 18px;
		padding: 0;
		border-radius: 9px;
		flex: none;
	}
	.sw::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--ui-muted);
	}
	.sw.is-on {
		background: var(--ui-accent-bg);
		border-color: var(--ui-accent);
	}
	.sw.is-on::after {
		left: 14px;
		background: var(--ui-accent);
	}
	.sw.mixed::after {
		left: 8px;
		background: var(--sdv-sev-check);
	}
	.def {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 0 0 22px;
	}
	.home {
		flex: 1;
		font-size: 12px;
		color: var(--ui-muted);
	}
	.dflt {
		font-size: 11px;
		color: var(--ui-muted);
	}
	.seg {
		display: inline-flex;
	}
	.seg button {
		font-size: 12px;
		padding: 1px 9px;
		color: var(--ui-muted);
		margin-left: -1px;
	}
	.seg button[aria-pressed='true'] {
		color: var(--ui-text);
		font-weight: 600;
		background: var(--ui-accent-bg);
	}
	.finds {
		padding: 8px 12px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.finds p {
		margin: 0;
		font-size: 12px;
	}
	.finds .k b {
		color: var(--sdv-sev-break);
	}
	.finds .w b {
		color: var(--sdv-sev-check);
	}
</style>

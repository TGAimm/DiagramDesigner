<script lang="ts">
	import { X } from '@lucide/svelte';
	import { settings, type Detail } from '#lib/client/settings.svelte.ts';

	let { onclose }: { onclose: () => void } = $props();

	const options: { value: Detail; title: string; text: string }[] = [
		{
			value: 'adaptive',
			title: 'Adaptive',
			text: 'Boxes open as you zoom in and close when their contents get too small to read. Api rails list endpoints once readable. Cards over 20 fields fold.'
		},
		{
			value: 'all',
			title: 'Render everything',
			text: 'Every system, module, card, field and api rail is drawn at every zoom, open and unfolded. Large designs may pan and zoom slowly.'
		}
	];
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<section class="settings" aria-label="Settings" data-testid="settings-panel">
	<header>
		<strong>Settings</strong>
		<button class="close" onclick={onclose} aria-label="Close" title="Close (Esc)"
			><X size={16} /></button
		>
	</header>
	<fieldset>
		<legend>CANVAS DETAIL</legend>
		{#each options as o (o.value)}
			<label class:on={settings.detail === o.value}>
				<input
					type="radio"
					name="detail"
					value={o.value}
					checked={settings.detail === o.value}
					onchange={() => settings.setDetail(o.value)}
				/>
				<span><b>{o.title}</b><span class="text">{o.text}</span></span>
			</label>
		{/each}
	</fieldset>
	<footer>Saved in this browser.</footer>
</section>

<style>
	.settings {
		position: absolute;
		right: 12px;
		top: 51px;
		width: 340px;
		z-index: 20;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		border-bottom: 1px solid var(--ui-border);
	}
	.close {
		border: none;
		background: none;
		color: var(--ui-muted);
		display: flex;
		padding: 2px;
	}
	fieldset {
		margin: 0;
		border: none;
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	legend {
		float: left;
		padding: 0;
		margin-bottom: 8px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--ui-muted);
	}
	label {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 10px;
		border: 1px solid var(--ui-border);
		cursor: pointer;
	}
	label.on {
		background: var(--ui-accent-bg);
		border-color: var(--ui-accent);
	}
	input {
		margin: 2px 0 0;
		padding: 0;
		accent-color: var(--ui-accent);
	}
	b {
		display: block;
		font-weight: 600;
		font-size: 13px;
	}
	.text {
		display: block;
		font-size: 12px;
		color: var(--ui-muted);
		margin-top: 2px;
		line-height: 1.4;
	}
	footer {
		padding: 10px 14px;
		border-top: 1px solid var(--ui-border);
		font-size: 12px;
		color: var(--ui-muted);
	}
</style>

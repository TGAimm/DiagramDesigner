<script lang="ts">
	import { changes } from '#lib/client/changes.svelte.ts';

	/**
	 * A field's or model's menu while a scenario is shown: each action appends one change to
	 * the scenario file, guarded by the value it expects (`was`), read from the scenario's
	 * result so far.
	 */
	let { target, x, y, onclose }: { target: string; x: number; y: number; onclose: () => void } =
		$props();

	const after = $derived(changes.comparison?.after);
	const field = $derived(after?.fields.get(target));
	const model = $derived(after?.elements.get(target));
	const gone = $derived(changes.marks.dropped.has(target));
	let form = $state<'rename' | 'type' | 'add' | null>(null);
	let name = $state('');
	let type = $state('');

	function open(kind: 'rename' | 'type' | 'add') {
		form = kind;
		name = kind === 'rename' ? (field?.def.name ?? model?.def.name ?? model?.name ?? '') : '';
		type = kind === 'type' ? (field?.def.type ?? '') : 'string';
	}

	async function done(p: Promise<void>) {
		await p;
		onclose();
	}

	function toggle(key: 'required' | 'nullable') {
		const was = field?.def[key];
		void done(changes.append({ set: target, key, was, to: was ? undefined : true }));
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (form === 'rename' && name.trim()) {
			const was = field ? field.def.name : model?.def.name;
			void done(changes.append({ set: target, key: 'name', was, to: name.trim() }));
		} else if (form === 'type' && type.trim() && field) {
			void done(changes.append({ set: target, key: 'type', was: field.def.type, to: type.trim() }));
		} else if (form === 'add' && name.trim() && type.trim()) {
			const into = field ? field.modelId : target;
			void done(
				changes.append({
					add: changes.newId(),
					in: into,
					...(field ? { after: target } : {}),
					field: { name: name.trim(), type: type.trim() }
				})
			);
		}
	}

	const style = $derived(
		`left:${Math.min(x, (typeof window === 'undefined' ? 1e4 : window.innerWidth) - 270)}px;top:${y}px`
	);
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') onclose();
	}}
/>
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onclose} oncontextmenu={(e) => (e.preventDefault(), onclose())}></div>
<div class="menu" role="menu" {style}>
	<div class="mh">{field ? field.def.name : (model?.name ?? '')}</div>
	{#if gone}
		<p class="note">
			Dropped in this scenario. Remove that change in the Changes panel to keep it.
		</p>
	{:else if form}
		<form onsubmit={submit}>
			{#if form !== 'type'}
				<!-- svelte-ignore a11y_autofocus -->
				<input bind:value={name} placeholder="Name" aria-label="Name" autofocus />
			{/if}
			{#if form !== 'rename'}
				<!-- svelte-ignore a11y_autofocus -->
				<input bind:value={type} placeholder="Type" aria-label="Type" autofocus={form === 'type'} />
			{/if}
			<div class="row">
				<button type="submit" class="primary">{form === 'add' ? 'Add' : 'Change'}</button>
				<button type="button" onclick={() => (form = null)}>Back</button>
			</div>
		</form>
	{:else if field}
		<button class="mi" role="menuitem" onclick={() => open('rename')}>Rename…</button>
		{#if !field.def.model}
			<button class="mi" role="menuitem" onclick={() => open('type')}
				>Change type…<span class="r">{field.def.type}</span></button
			>
		{/if}
		<button
			class="mi"
			role="menuitemcheckbox"
			aria-checked={!!field.def.required}
			onclick={() => toggle('required')}
			>Required<span class="r">{field.def.required ? '✓' : ''}</span></button
		>
		<button
			class="mi"
			role="menuitemcheckbox"
			aria-checked={!!field.def.nullable}
			onclick={() => toggle('nullable')}
			>Nullable<span class="r">{field.def.nullable ? '✓' : ''}</span></button
		>
		<button class="mi" role="menuitem" onclick={() => open('add')}>Add field below…</button>
		<div class="sep"></div>
		<button class="mi danger" role="menuitem" onclick={() => done(changes.append({ drop: target }))}
			>Drop</button
		>
	{:else if model}
		<button class="mi" role="menuitem" onclick={() => open('rename')}>Rename model…</button>
		<button class="mi" role="menuitem" onclick={() => open('add')}>Add field…</button>
		<div class="sep"></div>
		<button class="mi danger" role="menuitem" onclick={() => done(changes.append({ drop: target }))}
			>Drop model</button
		>
	{/if}
	{#if changes.error}<p class="err">{changes.error}</p>{/if}
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 40;
	}
	.menu {
		position: fixed;
		z-index: 41;
		width: 250px;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		box-shadow: var(--ui-shadow);
		padding: 4px 0;
		font-size: 13px;
		color: var(--ui-text);
	}
	.mh {
		font-size: 11px;
		font-weight: 600;
		color: var(--ui-muted);
		padding: 6px 12px 4px;
	}
	.mi {
		display: flex;
		align-items: center;
		width: 100%;
		padding: 6px 12px;
		border: none;
		background: none;
		text-align: left;
	}
	.mi .r {
		margin-left: auto;
		font-size: 12px;
		color: var(--ui-muted);
	}
	.mi.danger {
		color: var(--ui-danger);
	}
	.sep {
		height: 1px;
		background: var(--ui-border);
		margin: 4px 0;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 4px 12px 8px;
	}
	.row {
		display: flex;
		gap: 8px;
	}
	.note,
	.err {
		margin: 4px 12px 8px;
		font-size: 12px;
		color: var(--ui-muted);
	}
	.err {
		color: var(--ui-danger);
	}
</style>

import type { Document } from 'yaml';
import { generateId } from '../model/ids';
import { loadDesign, type SourceFile } from '../model/loader';
import type { Model } from '../model/model';
import { fileKind, locate } from '../model/parse';
import { compare, evaluate, newErrors, type Comparison, type State } from '../scenario/evaluate';
import { EMPTY, marksOf, type Marks } from '../scenario/marks';
import { scenarioReport } from '../scenario/report';
import {
	appendChange,
	describeScenario,
	newScenarioText,
	readScenario,
	removeChange,
	type Change,
	type Scenario
} from '../scenario/scenario';
import type { HistoryEntry } from '../server/history';
import { design } from './store.svelte';

export type Mode = 'before' | 'diff' | 'after';

/** What is compared: a scenario over the design, or a commit with its parent. */
export type Source =
	{ kind: 'scenario'; path: string } | { kind: 'history'; rev: string; title: string };

const slug = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '') || 'scenario';

/**
 * Scenarios and history: which comparison is shown, how (before, diff or after), and the
 * scenario file edits made from the canvas. Files stay the truth: every edit is written to
 * the scenario file and comes back through the watcher.
 */
class Changes {
	source = $state.raw<Source | null>(null);
	mode = $state<Mode>('diff');
	/** The Changes panel (a scenario's change list) or History panel is shown. */
	panel = $state<'changes' | 'history' | null>(null);
	history = $state.raw<HistoryEntry[] | null>(null);
	historyError = $state<string | null>(null);
	/** The two states of the picked commit. */
	historyStates = $state.raw<{ rev: string; before: State; after: State } | null>(null);
	/** The last failed write, shown until the next one. */
	error = $state<string | null>(null);

	scenarios: Scenario[] = $derived(
		Object.entries(design.meta)
			.filter(([p]) => fileKind(p) === 'scenario')
			.map(([, m]) => readScenario(m.parsed))
			.sort((a, b) => a.name.localeCompare(b.name))
	);

	scenario: Scenario | undefined = $derived.by(() => {
		const s = this.source;
		return s?.kind === 'scenario' ? this.scenarios.find((x) => x.path === s.path) : undefined;
	});

	comparison: Comparison | undefined = $derived.by(() => {
		if (this.scenario) {
			const docs: Record<string, Document> = {};
			for (const [p, m] of Object.entries(design.meta))
				if (fileKind(p) === 'entity' && m.parsed.data !== undefined) docs[p] = m.parsed.doc;
			return evaluate(
				docs,
				{ model: design.model, data: design.data },
				this.scenario.changes,
				(file, path, key) => {
					const m = design.meta[file];
					return m ? locate(m.parsed.doc, m.parsed.lines, path, key) : undefined;
				}
			);
		}
		const h = this.historyStates;
		const s = this.source;
		if (h && s?.kind === 'history' && h.rev === s.rev) return compare(h.before, h.after);
		return undefined;
	});

	/** The model the canvas draws: the design, or one state of the comparison. */
	shown: Model = $derived.by(() => {
		const c = this.comparison;
		if (!c) return design.model;
		return this.mode === 'before' ? c.before : this.mode === 'after' ? c.after : c.union;
	});

	marks: Marks = $derived(this.comparison ? marksOf(this.comparison) : EMPTY);

	/** Results per change of the shown scenario: ok, stale, missing... */
	results = $derived(
		this.comparison && 'results' in this.comparison
			? (this.comparison.results as { status: string; message?: string }[])
			: []
	);

	/** Errors the shown scenario's result has that the design does not. */
	errors = $derived(
		this.comparison ? newErrors(this.comparison.before, this.comparison.after) : []
	);

	/** A scenario can be edited from the canvas: one is shown and the server takes writes. */
	editable = $derived(!!this.scenario);

	show(source: Source | null) {
		this.source = source;
		this.error = null;
		if (source?.kind === 'scenario') this.panel = 'changes';
		if (!source && this.panel === 'changes') this.panel = null;
	}

	// ------------------------------------------------------------------ scenario files
	async #write(path: string, text: string | null): Promise<boolean> {
		this.error = null;
		try {
			const res =
				text === null
					? await fetch(`/api/scenario?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
					: await fetch('/api/scenario', {
							method: 'PUT',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ path, text })
						});
			if (!res.ok) throw new Error(await failure(res));
		} catch (e) {
			this.error = (e as Error).message;
			return false;
		}
		// Shown at once; the watcher's event with the same text follows.
		await design.onExternalChange({
			path,
			text,
			hash: text === null ? null : `local:${Date.now()}`
		});
		return true;
	}

	async create(name: string, description?: string): Promise<void> {
		const taken = new Set(Object.keys(design.meta));
		let path = `scenarios/${slug(name)}.scenario.yaml`;
		for (let i = 2; taken.has(path); i++) path = `scenarios/${slug(name)}-${i}.scenario.yaml`;
		if (await this.#write(path, newScenarioText(name, description)))
			this.show({ kind: 'scenario', path });
	}

	async describe(name: string, description?: string): Promise<void> {
		const s = this.scenario;
		if (s) await this.#write(s.path, describeScenario(design.meta[s.path].text, name, description));
	}

	/** Appends a change to the shown scenario. */
	async append(...changes: Change[]): Promise<void> {
		const s = this.scenario;
		if (!s) return;
		let text = design.meta[s.path].text;
		for (const c of changes) text = appendChange(text, c);
		await this.#write(s.path, text);
	}

	/** Removes a change (default: the last one) from the shown scenario. */
	async remove(index?: number): Promise<void> {
		const s = this.scenario;
		if (s && s.changes.length)
			await this.#write(s.path, removeChange(design.meta[s.path].text, index));
	}

	async discard(): Promise<void> {
		const s = this.scenario;
		if (s && (await this.#write(s.path, null))) this.show(null);
	}

	/** Writes the shown scenario into the design and deletes its file. */
	async apply(): Promise<void> {
		const s = this.scenario;
		if (!s) return;
		this.error = null;
		try {
			const res = await fetch('/api/scenario/apply', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ path: s.path })
			});
			if (!res.ok) throw new Error(await failure(res));
			this.show(null);
		} catch (e) {
			this.error = (e as Error).message;
		}
	}

	/** The shown scenario as a markdown report for reviewers. */
	report(): string | undefined {
		const s = this.scenario;
		const c = this.comparison;
		if (!s || !c || !('results' in c)) return undefined;
		return scenarioReport(s, c as Parameters<typeof scenarioReport>[1], this.errors);
	}

	/** A fresh id, unused in the design and the shown state. */
	newId(): string {
		for (;;) {
			const id = generateId();
			if (!design.model.ids.has(id) && !this.shown.ids.has(id)) return id;
		}
	}

	// ------------------------------------------------------------------ history
	async loadHistory(): Promise<void> {
		this.historyError = null;
		try {
			const res = await fetch('/api/history');
			if (!res.ok) throw new Error(await failure(res));
			this.history = ((await res.json()) as { entries: HistoryEntry[] }).entries;
		} catch (e) {
			this.history = [];
			this.historyError = (e as Error).message;
		}
	}

	async showRev(entry: HistoryEntry): Promise<void> {
		this.show({ kind: 'history', rev: entry.rev, title: entry.scenario?.name ?? entry.subject });
		this.panel = 'history';
		try {
			const res = await fetch(`/api/history/${entry.rev}`);
			if (!res.ok) throw new Error(await failure(res));
			const body = (await res.json()) as { before: SourceFile[]; after: SourceFile[] };
			const state = (files: SourceFile[]): State => {
				const d = loadDesign(files);
				return { model: d.model, data: d.data };
			};
			this.historyStates = { rev: entry.rev, before: state(body.before), after: state(body.after) };
		} catch (e) {
			this.historyError = (e as Error).message;
		}
	}
}

async function failure(res: Response): Promise<string> {
	if (res.status === 404 || res.status === 405) return 'This build is read-only';
	try {
		return ((await res.json()) as { message?: string }).message ?? res.statusText;
	} catch {
		return res.statusText;
	}
}

export const changes = new Changes();

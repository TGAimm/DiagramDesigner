import type { ClientConfig } from '../config';
import type { Diagnostic } from '../model/diagnostics';
import { flagSplits } from '../model/flags';
import { placed, type SourceFile } from '../model/loader';
import { buildModel, type Locator, type Model } from '../model/model';
import { fileKind, locate, parseFile, type ParsedFile } from '../model/parse';
import type { ChangedEvent } from '../server/vite-plugin';

type DesignData = Record<string, unknown>;

export interface ModelResponse {
	files: SourceFile[];
	config: ClientConfig;
	/** The open landscape; null when none is. The static build gives its name only. */
	landscape: { name: string; path?: string } | null;
}

export interface FileMeta {
	text: string;
	hash: string;
	parsed: ParsedFile;
}

/** Client-side design state, loaded from the server and kept in sync with files on disk. */
export class DesignStore {
	data = $state.raw<DesignData>({});
	meta = $state.raw<Record<string, FileMeta>>({});
	config = $state.raw<ClientConfig>({ theme: 'light' });
	landscape = $state.raw<ModelResponse['landscape']>(null);
	loaded = $state(false);
	loadError = $state<string | null>(null);

	#locate: Locator = (file, path, key) => {
		const m = this.meta[file];
		return m ? locate(m.parsed.doc, m.parsed.lines, path, key) : undefined;
	};

	/** The whole design: every flag branch and gated item in. */
	model: Model = $derived.by(() => buildModel(this.data, this.#locate));

	diagnostics: Diagnostic[] = $derived([
		...Object.values(this.meta).flatMap((m) => m.parsed.diagnostics),
		...this.model.diagnostics,
		...placed(flagSplits(this.model, this.data), this.#locate)
	]);

	#chain: Promise<unknown> = Promise.resolve();

	/** Queued so change events arriving meanwhile apply afterwards. */
	load(): Promise<void> {
		return this.#serial(() => this.#load());
	}

	async #load(): Promise<void> {
		try {
			const res = await fetch('/api/model');
			if (!res.ok) throw new Error(`GET /api/model failed: ${res.status}`);
			const body: ModelResponse = await res.json();
			this.config = body.config;
			this.landscape = body.landscape ?? null;
			const meta: Record<string, FileMeta> = {};
			const data: DesignData = {};
			for (const f of body.files) {
				if (!fileKind(f.path)) continue;
				const parsed = parseFile(f.path, f.text);
				meta[f.path] = { text: f.text, hash: f.hash!, parsed };
				if (parsed.data !== undefined) data[f.path] = parsed.data;
			}
			this.meta = meta;
			this.data = data;
			this.loaded = true;
		} catch (e) {
			this.loadError = (e as Error).message;
		}
	}

	#serial<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.#chain.then(fn, fn);
		this.#chain = next.catch(() => undefined);
		return next;
	}

	/** A file changed on disk (editor save, git checkout, ...): applied at once. */
	onExternalChange(ev: ChangedEvent): Promise<void> {
		return this.#serial(async () => this.#apply([ev]));
	}

	/** Changes waiting to be applied together, by path, the newest of each. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- not state: read once, on applying
	#queued = new Map<string, ChangedEvent>();
	#queuedSince: number | undefined;
	#queueTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * A file changed on disk, as the watcher tells it. A burst of changes (a git checkout, a
	 * script or an agent writing many files) is applied as one: rebuilding the model and laying
	 * out a large landscape takes seconds, so once per file would hold up the page for minutes.
	 * Applied once no change has come for QUIET ms, and at the latest MAX_WAIT ms after the first.
	 */
	queueExternalChange(ev: ChangedEvent) {
		const QUIET = 100;
		const MAX_WAIT = 1000;
		const now = performance.now();
		this.#queued.set(ev.path, ev);
		this.#queuedSince ??= now;
		clearTimeout(this.#queueTimer);
		const wait = Math.max(0, Math.min(QUIET, this.#queuedSince + MAX_WAIT - now));
		this.#queueTimer = setTimeout(() => {
			const evs = [...this.#queued.values()];
			this.#queued.clear();
			this.#queuedSince = undefined;
			void this.#serial(async () => this.#apply(evs));
		}, wait);
	}

	#apply(evs: ChangedEvent[]) {
		const changed = evs.filter(
			(ev) => fileKind(ev.path) && ev.hash !== (this.meta[ev.path]?.hash ?? null)
		);
		if (!changed.length) return;
		const meta = { ...this.meta };
		const data = { ...this.data };
		for (const ev of changed) {
			if (ev.text === null || ev.hash === null) {
				delete meta[ev.path];
				delete data[ev.path];
			} else {
				const parsed = parseFile(ev.path, ev.text);
				meta[ev.path] = { text: ev.text, hash: ev.hash, parsed };
				// A file with syntax errors keeps its last valid data so the diagram stays visible.
				if (parsed.data !== undefined) data[ev.path] = parsed.data;
			}
		}
		this.meta = meta;
		this.data = data;
	}
}

export const design = new DesignStore();

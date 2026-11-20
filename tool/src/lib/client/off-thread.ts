/**
 * Work a large landscape takes seconds over (laying it out, checking every flag branch), done in
 * a worker so it never holds up the page: input, frames, or anything else the page does
 * meanwhile. Only the newest input is wanted: one is worked at a time, and of those sent
 * meanwhile only the last is worked next. Without a worker (tests, or one that failed), the work
 * is done in the page instead, the same way.
 */

type Reply<Out> = { id: number; output?: Out; error?: string };

/** A worker running `serveOffThread`, or anything answering like one. */
export interface OffThreadPort<In, Out> {
	postMessage(m: { id: number; input: In }): void;
	onmessage: ((e: { data: Reply<Out> }) => void) | null;
	onerror: ((e: { message?: string }) => void) | null;
	terminate(): void;
}

interface Job<In, Out> {
	input: In;
	done: (out: Out) => void;
}

export class OffThread<In, Out> {
	private busy?: Job<In, Out> & { id: number };
	private next?: Job<In, Out>;
	private ids = 0;
	private port?: OffThreadPort<In, Out>;

	/** `work` does in the page what the worker `make` makes does; without `make`, no worker. */
	constructor(
		private readonly work: (input: In) => Out,
		make?: () => OffThreadPort<In, Out>
	) {
		try {
			this.port = make?.();
		} catch (e) {
			console.error('No worker; working in the page:', e);
		}
		if (!this.port) return;
		this.port.onmessage = ({ data: m }) => {
			const job = this.busy?.id === m.id ? this.busy : undefined;
			this.busy = undefined;
			if (job && m.error === undefined) job.done(m.output as Out);
			else if (job) {
				// Failed in the worker: it fails in the page too, where the error shows.
				console.error('Worker failed:', m.error);
				job.done(this.work(job.input));
			}
			this.send();
		};
		this.port.onerror = (e) => {
			console.error('Worker failed; working in the page:', e.message);
			this.port?.terminate();
			this.port = undefined;
			for (const job of [this.busy, this.next]) if (job) job.done(this.work(job.input));
			this.busy = this.next = undefined;
		};
	}

	/**
	 * Works `input` and tells `done` the output, unless newer input comes before its turn: then
	 * only the newest is worked. Without a worker `done` is told at once.
	 */
	run(input: In, done: (out: Out) => void) {
		if (!this.port) return done(this.work(input));
		this.next = { input, done };
		this.send();
	}

	destroy() {
		this.port?.terminate();
		this.port = undefined;
		this.busy = this.next = undefined;
	}

	private send() {
		if (!this.port || this.busy || !this.next) return;
		this.busy = { ...this.next, id: ++this.ids };
		this.next = undefined;
		try {
			this.port.postMessage({ id: this.busy.id, input: this.busy.input });
		} catch (e) {
			// Input a worker cannot be sent (a mistake): worked in the page instead.
			console.error('Could not send to the worker; working in the page:', e);
			const job = this.busy;
			this.busy = undefined;
			job.done(this.work(job.input));
			this.send();
		}
	}
}

/** The worker's side: answers each input with `work`'s output, or the error it threw. */
export function serveOffThread<In, Out>(work: (input: In) => Out, reply: (m: Reply<Out>) => void) {
	return ({ id, input }: { id: number; input: In }) => {
		try {
			reply({ id, output: work(input) });
		} catch (e) {
			reply({ id, error: String((e as Error)?.stack ?? e) });
		}
	};
}

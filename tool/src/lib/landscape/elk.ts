import type { ElkNode } from 'elkjs/lib/elk-api';
import ElkWorker from 'elkjs/lib/elk-worker.min.js';

/**
 * ELK run in-process and synchronously. Its public api is a promise round a worker; the
 * worker's stand-in for a page without workers takes the same messages and answers at once
 * when its dispatcher is called directly, so the layout stays a plain function.
 */
interface Dispatcher {
	dispatcher: { saveDispatch(ev: { data: unknown }): void };
	onmessage(ev: { data: { data?: ElkNode; error?: Error } }): void;
}

// Vite hands over the module's default export, Node the CommonJS exports object round it.
const FakeWorker = ((ElkWorker as unknown as { Worker?: unknown }).Worker ??
	ElkWorker) as unknown as new () => Dispatcher;

let worker: Dispatcher | undefined;

/** Lays out `graph` and returns it with every child's position and its own size. */
export function elkLayout(graph: ElkNode): ElkNode {
	if (!worker) {
		worker = new FakeWorker();
		worker.onmessage = () => {};
		worker.dispatcher.saveDispatch({
			data: {
				id: 0,
				cmd: 'register',
				algorithms: ['layered', 'stress', 'sporeOverlap', 'sporeCompaction']
			}
		});
	}
	let out: { data?: ElkNode; error?: Error } = {};
	worker.onmessage = (ev) => (out = ev.data);
	worker.dispatcher.saveDispatch({ data: { id: 1, cmd: 'layout', graph } });
	if (out.error) throw new Error(out.error.message);
	return out.data!;
}

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

/**
 * Graphs laid out lately, by the graph, least lately used first. ELK is most of what a layout
 * costs, and it lays out the same graph the same way, so a change to one box lays out again
 * only the graphs it is in: its own siblings, and its parents' up to the root.
 */
const laidOut = new Map<string, string>();
const KEEP = 4096;

/** Lays out `graph` and returns it with every child's position and its own size. */
export function elkLayout(graph: ElkNode): ElkNode {
	const key = JSON.stringify(graph);
	let out = laidOut.get(key);
	if (out !== undefined) laidOut.delete(key);
	else out = JSON.stringify(run(graph));
	laidOut.set(key, out);
	for (const k of laidOut.keys()) {
		if (laidOut.size <= KEEP) break;
		laidOut.delete(k);
	}
	// A copy each time: what is handed out may be changed.
	return JSON.parse(out);
}

function run(graph: ElkNode): ElkNode {
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

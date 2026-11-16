import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { fileKind } from '../model/parse';
import { readText, sha256, toRel } from './files';
import { currentRoot, onLandscapeChange, type LandscapeRef, ref } from './landscape';

/** Payload of the `sdv:changed` HMR event. `text` is null when the file was deleted. */
export interface ChangedEvent {
	path: string;
	text: string | null;
	hash: string | null;
}

/** Payload of the `sdv:landscape` HMR event: the landscape now open, or null when closed. */
export type LandscapeEvent = { landscape: LandscapeRef | null };

/**
 * Watches the open landscape's folder (which may live outside the project) and pushes file
 * contents to the browser as `sdv:changed` custom HMR events, so saving in an editor updates
 * the canvas without a page reload. When another landscape is opened or it is closed, the
 * watcher moves with it and every tab gets `sdv:landscape`.
 */
export async function attachDesignWatcher(server: ViteDevServer): Promise<void> {
	let root = await currentRoot();
	const insideProject = (dir: string) => {
		const rel = path.relative(server.config.root, dir);
		return !rel.startsWith('..') && !path.isAbsolute(rel);
	};
	if (root) server.watcher.add(root);

	onLandscapeChange((next, previous) => {
		// Unwatching a folder inside the project would also stop the app's own hot reload.
		if (previous && !insideProject(previous)) server.watcher.unwatch(previous);
		if (next) server.watcher.add(next);
		root = next;
		const data: LandscapeEvent = { landscape: next ? ref(next) : null };
		server.ws.send({ type: 'custom', event: 'sdv:landscape', data });
	});

	const notify = async (file: string, deleted: boolean) => {
		if (!root) return;
		const rel = toRel(root, file);
		if (rel.startsWith('..') || path.isAbsolute(rel) || !fileKind(rel)) return;
		const text = deleted ? null : ((await readText(file)) ?? null);
		const event: ChangedEvent = { path: rel, text, hash: text === null ? null : sha256(text) };
		server.ws.send({ type: 'custom', event: 'sdv:changed', data: event });
	};
	server.watcher.on('add', (f) => void notify(f, false));
	server.watcher.on('change', (f) => void notify(f, false));
	server.watcher.on('unlink', (f) => void notify(f, true));
}

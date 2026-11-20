// The worker the landscape is laid out in (see LandscapeCanvas.svelte), loaded with Vite's `?worker`.
import { unlend } from './elk-in-worker.ts';
import { layoutLandscape, type LayoutOptions } from './layout.ts';
import { serveOffThread } from '../client/off-thread.ts';
import type { Model } from '../model/model.ts';

unlend();

export interface LayoutInput {
	model: Model;
	opts: LayoutOptions;
	foldAt?: Map<string, number>;
}

const scope = self as unknown as {
	postMessage(m: unknown): void;
	onmessage: ((e: MessageEvent) => void) | null;
};
const serve = serveOffThread(
	({ model, opts, foldAt }: LayoutInput) => layoutLandscape(model, opts, foldAt),
	(m) => scope.postMessage(m)
);
scope.onmessage = (e) => serve(e.data);

// The worker flag branches are checked in (see store.svelte.ts), loaded with Vite's `?worker`.
import { serveOffThread } from '../client/off-thread.ts';
import { flagSplitsOf } from './flags.ts';

const scope = self as unknown as {
	postMessage(m: unknown): void;
	onmessage: ((e: MessageEvent) => void) | null;
};
const serve = serveOffThread(flagSplitsOf, (m) => scope.postMessage(m));
scope.onmessage = (e) => serve(e.data);

/**
 * Imported before ELK in a worker (see layout-worker.ts). ELK's script, loaded in a worker,
 * takes the worker over as its own instead of handing over the in-process stand-in elk.ts
 * runs it through; seeing a document, it hands that over as it does in a page. The stand-in is
 * taken away again once ELK has loaded.
 */
const scope = globalThis as { document?: unknown };
export const lent = scope.document === undefined;
if (lent) scope.document = {};

/** Takes the stand-in away once ELK has loaded. */
export function unlend() {
	if (lent) delete scope.document;
}

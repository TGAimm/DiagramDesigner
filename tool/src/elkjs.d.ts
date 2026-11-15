/** ELK's worker script; `elk.ts` drives it in-process. */
declare module 'elkjs/lib/elk-worker.min.js' {
	const worker: unknown;
	export default worker;
}

/** libavoid compiled to WebAssembly; its package points at typings it does not ship. */
declare module 'libavoid-js' {
	export const AvoidLib: {
		load(wasmUrl?: string): Promise<void>;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- an Emscripten binding
		getInstance(): any;
	};
}

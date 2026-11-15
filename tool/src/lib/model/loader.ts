import { flagSplits } from './flags';
import { buildModel, type Locator, type Model } from './model';
import { fileKind, locate, parseFile, type ParsedFile } from './parse';
import type { Diagnostic } from './diagnostics';

export interface SourceFile {
	/** Relative to the design root, forward slashes. */
	path: string;
	text: string;
	hash?: string;
}

export interface LoadedDesign {
	parsed: Record<string, ParsedFile>;
	/** Plain data per file; undefined for files with syntax errors. */
	data: Record<string, unknown>;
	model: Model;
	/** Syntax and model diagnostics together. */
	diagnostics: Diagnostic[];
}

export function locatorFor(parsed: Record<string, ParsedFile>): Locator {
	return (file, path, key) => {
		const p = parsed[file];
		return p ? locate(p.doc, p.lines, path, key) : undefined;
	};
}

/** Parses all design files and builds the validated model. */
export function loadDesign(sources: SourceFile[]): LoadedDesign {
	const parsed: Record<string, ParsedFile> = {};
	const data: Record<string, unknown> = {};
	for (const src of sources) {
		if (fileKind(src.path) !== 'entity') continue;
		const p = parseFile(src.path, src.text);
		parsed[src.path] = p;
		data[src.path] = p.data;
	}
	const locate = locatorFor(parsed);
	const model = buildModel(data, locate);
	const diagnostics = [
		...Object.values(parsed).flatMap((p) => p.diagnostics),
		...model.diagnostics,
		...placed(flagSplits(model, data), locate)
	];
	return { parsed, data, model, diagnostics };
}

/** Diagnostics given a file and data path, with their line and column filled in. */
export const placed = (diags: Diagnostic[], locate: Locator) =>
	diags.map((d) => ({ ...d, ...(d.file && d.path ? locate(d.file, d.path) : {}) }));

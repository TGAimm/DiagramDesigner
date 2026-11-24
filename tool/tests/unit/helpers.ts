import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDesign, type LoadedDesign, type SourceFile } from '../../src/lib/model/loader';

export const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/design', import.meta.url));

function walk(dir: string, base = dir): string[] {
	return readdirSync(dir).flatMap((name) => {
		const abs = path.join(dir, name);
		return statSync(abs).isDirectory()
			? walk(abs, base)
			: [path.relative(base, abs).split(path.sep).join('/')];
	});
}

export function fixtureSources(): SourceFile[] {
	return walk(FIXTURE_ROOT)
		.sort()
		.map((p) => ({ path: p, text: readFileSync(path.join(FIXTURE_ROOT, p), 'utf8') }));
}

export function loadFixture(): LoadedDesign {
	return loadDesign(fixtureSources());
}

/**
 * Loads a partial design written for one feature's test. Nothing starts most of the units
 * in such a snippet, so `unreached` warnings are left out; reach.test.ts tests them with
 * `loadDesign`.
 */
export function loadStrings(files: Record<string, string>): LoadedDesign {
	const design = loadDesign(Object.entries(files).map(([p, text]) => ({ path: p, text })));
	const runs = (d: { code: string }) => d.code !== 'unreached';
	design.model.diagnostics = design.model.diagnostics.filter(runs);
	design.diagnostics = design.diagnostics.filter(runs);
	return design;
}

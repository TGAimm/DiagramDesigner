import { promises as fs } from 'node:fs';
import { loadDesign } from '../model/loader';
import { fileKind, parseFile } from '../model/parse';
import { applyChanges } from '../scenario/apply';
import { evaluate, newErrors } from '../scenario/evaluate';
import { readScenario, stringify } from '../scenario/scenario';
import { atomicWrite, readDesign, readText, resolveInRoot } from './files';

/** Resolves a scenario file path, refusing anything else. */
function scenarioPath(root: string, rel: string): string {
	if (fileKind(rel) !== 'scenario') throw new Error(`Not a scenario file: ${rel}`);
	return resolveInRoot(root, rel);
}

export async function writeScenario(root: string, rel: string, text: string): Promise<void> {
	await atomicWrite(scenarioPath(root, rel), text);
}

export async function deleteScenario(root: string, rel: string): Promise<void> {
	await fs.rm(scenarioPath(root, rel), { force: true });
}

/**
 * Writes a scenario's changes into the entity files and deletes the scenario file. Refused
 * while a change is stale or the result has errors the design does not already have.
 */
export async function applyScenario(
	root: string,
	rel: string
): Promise<{ written: string[]; removed: string[] }> {
	const abs = scenarioPath(root, rel);
	const text = await readText(abs);
	if (text === undefined) throw new Error(`No such scenario: ${rel}`);
	const scenario = readScenario(parseFile(rel, text));
	if (scenario.diagnostics.some((d) => d.severity === 'error'))
		throw new Error(`${rel} has errors`);
	const design = loadDesign(await readDesign(root));
	const docs = Object.fromEntries(Object.entries(design.parsed).map(([f, p]) => [f, p.doc]));
	const ev = evaluate(docs, design, scenario.changes);
	const bad = ev.results.findIndex((r) => r.status !== 'ok');
	if (bad >= 0) throw new Error(`change ${bad + 1} is ${ev.results[bad].status}`);
	const errors = newErrors(design.model, ev.after);
	if (errors.length) throw new Error(`the result has errors: ${errors[0].message}`);
	const applied = applyChanges(docs, scenario.changes);
	const written: string[] = [];
	const removed: string[] = [];
	for (const file of applied.touched) {
		const target = resolveInRoot(root, file);
		if (applied.docs[file]) {
			await atomicWrite(target, stringify(applied.docs[file]));
			written.push(file);
		} else {
			await fs.rm(target, { force: true });
			removed.push(file);
		}
	}
	await fs.rm(abs, { force: true });
	return { written, removed };
}

import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/lib/server/config';
import { readDesign } from '../src/lib/server/files';
import { loadDesign, type LoadedDesign } from '../src/lib/model/loader';
import { fileKind, parseFile } from '../src/lib/model/parse';
import { evaluate, newErrors } from '../src/lib/scenario/evaluate';
import { scenarioReport } from '../src/lib/scenario/report';
import { readScenario } from '../src/lib/scenario/scenario';
import { formatDiagnostic, hasErrors, sortDiagnostics } from '../src/lib/model/diagnostics';

const HELP = `sdv — System Design Viewer CLI

Usage:
  sdv validate                 schema + reference checks; exit 1 on errors
  sdv impact <scenario>        what a scenario file changes and breaks, as markdown;
                               exit 1 if a change is stale or leaves errors
  sdv new <name.kind.yaml> [--parent id]
                               create an entity file with a generated id;
                               --parent is written as ownedBy for models
  sdv id [count]               print fresh ids, e.g. for model fields
  sdv schema [--out dir]       write the JSON Schema for entity files
  sdv migrate triggers [--dry-run]
                               turn triggers' message sources into channels and on

Options:
  --config <file>              config file (default: search for sdv.config.ts)
  --root <dir>                 design root (overrides config; same as SDV_ROOT)
  -q, --quiet                  only print errors
`;

const docsOf = (design: LoadedDesign) =>
	Object.fromEntries(Object.entries(design.parsed).map(([f, p]) => [f, p.doc]));

/** A scenario's own errors, plus a warning for each change that no longer applies. */
function scenarioDiagnostics(design: LoadedDesign, scenario: ReturnType<typeof readScenario>) {
	const ev = evaluate(docsOf(design), design, scenario.changes);
	return [
		...scenario.diagnostics,
		...ev.results.flatMap((r, i) =>
			r.status === 'ok'
				? []
				: [
						{
							severity: 'warning' as const,
							code: `scenario-${r.status}`,
							message: `change ${i + 1} of "${scenario.name}" is ${r.status}: ${r.message}`,
							file: scenario.path
						}
					]
		)
	];
}

export interface CliIO {
	log(msg: string): void;
	error(msg: string): void;
}

const consoleIO: CliIO = { log: (m) => console.log(m), error: (m) => console.error(m) };

export async function main(
	argv: string[],
	io: CliIO = consoleIO,
	cwd = process.cwd()
): Promise<number> {
	const [command, ...rest] = argv;
	if (!command || command === 'help' || command === '--help' || command === '-h') {
		io.log(HELP);
		return command ? 0 : 1;
	}
	const { values, positionals } = parseArgs({
		args: rest,
		allowPositionals: true,
		options: {
			config: { type: 'string' },
			root: { type: 'string' },
			out: { type: 'string' },
			parent: { type: 'string' },
			'dry-run': { type: 'boolean' },
			quiet: { type: 'boolean', short: 'q' }
		}
	});
	const env = { ...process.env };
	if (values.root) env.SDV_ROOT = values.root;
	const config = await loadConfig({ cwd, configFile: values.config, env });

	switch (command) {
		case 'validate': {
			const sources = await readDesign(config.root);
			const design = loadDesign(sources);
			const scenarioDiags = sources
				.filter((f) => fileKind(f.path) === 'scenario')
				.flatMap((f) => scenarioDiagnostics(design, readScenario(parseFile(f.path, f.text))));
			const diags = sortDiagnostics([...design.diagnostics, ...scenarioDiags]);
			for (const d of diags) {
				if (d.severity === 'error') io.error(formatDiagnostic(d));
				else if (!values.quiet) io.log(formatDiagnostic(d));
			}
			const errors = diags.filter((d) => d.severity === 'error').length;
			const warnings = diags.length - errors;
			if (!values.quiet) {
				io.log(`${design.model.files.length} files: ${errors} error(s), ${warnings} warning(s)`);
			}
			return hasErrors(diags) ? 1 : 0;
		}
		case 'impact': {
			const [file] = positionals;
			if (!file) {
				io.error('Usage: sdv impact <scenario.yaml>');
				return 2;
			}
			const sources = await readDesign(config.root);
			const abs = path.resolve(cwd, file);
			const rel = path.relative(
				config.root,
				existsSync(abs) ? abs : path.resolve(config.root, file)
			);
			const src = sources.find((f) => f.path === rel.split(path.sep).join('/'));
			if (!src || fileKind(src.path) !== 'scenario') {
				io.error(`No scenario file ${file} in ${config.root}`);
				return 2;
			}
			const design = loadDesign(sources);
			const scenario = readScenario(parseFile(src.path, src.text));
			const ev = evaluate(docsOf(design), design, scenario.changes);
			const errors = newErrors(design.model, ev.after);
			for (const d of scenario.diagnostics) io.error(formatDiagnostic(d));
			io.log(scenarioReport(scenario, ev, errors));
			return ev.results.some((r) => r.status !== 'ok') || errors.length ? 1 : 0;
		}
		case 'new': {
			const { runNew } = await import('./new');
			return runNew(positionals, values.parent, io, cwd);
		}
		case 'id': {
			const { runId } = await import('./new');
			return runId(positionals, io);
		}
		case 'schema': {
			const { runSchema } = await import('./schema');
			return runSchema(values.out, io, cwd);
		}
		case 'migrate': {
			const { runMigrate } = await import('./migrate');
			return runMigrate(positionals, config.root, io, values['dry-run']);
		}
		default:
			io.error(`Unknown command "${command}"\n\n${HELP}`);
			return 2;
	}
}

import type {
	ApiBody,
	ApiField,
	Element,
	EntityFile,
	EntityFileKind,
	LogicStep,
	ModelField
} from './schema';
import { ENTITY_KINDS, PARENT_KINDS } from './schema';
import type { DataPath, Diagnostic, Severity } from './diagnostics';
import { entityKind, fileKind } from './parse';
import { toDiagnostic, validateEntityFile } from './validate-file';

/** Where an entity lives: design-root-relative file and data path inside it. */
export interface Loc {
	file: string;
	path: DataPath;
}

export interface ElementInfo {
	id: string;
	def: Element;
	name: string;
	parentId?: string;
	childIds: string[];
	/** Models owned elsewhere that are drawn inside this entity as references. */
	refIds: string[];
	/** Models only: the system or module storing it. */
	storedIn?: string;
	/** Models stored here (their `storedIn`), drawn inside as tables. */
	storedIds: string[];
	tags?: string[];
	/** Logic units only: what it handles, and what its steps read, write and call. */
	logic?: LogicLinks;
	/** 0 for top-level elements. */
	depth: number;
	loc: Loc;
}

/** A model field, found by its id. */
export interface FieldInfo {
	def: ModelField;
	/** Id of the model the field belongs to. */
	modelId: string;
	loc: Loc;
}

/** Which body of an api: its request, or the response with this status. */
export type ApiPart = 'request' | number;

/** A field of a body shape written on an api, found by its id. */
export interface ApiFieldInfo {
	def: ApiField;
	apiId: string;
	part: ApiPart;
	loc: Loc;
}

/** `part`: an api param or model index that has an id. */
export type GlobalKind = 'element' | 'field' | 'part';

/** An api's bodies, request first, with where each is written. */
export const apiBodies = (def: Element) => [
	...(def.request
		? [{ part: 'request' as ApiPart, body: def.request as ApiBody, path: ['request'] }]
		: []),
	...(def.responses ?? []).map((body, i) => ({
		part: body.status as ApiPart,
		body: body as ApiBody,
		path: ['responses', i] as (string | number)[]
	}))
];

export interface Model {
	elements: Map<string, ElementInfo>;
	fields: Map<string, FieldInfo>;
	/** Fields of body shapes written on apis. */
	apiFields: Map<string, ApiFieldInfo>;
	rootElementIds: string[];
	/** Global id namespace. */
	ids: Map<string, { kind: GlobalKind; loc: Loc }>;
	/** Every design file, sorted. */
	files: string[];
	diagnostics: Diagnostic[];
}

export type Locator = (
	file: string,
	path: DataPath,
	key?: string
) => { line: number; col: number } | undefined;

/**
 * Builds the resolved model from parsed file data (keyed by design-relative path) and runs
 * schema and reference validation. Never throws on invalid input.
 */
export function buildModel(files: Record<string, unknown>, locate?: Locator): Model {
	const model: Model = {
		elements: new Map(),
		fields: new Map(),
		apiFields: new Map(),
		rootElementIds: [],
		ids: new Map(),
		files: Object.keys(files)
			.filter((f) => fileKind(f) === 'entity')
			.sort(),
		diagnostics: []
	};
	const diag = (severity: Severity, code: string, message: string, loc?: Loc, key?: string) => {
		const pos = loc ? locate?.(loc.file, loc.path, key) : undefined;
		model.diagnostics.push({
			severity,
			code,
			message,
			file: loc?.file,
			line: pos?.line,
			col: pos?.col,
			path: loc?.path
		});
	};
	const at = (loc: Loc, ...rest: DataPath): Loc => ({
		file: loc.file,
		path: [...loc.path, ...rest]
	});
	const where = (loc: Loc) => {
		const pos = locate?.(loc.file, loc.path);
		return pos ? `${loc.file}:${pos.line}:${pos.col}` : loc.file;
	};

	const claim = (id: string, kind: GlobalKind, loc: Loc): boolean => {
		const prev = model.ids.get(id);
		if (prev) {
			diag(
				'error',
				'duplicate-id',
				`duplicate id "${id}" (also defined at ${where(prev.loc)})`,
				loc,
				'id'
			);
			return false;
		}
		model.ids.set(id, { kind, loc });
		return true;
	};

	/** Whether `id` is something a logic unit's `key` may name; reports it if not. */
	const logicTarget = (key: keyof typeof LOGIC_TARGETS, id: string, loc: Loc, atKey?: string) => {
		const field = model.fields.get(id);
		const kind = field ? 'field' : model.elements.get(id)?.def.kind;
		const allowed = LOGIC_TARGETS[key];
		if (!kind)
			diag(
				'error',
				'dangling-ref',
				`${key} names "${id}", which is not an entity or field`,
				loc,
				atKey
			);
		else if (!allowed.includes(kind))
			diag(
				'error',
				'logic-target',
				`${key} names ${kind} "${field?.def.name ?? model.elements.get(id)!.name}"; allowed: ${allowed.join(', ')}`,
				loc,
				atKey
			);
		else return true;
		return false;
	};

	/** Checks a logic unit's references and steps, and collects what they name. */
	const logicLinks = (info: ElementInfo): LogicLinks => {
		const def = info.def;
		const links: LogicLinks = { handles: [], reads: [], writes: [], calls: [] };
		const add = (key: keyof LogicLinks, id: string) => {
			if (!links[key].includes(id)) links[key].push(id);
		};
		def.handles?.forEach((id, j) => {
			if (logicTarget('handles', id, at(info.loc, 'handles', j))) add('handles', id);
		});
		for (const key of ['inputs', 'outputs'] as const)
			def[key]?.forEach((f, i) => {
				if (f.model && model.elements.get(f.model)?.def.kind !== 'model')
					diag(
						'error',
						'not-a-model',
						`${key.slice(0, -1)} "${f.name}" is "${f.model}", which is not a model`,
						at(info.loc, key, i),
						'model'
					);
			});
		const outputs = new Set(def.outputs?.map((o) => o.name));
		const fails = new Set(def.fails?.map((f) => f.name));
		const returned = new Set<string>();
		const raised = new Set<string>();
		const walk = (steps: LogicStep[] | undefined, loc: Loc, key: string) =>
			steps?.forEach((s, i) => {
				const stepLoc = at(loc, key, i);
				const kinds = STEP_KINDS.filter((k) => s[k] !== undefined);
				const k = kinds[0];
				if (kinds.length > 1)
					diag(
						'error',
						'logic-step',
						`a step does one thing; this one has ${kinds.join(' and ')}`,
						stepLoc,
						kinds[1]
					);
				if (!k && s.note === undefined)
					diag(
						'error',
						'logic-step',
						`empty step; give call, read, write, if, each, return, fail or note`,
						stepLoc
					);
				for (const [sub, owner] of [
					['then', 'if'],
					['else', 'if'],
					['do', 'each']
				] as const)
					if (s[sub] && k !== owner)
						diag('error', 'logic-step', `${sub} goes with ${owner}`, stepLoc, sub);
				for (const sub of ['with', 'gets'] as const)
					if (s[sub] !== undefined && k !== 'call' && k !== 'read')
						diag('error', 'logic-step', `${sub} goes with call or read`, stepLoc, sub);
				if (k === 'call' || k === 'read' || k === 'write')
					if (logicTarget(k, s[k]!, stepLoc, k)) add(`${k}s` as keyof LogicLinks, s[k]!);
				if (k === 'return') {
					returned.add(s.return!);
					if (!outputs.has(s.return!))
						diag(
							'error',
							'logic-return',
							`returns "${s.return}", which is not an output`,
							stepLoc,
							k
						);
				}
				if (k === 'fail') {
					raised.add(s.fail!);
					if (!fails.has(s.fail!))
						diag('error', 'logic-fail', `fails "${s.fail}", which is not in fails`, stepLoc, k);
				}
				walk(s.then, stepLoc, 'then');
				walk(s.else, stepLoc, 'else');
				walk(s.do, stepLoc, 'do');
			});
		walk(def.steps, info.loc, 'steps');
		if (def.steps?.length) {
			def.outputs?.forEach((o, i) => {
				if (!returned.has(o.name))
					diag(
						'warning',
						'logic-unused',
						`output "${o.name}" is never returned`,
						at(info.loc, 'outputs', i),
						'name'
					);
			});
			def.fails?.forEach((f, i) => {
				if (!raised.has(f.name))
					diag(
						'warning',
						'logic-unused',
						`fail "${f.name}" is never raised`,
						at(info.loc, 'fails', i),
						'name'
					);
			});
		}
		return links;
	};

	const entityFiles: { file: string; value: EntityFile }[] = [];

	for (const file of model.files) {
		const data = files[file];
		if (data === undefined) continue; // syntax errors are reported by the parser
		const fileLocate = (path: DataPath, key?: string) => locate?.(file, path, key);
		const res = validateEntityFile(data);
		for (const issue of res.issues) model.diagnostics.push(toDiagnostic(file, issue, fileLocate));
		if (res.value) entityFiles.push({ file, value: res.value });
	}

	// ------------------------------------------------------------ entity files
	// Parents are linked after every file is read, since files load in path order.
	const entities: ElementInfo[] = [];
	for (const { file, value } of entityFiles) {
		const loc = { file, path: [] };
		const kind = entityKind(file) as EntityFileKind;
		if (!ENTITY_KINDS.includes(kind)) {
			diag(
				'error',
				'unknown-kind',
				`unknown kind "${kind}"; expected ${ENTITY_KINDS.join(', ')}`,
				loc
			);
			continue;
		}
		if (!claim(value.id, 'element', loc)) continue;
		const { parent, ownedBy, storedIn, models, ...rest } = value;
		const base = file.slice(file.lastIndexOf('/') + 1).split('.')[0];
		const info: ElementInfo = {
			id: value.id,
			def: { ...rest, kind },
			name: value.name ?? base,
			tags: value.tags,
			parentId: kind === 'model' ? ownedBy : parent,
			childIds: [],
			refIds: models ?? [],
			storedIn,
			storedIds: [],
			depth: 0,
			loc
		};
		model.elements.set(value.id, info);
		entities.push(info);
		if (kind === 'system' && parent)
			diag('error', 'system-parent', `system "${info.name}" cannot have a parent`, loc, 'parent');
		if (kind === 'model' && parent)
			diag('error', 'model-parent', `model "${info.name}" uses ownedBy, not parent`, loc, 'parent');
		if (kind !== 'model' && ownedBy)
			diag('error', 'owned-by', `only models have ownedBy`, loc, 'ownedBy');
		if (value.external && kind !== 'system' && kind !== 'module' && kind !== 'api')
			diag('error', 'external', `only systems, modules and apis are external`, loc, 'external');
		if (kind !== 'model' && storedIn)
			diag('error', 'model-only', `only models have storedIn`, loc, 'storedIn');
		if (kind === 'model' && !ownedBy)
			diag('error', 'missing-owner', `model "${info.name}" needs ownedBy`, loc, 'id');
		if (kind !== 'system' && kind !== 'model' && !parent)
			diag('error', 'missing-parent', `${kind} "${info.name}" needs a parent`, loc, 'id');
		if (kind === 'model') {
			if (models) diag('error', 'model-only', `a model cannot list models`, loc, 'models');
			const names = new Set<string>();
			value.fields?.forEach((f, i) => {
				const fieldLoc = at(loc, 'fields', i);
				if (claim(f.id, 'field', fieldLoc))
					model.fields.set(f.id, { def: f, modelId: value.id, loc: fieldLoc });
				if (names.has(f.name))
					diag('error', 'duplicate-field', `field "${f.name}" is defined twice`, fieldLoc, 'name');
				names.add(f.name);
				if (!f.type === !f.model)
					diag(
						'error',
						'field-type',
						`field "${f.name}" needs exactly one of type and model`,
						fieldLoc,
						f.type ? 'model' : 'name'
					);
				if (f.model && f.ref)
					diag(
						'error',
						'field-type',
						`field "${f.name}" holds a model, so it cannot also ref a key`,
						fieldLoc,
						'ref'
					);
				if (f.pk && f.nullable)
					diag(
						'error',
						'nullable-key',
						`key field "${f.name}" cannot be nullable`,
						fieldLoc,
						'nullable'
					);
				if (f.pk && (f.model || f.stored === false))
					diag(
						'error',
						'unstored-key',
						`key field "${f.name}" must be stored, so it cannot hold a model or be stored: false`,
						fieldLoc,
						'pk'
					);
			});
			const own = new Set(
				value.fields?.filter((f) => !f.model && f.stored !== false).map((f) => f.id)
			);
			value.indexes?.forEach((ix, i) => {
				if (ix.id) claim(ix.id, 'part', at(loc, 'indexes', i));
			});
			value.indexes?.forEach((ix, i) =>
				ix.fields.forEach((f, j) => {
					if (!own.has(f))
						diag(
							'error',
							'unknown-field',
							`index "${ix.name}" uses "${f}", which is not a stored field of this model`,
							at(loc, 'indexes', i, 'fields', j)
						);
				})
			);
		} else {
			for (const key of ['fields', 'indexes'] as const)
				if (value[key]) diag('error', 'model-only', `only models have ${key}`, loc, key);
		}
		if (kind === 'api') {
			for (const key of ['method', 'path'] as const)
				if (!value[key])
					diag('error', 'missing-route', `api "${info.name}" needs ${key}`, loc, 'id');
			const inPath = [...(value.path ?? '').matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
			if (value.path && !value.path.startsWith('/'))
				diag('error', 'api-path', `path must start with /`, loc, 'path');
			for (const name of inPath)
				if (!value.params?.some((p) => p.in === 'path' && p.name === name))
					diag('error', 'api-param', `path has {${name}} but no path param "${name}"`, loc, 'path');
			value.params?.forEach((p, i) => {
				if (p.id) claim(p.id, 'part', at(loc, 'params', i));
				if (p.in === 'path' && !inPath.includes(p.name))
					diag(
						'error',
						'api-param',
						`path param "${p.name}" is not in the path`,
						at(loc, 'params', i),
						'name'
					);
			});
			const statuses = new Set<number>();
			value.responses?.forEach((r, i) => {
				if (statuses.has(r.status))
					diag(
						'error',
						'api-response',
						`status ${r.status} is listed twice`,
						at(loc, 'responses', i),
						'status'
					);
				statuses.add(r.status);
			});
			for (const { part, body, path } of apiBodies({ ...value, kind })) {
				const bodyLoc = at(loc, ...path);
				const name = part === 'request' ? 'request' : `response ${part}`;
				if (body.model && body.fields)
					diag('error', 'api-body', `${name} gives both model and fields`, bodyLoc, 'fields');
				if (part === 'request' && !body.model && !body.fields)
					diag('error', 'api-body', `request needs a model or fields`, bodyLoc);
				if (!body.model && (body.omit || body.pick))
					diag(
						'error',
						'api-body',
						`${name}: omit and pick need a model`,
						bodyLoc,
						body.omit ? 'omit' : 'pick'
					);
				if (body.omit && body.pick)
					diag('error', 'api-body', `${name} gives both omit and pick`, bodyLoc, 'pick');
				const names = new Set<string>();
				body.fields?.forEach((f, i) => {
					const fieldLoc = at(bodyLoc, 'fields', i);
					if (claim(f.id, 'field', fieldLoc))
						model.apiFields.set(f.id, { def: f, apiId: value.id, part, loc: fieldLoc });
					if (names.has(f.name))
						diag(
							'error',
							'duplicate-field',
							`field "${f.name}" is defined twice`,
							fieldLoc,
							'name'
						);
					names.add(f.name);
					if (!f.type === !f.model)
						diag(
							'error',
							'field-type',
							`field "${f.name}" needs exactly one of type and model`,
							fieldLoc,
							f.type ? 'model' : 'name'
						);
					if (part === 'request' && f.from)
						diag(
							'error',
							'api-field-direction',
							`request field "${f.name}" sends data, so it says where it goes (to), not from`,
							fieldLoc,
							'from'
						);
					if (part !== 'request' && f.to)
						diag(
							'error',
							'api-field-direction',
							`response field "${f.name}" returns data, so it says where it comes from (from), not to`,
							fieldLoc,
							'to'
						);
				});
			}
		} else {
			for (const key of ['method', 'path', 'auth', 'params', 'request', 'responses'] as const)
				if (value[key]) diag('error', 'api-only', `only apis have ${key}`, loc, key);
		}
		if (kind === 'logic-unit')
			for (const key of ['inputs', 'outputs'] as const) {
				if (!value[key])
					diag(
						'error',
						'logic-signature',
						`logic unit "${info.name}" needs ${key}; use [] for none`,
						loc,
						'id'
					);
				const names = new Set<string>();
				value[key]?.forEach((f, i) => {
					const fieldLoc = at(loc, key, i);
					claim(f.id, 'field', fieldLoc);
					if (names.has(f.name))
						diag('error', 'duplicate-field', `${key} has "${f.name}" twice`, fieldLoc, 'name');
					names.add(f.name);
					if (!f.type === !f.model)
						diag(
							'error',
							'field-type',
							`${key.slice(0, -1)} "${f.name}" needs exactly one of type and model`,
							fieldLoc,
							f.type ? 'model' : 'name'
						);
				});
			}
		else
			for (const key of ['handles', 'inputs', 'outputs', 'fails', 'steps'] as const)
				if (value[key]) diag('error', 'logic-only', `only logic units have ${key}`, loc, key);
	}
	for (const info of entities) {
		info.def.fields?.forEach((f, i) => {
			const fieldLoc = at(info.loc, 'fields', i);
			if (f.model) {
				const target = model.elements.get(f.model);
				if (!target)
					diag(
						'error',
						'dangling-ref',
						`field "${f.name}" holds unknown model "${f.model}"`,
						fieldLoc,
						'model'
					);
				else if (target.def.kind !== 'model')
					diag(
						'error',
						'not-a-model',
						`field "${f.name}" holds ${target.def.kind} "${target.name}", not a model`,
						fieldLoc,
						'model'
					);
			}
			f.from?.forEach((src, j) => {
				const srcLoc = at(fieldLoc, 'from', j);
				if (src === f.id)
					diag('error', 'lineage-cycle', `field "${f.name}" comes from itself`, srcLoc);
				else if (!model.fields.has(src))
					diag(
						'error',
						'dangling-ref',
						`field "${f.name}" comes from "${src}", which is not a field`,
						srcLoc
					);
			});
		});
	}
	const lineage = new Map(
		[...model.fields].map(([id, f]) => [id, (f.def.from ?? []).filter((s) => s !== id)])
	);
	const cycle = findCycle(lineage);
	if (cycle)
		diag(
			'error',
			'lineage-cycle',
			`fields come from each other: ${cycle.map((id) => model.fields.get(id)!.def.name).join(' <- ')}`,
			at(model.fields.get(cycle[0])!.loc, 'from')
		);
	for (const info of entities) {
		for (const { part, body, path } of info.def.kind === 'api' ? apiBodies(info.def) : []) {
			const bodyLoc = at(info.loc, ...path);
			const target = body.model ? model.elements.get(body.model) : undefined;
			if (body.model && !target)
				diag('error', 'dangling-ref', `model "${body.model}" is not an entity`, bodyLoc, 'model');
			else if (target && target.def.kind !== 'model')
				diag(
					'error',
					'not-a-model',
					`"${target.name}" is a ${target.def.kind}, not a model`,
					bodyLoc,
					'model'
				);
			else if (target)
				for (const key of ['omit', 'pick'] as const)
					body[key]?.forEach((id, j) => {
						if (model.fields.get(id)?.modelId !== target.id)
							diag(
								'error',
								'unknown-field',
								`${key} names "${id}", which is not a field of "${target.name}"`,
								at(bodyLoc, key, j)
							);
					});
			body.fields?.forEach((f, i) => {
				const fieldLoc = at(bodyLoc, 'fields', i);
				if (f.model && model.elements.get(f.model)?.def.kind !== 'model')
					diag(
						'error',
						'dangling-ref',
						`field "${f.name}" holds "${f.model}", which is not a model`,
						fieldLoc,
						'model'
					);
				for (const key of ['to', 'from'] as const)
					f[key]?.forEach((id, j) => {
						if (!model.fields.has(id))
							diag(
								'error',
								'dangling-ref',
								`field "${f.name}" ${key === 'to' ? 'goes into' : 'comes from'} "${id}", which is not a model field`,
								at(fieldLoc, key, j)
							);
					});
				if (f.model) return;
				if (part === 'request' && !f.to?.length)
					diag(
						'warning',
						'untraced-field',
						`request field "${f.name}" goes into no model field; add to`,
						fieldLoc,
						'name'
					);
				if (part !== 'request' && !f.from?.length)
					diag(
						'warning',
						'untraced-field',
						`response field "${f.name}" comes from no field; add from`,
						fieldLoc,
						'name'
					);
			});
		}
		info.def.fields?.forEach((f, i) => {
			if (!f.ref) return;
			if (model.fields.has(f.ref)) return;
			const target = model.elements.get(f.ref);
			const refLoc = at(info.loc, 'fields', i);
			if (!target)
				diag(
					'error',
					'dangling-ref',
					`field "${f.name}" refers to unknown "${f.ref}"`,
					refLoc,
					'ref'
				);
			else if (target.def.kind !== 'model')
				diag(
					'error',
					'not-a-model',
					`field "${f.name}" refers to ${target.def.kind} "${target.name}", not a model or field`,
					refLoc,
					'ref'
				);
		});
		if (info.def.kind === 'logic-unit') info.logic = logicLinks(info);
		info.refIds = info.refIds.filter((ref, i) => {
			const target = model.elements.get(ref);
			const refLoc = at(info.loc, 'models', i);
			if (!target) diag('error', 'dangling-ref', `model "${ref}" is not an entity`, refLoc);
			else if (target.def.kind !== 'model')
				diag(
					'error',
					'not-a-model',
					`"${target.name}" is a ${target.def.kind}, not a model`,
					refLoc
				);
			else if (target.parentId === info.id)
				diag('warning', 'own-model-ref', `"${target.name}" is already owned here`, refLoc);
			else if (target.storedIn === info.id)
				diag('warning', 'own-model-ref', `"${target.name}" is already stored here`, refLoc);
			else return true;
			return false;
		});
		if (info.storedIn) {
			const store = model.elements.get(info.storedIn);
			if (!store)
				diag(
					'error',
					'dangling-ref',
					`storedIn "${info.storedIn}" is not an entity`,
					info.loc,
					'storedIn'
				);
			else if (store.def.kind !== 'system' && store.def.kind !== 'module')
				diag(
					'error',
					'parent-kind',
					`a model cannot be stored in a ${store.def.kind}; allowed: system, module`,
					info.loc,
					'storedIn'
				);
			// Stored where owned: drawn once, in the owner, as the table.
			else if (info.storedIn !== info.parentId) store.storedIds.push(info.id);
		}
		if (!info.parentId) continue;
		const field = info.def.kind === 'model' ? 'ownedBy' : 'parent';
		if (!model.elements.has(info.parentId)) {
			diag(
				'error',
				'dangling-ref',
				`${field} "${info.parentId}" is not an entity`,
				info.loc,
				field
			);
			info.parentId = undefined;
			continue;
		}
		const allowed = PARENT_KINDS[info.def.kind as EntityFileKind];
		const parentKind = model.elements.get(info.parentId)!.def.kind;
		if (allowed && !allowed.includes(parentKind as EntityFileKind))
			diag(
				'error',
				'parent-kind',
				`${info.def.kind} cannot have a ${parentKind} as ${field}; allowed: ${allowed.join(', ')}`,
				info.loc,
				field
			);
		const seen = new Set([info.id]);
		let cur: string | undefined = info.parentId;
		while (cur && !seen.has(cur)) {
			seen.add(cur);
			cur = model.elements.get(cur)?.parentId;
		}
		if (cur === info.id) {
			diag('error', 'parent-cycle', `parent chain of "${info.name}" loops`, info.loc, field);
			info.parentId = undefined;
		}
	}
	const folderOf = (file: string) => file.slice(0, file.lastIndexOf('/') + 1);
	const systemFolders = new Map<string, ElementInfo>();
	for (const info of entities) {
		if (info.parentId) model.elements.get(info.parentId)!.childIds.push(info.id);
		else model.rootElementIds.push(info.id);
		let top = info;
		while (top.parentId) {
			top = model.elements.get(top.parentId)!;
			info.depth++;
		}
		const folder = folderOf(top.loc.file);
		if (info === top && info.def.kind === 'system') {
			const other = systemFolders.get(folder);
			if (other)
				diag(
					'error',
					'shared-system-folder',
					`system "${info.name}" shares its folder with "${other.name}"; give each system its own folder`,
					info.loc
				);
			else systemFolders.set(folder, info);
		} else if (top.def.kind === 'system' && !info.loc.file.startsWith(folder)) {
			diag(
				'warning',
				'outside-system-folder',
				`"${info.name}" belongs to system "${top.name}" but is outside ${folder}`,
				info.loc
			);
		}
	}

	return model;
}

/** A logic unit's links: what invokes it, and the data its steps touch and what they call. */
export const LOGIC_KEYS = ['handles', 'reads', 'writes', 'calls'] as const;
export type LogicLinks = Record<(typeof LOGIC_KEYS)[number], string[]>;

/** The keys that say what kind a step is; a step with none of them is a note. */
export const STEP_KINDS = ['call', 'read', 'write', 'if', 'each', 'return', 'fail'] as const;

/** What `handles` and each step kind may name: entity kinds, or `field` for a model field. */
const LOGIC_TARGETS = {
	handles: ['api'],
	call: ['logic-unit', 'api'],
	read: ['model', 'field'],
	write: ['model', 'field']
};

/** Returns one cycle in a dependency graph (id -> needs), or undefined. */
export function findCycle(graph: Map<string, string[]>): string[] | undefined {
	const state = new Map<string, 'visiting' | 'done'>();
	const stack: string[] = [];
	const visit = (id: string): string[] | undefined => {
		if (state.get(id) === 'done') return;
		if (state.get(id) === 'visiting') return [...stack.slice(stack.indexOf(id)), id];
		state.set(id, 'visiting');
		stack.push(id);
		for (const next of graph.get(id) ?? []) {
			if (!graph.has(next)) continue;
			const c = visit(next);
			if (c) return c;
		}
		stack.pop();
		state.set(id, 'done');
	};
	for (const id of [...graph.keys()].sort()) {
		const c = visit(id);
		if (c) return c;
	}
	return undefined;
}

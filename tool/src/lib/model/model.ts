import type {
	ApiBody,
	ApiField,
	Element,
	EntityFile,
	EntityFileKind,
	LogicStep,
	ModelField
} from './schema';
import { DATA_EVENTS, ENTITY_KINDS, MESSAGE_EVENTS, PARENT_KINDS } from './schema';
import type { SourceEvent } from './schema';
import type { DataPath, Diagnostic, Severity } from './diagnostics';
import { entityKind, fileKind } from './parse';
import { toDiagnostic, validateEntityFile } from './validate-file';
import { isDuration, scheduleProblems } from './schedule';
import { messageProblems } from './message';

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
	/** Models only: the module storing it. */
	storedIn?: string;
	/** Models stored here (their `storedIn`), drawn inside as tables. */
	storedIds: string[];
	tags?: string[];
	/** Logic units only: what starts it, and what its steps read, write, call and send. */
	logic?: LogicLinks;
	/**
	 * Triggers only: what it listens to, when that is known: a channel's port (see `Port`), or a
	 * stored model, or the fields of one whose change raises it.
	 */
	listens?: string[];
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

/**
 * One event of a channel that triggers can listen to, drawn as a row of the channel's card:
 * `<channel>:<event>` on a queue, `<channel>:<subscription>:<event>` on a topic.
 */
export interface Port {
	id: string;
	channel: string;
	event: SourceEvent;
	subscription?: string;
	/** The triggers listening to it. */
	triggers: string[];
}

export interface Model {
	elements: Map<string, ElementInfo>;
	/** Every channel's ports, by id, each channel's in order. */
	ports: Map<string, Port>;
	fields: Map<string, FieldInfo>;
	/** Fields of body shapes written on apis. */
	apiFields: Map<string, ApiFieldInfo>;
	rootElementIds: string[];
	/** Global id namespace. */
	ids: Map<string, { kind: GlobalKind; loc: Loc }>;
	/** Every design file, sorted. */
	files: string[];
	diagnostics: Diagnostic[];
	/**
	 * Set when built for one flag state: whether each flag is on. Links then follow only the
	 * branch each flag step takes; without it they follow every branch (all the code).
	 */
	flagState?: Map<string, boolean>;
}

/** Whether a flag is on in the model's state, else at its default. */
export const flagOn = (model: Model, id: string) =>
	model.flagState?.get(id) ?? model.elements.get(id)?.def.default === 'on';

/** Each flag's value in a state: `overrides` by flag id, else its default. */
export function flagStateOf(model: Model, overrides: Record<string, boolean>) {
	const out = new Map<string, boolean>();
	for (const [id, el] of model.elements)
		if (el.def.kind === 'flag') out.set(id, overrides[id] ?? el.def.default === 'on');
	return out;
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
export function buildModel(
	files: Record<string, unknown>,
	locate?: Locator,
	flags?: Record<string, boolean>
): Model {
	const model: Model = {
		elements: new Map(),
		ports: new Map(),
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
		const links: LogicLinks = { handles: [], reads: [], writes: [], calls: [], sends: [] };
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
						`empty step; give call, send, read, write, if, each, flag, return, fail or note`,
						stepLoc
					);
				for (const [sub, owner] of [
					['then', 'if'],
					['else', 'if'],
					['do', 'each'],
					['on', 'flag'],
					['off', 'flag']
				] as const)
					if (s[sub] && k !== owner)
						diag('error', 'logic-step', `${sub} goes with ${owner}`, stepLoc, sub);
				if (s.with !== undefined && k !== 'call' && k !== 'read' && k !== 'send')
					diag('error', 'logic-step', `with goes with call, send or read`, stepLoc, 'with');
				if (s.gets !== undefined && k !== 'call' && k !== 'read')
					diag(
						'error',
						'logic-step',
						k === 'send'
							? `a send gets nothing back: a message has no reply`
							: `gets goes with call or read`,
						stepLoc,
						'gets'
					);
				if (s.does !== undefined && k !== 'write')
					diag('error', 'logic-step', `does goes with write`, stepLoc, 'does');
				if (k === 'call' || k === 'read' || k === 'write' || k === 'send')
					if (logicTarget(k, s[k]!, stepLoc, k)) {
						add(`${k}s` as keyof LogicLinks, s[k]!);
						// Calling an old message trigger sends its message; a schedule has no sender,
						// and a trigger on a channel is reached by sending on the channel.
						const t = model.elements.get(s[k]!);
						if (k === 'call' && t?.def.kind === 'trigger') {
							if (t.def.on)
								diag(
									'error',
									'step-send',
									t.def.on.channel
										? `call names trigger "${t.name}": send on its channel instead`
										: `call names trigger "${t.name}": write its model instead`,
									stepLoc,
									k
								);
							else if (!t.def.message)
								diag(
									'error',
									'trigger-call',
									`call names trigger "${t.name}": a schedule can't be called`,
									stepLoc,
									k
								);
							else if (s.gets !== undefined)
								diag(
									'error',
									'trigger-call',
									`sending "${t.name}" gets nothing back: a message has no reply`,
									stepLoc,
									'gets'
								);
						}
					}
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
				if (k === 'flag' && logicTarget('flag', s.flag!, stepLoc, k)) {
					if (!within(s.flag!, info.id))
						diag(
							'error',
							'flag-scope',
							`flag "${model.elements.get(s.flag!)!.name}" is defined outside this unit's module`,
							stepLoc,
							k
						);
					usedFlags.add(s.flag!);
				}
				if (k === 'flag' && !s.on && !s.off)
					diag('error', 'logic-step', `a flag step needs on, off or both`, stepLoc, k);
				walk(s.then, stepLoc, 'then');
				walk(s.else, stepLoc, 'else');
				walk(s.do, stepLoc, 'do');
				if (k === 'flag') {
					const state = model.flagState?.get(s.flag!);
					if (state !== false) walk(s.on, stepLoc, 'on');
					if (state !== true) walk(s.off, stepLoc, 'off');
				}
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

	/** Whether flag `flagId` is defined in `id`'s system or module, or one round it. */
	const within = (flagId: string, id: string) => {
		const home = model.elements.get(flagId)?.parentId;
		const seen = new Set<string>();
		for (let cur = model.elements.get(id)?.parentId; cur && !seen.has(cur);) {
			if (cur === home) return true;
			seen.add(cur);
			cur = model.elements.get(cur)?.parentId;
		}
		return false;
	};
	const usedFlags = new Set<string>();

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
	/** Modules declared without a parent: the systems. One whose parent is broken is not. */
	const systems = new Set<string>();
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
		if (kind === 'module' && !parent) systems.add(info.id);
		if (kind === 'model' && parent)
			diag('error', 'model-parent', `model "${info.name}" uses ownedBy, not parent`, loc, 'parent');
		if (kind !== 'model' && ownedBy)
			diag('error', 'owned-by', `only models have ownedBy`, loc, 'ownedBy');
		if (value.external && kind !== 'module' && kind !== 'api' && kind !== 'channel')
			diag('error', 'external', `only modules, apis and channels are external`, loc, 'external');
		if (value.store && kind !== 'module')
			diag('error', 'module-store', `only modules have store`, loc, 'store');
		if (kind !== 'model' && storedIn)
			diag('error', 'model-only', `only models have storedIn`, loc, 'storedIn');
		if (kind === 'model' && !ownedBy)
			diag('error', 'missing-owner', `model "${info.name}" needs ownedBy`, loc, 'id');
		if (kind !== 'module' && kind !== 'model' && !parent)
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
		if (kind === 'flag') {
			if (!value.key) diag('error', 'flag-key', `flag "${info.name}" needs key`, loc, 'id');
		} else
			for (const key of ['key', 'default'] as const)
				if (value[key]) diag('error', 'flag-only', `only flags have ${key}`, loc, key);
		if (
			value.when &&
			kind !== 'api' &&
			kind !== 'logic-unit' &&
			kind !== 'trigger' &&
			kind !== 'channel'
		)
			diag(
				'error',
				'flag-gate',
				`only apis, logic units, triggers and channels have when`,
				loc,
				'when'
			);
		if (kind === 'trigger') {
			// The source says what starts it: a schedule, or an event it listens to (or, before
			// channels, a message in words); exactly one.
			const sources = (['schedule', 'on', 'message'] as const).filter((k) => value[k]);
			if (sources.length !== 1)
				diag(
					'error',
					'trigger-source',
					sources.length
						? `trigger "${info.name}" has ${sources.join(' and ')}; give one`
						: `trigger "${info.name}" needs a schedule or on`,
					loc,
					sources[1] ?? 'id'
				);
			if (value.schedule)
				for (const p of scheduleProblems(value.schedule))
					diag('error', 'trigger-schedule', p.message, at(loc, 'schedule'), p.key);
			if (value.message) {
				diag(
					'warning',
					'trigger-message-legacy',
					`message names its queue or topic in words; run sdv migrate triggers to make it a channel and on`,
					loc,
					'message'
				);
				for (const p of messageProblems(value.message))
					diag('error', 'trigger-message', p.message, at(loc, 'message'), p.key);
			}
			if (!value.schedule && value.overlap !== undefined)
				diag(
					'error',
					'trigger-overlap',
					`overlap goes with schedule, not ${value.on ? 'on' : 'message'}`,
					loc,
					'overlap'
				);
			if (value.timeout !== undefined && !isDuration(value.timeout))
				diag(
					'error',
					'trigger-timeout',
					`timeout "${value.timeout}" is not a duration such as 10m`,
					loc,
					'timeout'
				);
		} else
			for (const key of ['schedule', 'on', 'message', 'overlap', 'timeout', 'with'] as const)
				if (value[key] !== undefined)
					diag('error', 'trigger-only', `only triggers have ${key}`, loc, key);
		if (value.retries !== undefined && kind !== 'trigger' && kind !== 'channel')
			diag('error', 'trigger-only', `only triggers and channels have retries`, loc, 'retries');
		if (kind === 'channel') {
			if (!value.type)
				diag(
					'error',
					'channel-kind',
					`channel "${info.name}" needs type: queue or topic`,
					loc,
					'id'
				);
		} else
			for (const key of ['type', 'carries', 'via'] as const)
				if (value[key] !== undefined)
					diag('error', 'channel-only', `only channels have ${key}`, loc, key);
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
	if (flags) model.flagState = flagStateOf(model, flags);
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
				// A response field with `derived` and no `from` is computed where the api answers (a literal,
				// a flag, a count): nothing to trace, as for a model field.
				if (part !== 'request' && !f.from?.length && !f.derived)
					diag(
						'warning',
						'untraced-field',
						`response field "${f.name}" comes from no field; add from, or derived when it is computed here`,
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
		const gate = info.def.when;
		if (gate) {
			const flag = model.elements.get(gate.flag);
			const gateLoc = at(info.loc, 'when');
			if (flag?.def.kind !== 'flag')
				diag(
					'error',
					'flag-gate',
					`when names "${gate.flag}", which is not a flag`,
					gateLoc,
					'flag'
				);
			else {
				usedFlags.add(flag.id);
				if (!within(flag.id, info.id))
					diag(
						'error',
						'flag-scope',
						`flag "${flag.name}" is defined outside this ${info.def.kind}'s module`,
						gateLoc,
						'flag'
					);
			}
		}
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
			else if (store.def.kind !== 'module')
				diag(
					'error',
					'parent-kind',
					`a model cannot be stored in a ${store.def.kind}; allowed: module`,
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
	// A trigger starts the units handling it; one nothing handles starts nothing.
	const handled = new Set(entities.flatMap((info) => info.logic?.handles ?? []));
	for (const info of entities) {
		if (info.def.kind === 'trigger' && !handled.has(info.id))
			diag(
				'warning',
				'trigger-unused',
				`trigger "${info.name}" starts nothing: no logic unit handles it`,
				info.loc,
				'id'
			);
		const required = (info.def.inputs ?? []).filter((f) => f.required).map((f) => f.name);
		for (const h of required.length ? (info.logic?.handles ?? []) : []) {
			const t = model.elements.get(h)!;
			if (t.def.kind === 'trigger' && t.def.with === undefined)
				diag(
					'warning',
					'trigger-inputs',
					`"${info.name}" needs ${required.join(', ')}, but trigger "${t.name}" passes nothing; give it with`,
					info.loc,
					'handles'
				);
		}
	}
	// What each trigger listens to, then every channel's ports (see `Port`).
	const heard = new Map<string, { trigger: string; event: SourceEvent; subscription?: string }[]>();
	for (const info of entities) {
		const on = info.def.kind === 'trigger' ? info.def.on : undefined;
		if (!on) continue;
		const onLoc = at(info.loc, 'on');
		const bad = (code: string, message: string, key?: string) =>
			diag('error', code, message, onLoc, key);
		if (!on.channel === !on.model) {
			bad(
				'trigger-on',
				`on needs exactly one of channel and model`,
				on.channel ? 'model' : 'event'
			);
			continue;
		}
		const id = (on.channel ?? on.model)!;
		const key = on.channel ? 'channel' : 'model';
		const src = model.elements.get(id);
		if (!src) {
			bad('dangling-ref', `on.${key} names "${id}", which is not an entity`, key);
			continue;
		}
		if (src.def.kind !== key) {
			bad('trigger-on', `on.${key} names ${src.def.kind} "${src.name}", not a ${key}`, key);
			continue;
		}
		if (on.channel) {
			if (!(MESSAGE_EVENTS as readonly string[]).includes(on.event)) {
				bad(
					'trigger-event',
					`a channel raises ${MESSAGE_EVENTS.join(' or ')}, not ${on.event}`,
					'event'
				);
				continue;
			}
			if (on.subscription !== undefined && src.def.type !== 'topic')
				bad(
					'trigger-on',
					`subscription goes with a topic; "${src.name}" is a queue`,
					'subscription'
				);
			if (on.fields) bad('trigger-on', `fields go with a table, not a channel`, 'fields');
			if (on.path !== undefined) bad('trigger-on', `path goes with a file, not a channel`, 'path');
			const subscription = src.def.type === 'topic' ? (on.subscription ?? info.name) : undefined;
			heard.set(id, [
				...(heard.get(id) ?? []),
				{ trigger: info.id, event: on.event as SourceEvent, subscription }
			]);
			continue;
		}
		if (!(DATA_EVENTS as readonly string[]).includes(on.event)) {
			bad(
				'trigger-event',
				`a stored model raises ${DATA_EVENTS.join(', ')}, not ${on.event}`,
				'event'
			);
			continue;
		}
		const store = model.elements.get(src.storedIn ?? '');
		if (!store) {
			bad(
				'trigger-on',
				`"${src.name}" is not stored (no storedIn): only a table or a file raises events`,
				'model'
			);
			continue;
		}
		const files = store.def.store === 'files';
		if (on.subscription !== undefined)
			bad('trigger-on', `subscription goes with a topic, not a model`, 'subscription');
		if (on.path !== undefined && !files)
			bad('trigger-on', `path goes with a file; "${src.name}" is a table`, 'path');
		let fields: string[] = [];
		if (on.fields) {
			if (files) bad('trigger-on', `fields go with a table; "${src.name}" is a file`, 'fields');
			else if (on.event !== 'updated')
				bad('trigger-on', `fields go with updated, not ${on.event}`, 'fields');
			else
				fields = on.fields.filter((f, j) => {
					if (model.fields.get(f)?.modelId === src.id) return true;
					diag(
						'error',
						'unknown-field',
						`on.fields names "${f}", which is not a field of "${src.name}"`,
						at(onLoc, 'fields', j)
					);
					return false;
				});
		}
		info.listens = fields.length ? fields : [src.id];
	}
	for (const info of entities) {
		if (info.def.kind !== 'channel') continue;
		const def = info.def;
		const carried = def.carries ? model.elements.get(def.carries) : undefined;
		if (def.carries && carried?.def.kind !== 'model')
			diag(
				'error',
				carried ? 'not-a-model' : 'dangling-ref',
				`carries names "${def.carries}", which is not a model`,
				info.loc,
				'carries'
			);
		const listeners = heard.get(info.id) ?? [];
		const port = (event: SourceEvent, subscription?: string) => {
			const id = [info.id, subscription, event].filter((x) => x !== undefined).join(':');
			const p: Port = {
				id,
				channel: info.id,
				event,
				...(subscription !== undefined ? { subscription } : {}),
				triggers: listeners
					.filter((l) => l.event === event && l.subscription === subscription)
					.map((l) => l.trigger)
			};
			model.ports.set(id, p);
			for (const t of p.triggers) model.elements.get(t)!.listens = [id];
		};
		// A queue shows both its events; a topic each subscription's received, and its
		// dead-lettered only while something listens to it.
		const subs = [
			...new Set(listeners.map((l) => l.subscription).filter((s) => s !== undefined))
		].sort();
		if (def.type !== 'topic' || !subs.length) {
			port('received');
			if (def.type !== 'topic') port('dead-lettered');
		}
		for (const s of subs) {
			port('received', s);
			if (listeners.some((l) => l.subscription === s && l.event === 'dead-lettered'))
				port('dead-lettered', s);
		}
		const sent = entities.some((u) => u.logic?.sends.includes(info.id));
		if (!sent && !def.external)
			diag(
				'warning',
				'channel-unsent',
				`nothing in the design sends on channel "${info.name}"; give a unit a send step, or mark it external`,
				info.loc,
				'id'
			);
		if (!listeners.length)
			diag(
				'warning',
				'channel-unheard',
				`nothing listens to channel "${info.name}": no trigger is on it`,
				info.loc,
				'id'
			);
	}
	const defaultsByKey = new Map<string, ElementInfo[]>();
	for (const info of entities) {
		if (info.def.kind !== 'flag') continue;
		if (!usedFlags.has(info.id))
			diag(
				'warning',
				'flag-unused',
				`flag "${info.name}" is never checked: no flag step or when names it`,
				info.loc,
				'id'
			);
		const key = info.def.key ?? '';
		defaultsByKey.set(key, [...(defaultsByKey.get(key) ?? []), info]);
	}
	for (const [key, defs] of defaultsByKey) {
		const on = defs.filter((d) => d.def.default === 'on');
		if (on.length && on.length < defs.length)
			for (const d of defs)
				diag(
					'warning',
					'flag-defaults',
					`flag key "${key}" is on by default in ${on.map((x) => x.loc.file).join(', ')} but off elsewhere: production is split`,
					d.loc,
					'default'
				);
	}
	const folderOf = (file: string) => file.slice(0, file.lastIndexOf('/') + 1);
	const systemFolders = new Map<string, ElementInfo>();
	for (const info of entities) {
		// Flags are never drawn as boxes: the Flags menu lists them.
		if (info.def.kind !== 'flag') {
			if (info.parentId) model.elements.get(info.parentId)!.childIds.push(info.id);
			else model.rootElementIds.push(info.id);
		}
		let top = info;
		while (top.parentId) {
			top = model.elements.get(top.parentId)!;
			info.depth++;
		}
		const folder = folderOf(top.loc.file);
		const system = systems.has(top.id);
		if (info === top && system) {
			const other = systemFolders.get(folder);
			if (other)
				diag(
					'error',
					'shared-system-folder',
					`system "${info.name}" shares its folder with "${other.name}"; give each system its own folder`,
					info.loc
				);
			else systemFolders.set(folder, info);
		} else if (system && !info.loc.file.startsWith(folder)) {
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

/**
 * A logic unit's links: what invokes it, the data its steps touch, what they call and the
 * channels they send on.
 */
export const LOGIC_KEYS = ['handles', 'reads', 'writes', 'calls', 'sends'] as const;
export type LogicLinks = Record<(typeof LOGIC_KEYS)[number], string[]>;

/** The keys that say what kind a step is; a step with none of them is a note. */
export const STEP_KINDS = [
	'call',
	'send',
	'read',
	'write',
	'if',
	'each',
	'return',
	'fail',
	'flag'
] as const;

/** What `handles` and each step kind may name: entity kinds, or `field` for a model field. */
const LOGIC_TARGETS = {
	handles: ['api', 'trigger'],
	call: ['logic-unit', 'api', 'trigger'],
	send: ['channel'],
	read: ['model', 'field'],
	write: ['model', 'field'],
	flag: ['flag']
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

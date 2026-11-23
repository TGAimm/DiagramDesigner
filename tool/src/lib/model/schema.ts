import { z } from 'zod';

/**
 * Zod schema for entity files. It is the single source for the TypeScript types, validation
 * messages and the generated JSON Schema. Objects are strict so misspelled keys are reported.
 */

export const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export const Id = z
	.string()
	.regex(ID_PATTERN, { message: 'must be kebab-case, matching ^[a-z][a-z0-9-]*$' })
	.describe('Kebab-case identifier');

export const DocLink = z
	.strictObject({ label: z.string(), url: z.string() })
	.describe('Documentation link');

/** Display text; YAML scalars like `402` or `1.5` are accepted and read as strings. */
export const Text = z.preprocess((v) => (typeof v === 'number' ? String(v) : v), z.string());

const Meta = z.record(z.string(), z.string()).describe('Free-form string metadata');

/** A resolved entity: its file data plus the kind taken from the file name. */
export interface Element {
	id: string;
	kind: EntityFileKind;
	name?: string;
	tags?: string[];
	links?: { label: string; url: string }[];
	meta?: Record<string, string>;
	external?: boolean;
	fields?: ModelField[];
	indexes?: ModelIndex[];
	method?: HttpMethod;
	path?: string;
	auth?: string;
	params?: ApiParam[];
	request?: ApiBody;
	responses?: ApiResponse[];
	handles?: string[];
	inputs?: LogicField[];
	outputs?: LogicField[];
	fails?: LogicFail[];
	steps?: LogicStep[];
	key?: string;
	default?: FlagValue;
	family?: string;
	when?: FlagGate;
	schedule?: Schedule;
	message?: Message;
	on?: TriggerOn;
	type?: ChannelType;
	carries?: string;
	via?: string;
	store?: Store;
	overlap?: Overlap;
	timeout?: string;
	retries?: number;
	with?: string;
}

/** Kinds an entity file can have; the file name `<name>.<kind>.yaml` gives it. */
export const ENTITY_KINDS = [
	'module',
	'model',
	'logic-unit',
	'api',
	'flag',
	'trigger',
	'channel'
] as const;
export type EntityFileKind = (typeof ENTITY_KINDS)[number];

/** Kinds a parent must have, for kinds that may only sit under certain parents. */
export const PARENT_KINDS: Partial<Record<EntityFileKind, EntityFileKind[]>> = {
	'logic-unit': ['module'],
	api: ['module'],
	model: ['module'],
	flag: ['module'],
	trigger: ['module'],
	channel: ['module']
};

/**
 * When a trigger runs: exactly one of a 5-field cron, an interval or a one-off local time. It is
 * one of a trigger's two sources; `message` is the other.
 */
export const Schedule = z
	.strictObject({
		cron: z.string().optional().describe('5-field cron: minute hour day month weekday'),
		every: Text.optional().describe('An interval: a number and s, m, h or d, e.g. 15m'),
		at: z.string().optional().describe('Once, at a local time such as 2026-12-01T00:00'),
		tz: z.string().optional().describe('IANA time zone of cron and at; default UTC')
	})
	.describe('Triggers only: when it runs; exactly one of cron, every and at');
export type Schedule = z.infer<typeof Schedule>;

/**
 * The old message source, before channels: a queue, or a topic through a subscription, named
 * in words. Still read, with a warning; `sdv migrate triggers` turns it into a channel and `on`.
 */
export const Message = z
	.strictObject({
		queue: Text.optional().describe('The queue it receives from'),
		topic: Text.optional().describe('The topic it receives from'),
		subscription: Text.optional().describe('With topic: the subscription it receives through'),
		via: Text.optional().describe('Free text: the broker or component, e.g. a Dapr pub/sub')
	})
	.describe('Triggers only: the messages it receives; exactly one of queue and topic');
export type Message = z.infer<typeof Message>;

/** Events a channel raises: a message arrived, or was given up on after its retries. */
export const MESSAGE_EVENTS = ['received', 'dead-lettered'] as const;
/** Events a stored model raises, a row or a file alike. */
export const DATA_EVENTS = ['created', 'updated', 'deleted'] as const;
export type MessageEvent = (typeof MESSAGE_EVENTS)[number];
export type DataEvent = (typeof DATA_EVENTS)[number];
export type SourceEvent = MessageEvent | DataEvent;

/**
 * What a trigger listens to: one event of one source, a channel or a stored model. The events
 * each source raises are fixed (MESSAGE_EVENTS, DATA_EVENTS).
 */
export const TriggerOn = z
	.strictObject({
		channel: Id.optional().describe('Id of the channel it listens to'),
		model: Id.optional().describe('Id of the stored model it listens to (a table or a file)'),
		event: z
			.enum([...MESSAGE_EVENTS, ...DATA_EVENTS])
			.describe(
				'A channel: received or dead-lettered; a stored model: created, updated or deleted'
			),
		subscription: Text.optional().describe(
			'Topics only: the subscription it receives through; default the trigger name'
		),
		fields: z
			.array(Id)
			.optional()
			.describe('Tables only, with updated: ids of the fields whose change raises it'),
		path: Text.optional().describe('Files only: a glob of the paths it watches'),
		filter: Text.optional().describe('Free text: which events it takes, e.g. entity type Item')
	})
	.describe('Triggers only: the event it listens to; exactly one of channel and model');
export type TriggerOn = z.infer<typeof TriggerOn>;

/** A queue gives each message to one receiver; a topic gives a copy to each subscription. */
export const ChannelType = z.enum(['queue', 'topic']);
export type ChannelType = z.infer<typeof ChannelType>;

/** What a module keeps the models stored in it as: rows of tables (default) or files. */
export const Store = z.enum(['rows', 'files']);
export type Store = z.infer<typeof Store>;

/** What a write does, so which events it raises on its model. */
export const WriteOp = z.enum(['create', 'update', 'delete']);
export type WriteOp = z.infer<typeof WriteOp>;

export const Overlap = z.enum(['skip', 'queue', 'allow']);
export type Overlap = z.infer<typeof Overlap>;

export const FlagValue = z.enum(['on', 'off']);
export type FlagValue = z.infer<typeof FlagValue>;

/** An api, logic unit, trigger or channel that exists only while a flag has one value. */
export const FlagGate = z
	.strictObject({
		flag: Id.describe('Id of the flag'),
		is: FlagValue.describe('The value the flag must have for this to exist')
	})
	.describe(
		'Apis, logic units, triggers and channels only: exists only while the flag has this value'
	);
export type FlagGate = z.infer<typeof FlagGate>;

/**
 * `required` and `nullable` are independent: a required field must be given on create but
 * may still be null when nullable; an optional field may be left out but, unless nullable,
 * never holds null (a default fills it).
 *
 * A field has either a primitive `type` or a `model` it holds (composition); `ref` holds a
 * key instead (foreign key), so it goes with `type`. `from` and `derived` record lineage:
 * which fields elsewhere this field's value comes from, for change impact.
 *
 * A model is drawn as a class where it is owned and as a stored table where it is stored
 * (`storedIn`). Held models and `stored: false` fields exist only in the class; a ref to the
 * model that holds this one exists only in the table.
 */
export const ModelField = z
	.strictObject({
		id: Id.describe('Unique across the whole model, like entity ids; generate with `sdv id`'),
		name: z.string(),
		type: z.string().optional().describe('Primitive type; give either type or model'),
		model: Id.optional().describe('Id of a model this field holds (composition)'),
		many: z.boolean().optional().describe('Holds a list of type or model'),
		pk: z.boolean().optional().describe('Part of the primary key'),
		pi: z.boolean().optional().describe('Part of the primary index'),
		required: z.boolean().optional().describe('Must be given a value on create; default false'),
		nullable: z.boolean().optional().describe('May hold null; default false'),
		constraints: z
			.array(Text)
			.optional()
			.describe('Free-text rules such as unique, positive, max 200'),
		ref: Id.optional().describe('Id of the model or field this field points at (foreign key)'),
		from: z
			.array(Id)
			.optional()
			.describe('Ids of the fields this value comes from; omit for a source field'),
		derived: Text.optional().describe('How the value is computed or changed from its from fields'),
		stored: z
			.boolean()
			.optional()
			.describe('false: exists in the class only, never stored (e.g. computed); default true')
	})
	.describe('Model field: a table column or an object property');
export type ModelField = z.infer<typeof ModelField>;

export const ModelIndex = z
	.strictObject({
		id: Id.optional().describe('Lets a scenario change or drop the index; generate with `sdv id`'),
		name: z.string(),
		fields: z.array(Id).min(1).describe('Field ids, in index order'),
		unique: z.boolean().optional()
	})
	.describe('Secondary index over model fields');
export type ModelIndex = z.infer<typeof ModelIndex>;

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const ApiParam = z
	.strictObject({
		id: Id.optional().describe('Lets a scenario change or drop the param; generate with `sdv id`'),
		name: z.string(),
		in: z.enum(['path', 'query', 'header']),
		type: z.string(),
		required: z.boolean().optional().describe('Path params are always required'),
		description: Text.optional()
	})
	.describe('Endpoint parameter, outside the body');
export type ApiParam = z.infer<typeof ApiParam>;

/**
 * A field of a body shape written on the api itself. Request fields say which model fields
 * their value goes into (`to`); response fields which fields it comes from (`from`), so a
 * change on either side can be traced.
 */
export const ApiField = z
	.strictObject({
		id: Id.describe('Unique across the whole design, like model field ids'),
		name: z.string(),
		type: z.string().optional().describe('Primitive type; give either type or model'),
		model: Id.optional().describe('Id of a model this field holds'),
		many: z.boolean().optional().describe('Holds a list of type or model'),
		required: z.boolean().optional(),
		nullable: z.boolean().optional(),
		description: Text.optional(),
		to: z
			.array(Id)
			.optional()
			.describe('Request fields: ids of the model fields its value goes into'),
		from: z
			.array(Id)
			.optional()
			.describe('Response fields: ids of the fields its value comes from'),
		derived: Text.optional().describe('How the value is changed on the way')
	})
	.describe('Field of a body shape written on the api');
export type ApiField = z.infer<typeof ApiField>;

/** A body is a model as is, a model trimmed with omit or pick, or a shape of its own. */
const bodyKeys = {
	model: Id.optional().describe('Id of the model sent or returned'),
	omit: z.array(Id).optional().describe('With model: ids of its fields left out'),
	pick: z.array(Id).optional().describe('With model: ids of the only fields sent'),
	fields: z.array(ApiField).optional().describe('A shape of its own, instead of a model'),
	many: z.boolean().optional().describe('A list of the model or shape'),
	contentType: z.string().optional().describe('Default application/json')
};

export const ApiBody = z.strictObject(bodyKeys).describe('Request body');
export type ApiBody = z.infer<typeof ApiBody>;

export const ApiResponse = z
	.strictObject({
		status: z.number().int().min(100).max(599),
		...bodyKeys,
		description: Text.optional()
	})
	.describe('One possible response; no model or fields: no body');
export type ApiResponse = z.infer<typeof ApiResponse>;

/** An input or output of a logic unit: the keys of an api's own-shape field, without lineage. */
export const LogicField = z
	.strictObject({
		id: Id.describe('Unique across the whole design, like model field ids'),
		name: z.string(),
		type: z.string().optional().describe('Primitive type; give either type or model'),
		model: Id.optional().describe('Id of a model it is'),
		many: z.boolean().optional().describe('A list of type or model'),
		required: z.boolean().optional(),
		nullable: z.boolean().optional(),
		description: Text.optional()
	})
	.describe('Input or output of a logic unit');
export type LogicField = z.infer<typeof LogicField>;

export const LogicFail = z
	.strictObject({ name: z.string(), description: Text.optional() })
	.describe('A way a logic unit can fail');
export type LogicFail = z.infer<typeof LogicFail>;

/**
 * One step of a logic unit's sequence. Each step is one of call, send, read, write, if, each,
 * flag, return or fail; a step with only a note is work the unit does itself.
 */
export interface LogicStep {
	call?: string;
	send?: string;
	read?: string;
	write?: string;
	does?: WriteOp | WriteOp[];
	with?: string;
	gets?: string;
	if?: string;
	then?: LogicStep[];
	else?: LogicStep[];
	each?: string;
	do?: LogicStep[];
	return?: string;
	fail?: string;
	flag?: string;
	on?: LogicStep[];
	off?: LogicStep[];
	note?: string;
}
export const LogicStep: z.ZodType<LogicStep> = z
	.strictObject({
		call: Id.optional().describe('Id of the logic unit or api it calls'),
		send: Id.optional().describe('Id of the channel it sends a message on, without waiting'),
		read: Id.optional().describe('Id of the model, or single model field, it reads'),
		write: Id.optional().describe('Id of the model, or single model field, it writes'),
		does: z
			.union([WriteOp, z.array(WriteOp).min(1)])
			.optional()
			.describe('With write: what it does (create, update, delete), so which events it raises'),
		with: Text.optional().describe('With call, send or read: what it passes, free text'),
		gets: Text.optional().describe('With call or read: what it gets back, free text'),
		if: Text.optional().describe('A condition; then and else hold the steps of each branch'),
		get then() {
			return z.array(LogicStep).optional();
		},
		get else() {
			return z.array(LogicStep).optional();
		},
		each: Text.optional().describe('What it loops over; do holds the steps repeated'),
		get do() {
			return z.array(LogicStep).optional();
		},
		return: Text.optional().describe('Name of the output returned'),
		fail: Text.optional().describe('Name of the fail raised'),
		flag: Id.optional().describe('Id of a flag; on and off hold the steps run in each state'),
		get on() {
			return z.array(LogicStep).optional();
		},
		get off() {
			return z.array(LogicStep).optional();
		},
		note: Text.optional().describe('Free text; alone, work the unit does itself')
	})
	.describe('One step of a logic unit, in order');

/**
 * One entity per file, named `<name>.<kind>.yaml`. The id is generated once and never
 * edited, so renaming or moving the file changes nothing. A module with no parent is a
 * root, drawn as a system, and sits in its own folder; models name their single owner with `ownedBy` instead of a parent,
 * since they are used in many places; every other entity names its parent by id.
 */
export const EntityFile = z
	.strictObject({
		id: Id.describe('Generated with `sdv new`; never edited'),
		parent: Id.optional().describe(
			'Id of the parent entity; omitted for root modules (systems) and models'
		),
		ownedBy: Id.optional().describe('Models only: id of the one module owning it'),
		storedIn: Id.optional().describe(
			'Models only: id of the module storing its data (e.g. a database module)'
		),
		models: z
			.array(Id)
			.optional()
			.describe('Ids of models used here but owned elsewhere; drawn inside as references'),
		fields: z.array(ModelField).optional().describe('Models only'),
		indexes: z.array(ModelIndex).optional().describe('Models only'),
		method: z.enum(HTTP_METHODS).optional().describe('Apis only: HTTP method; required'),
		path: z.string().optional().describe('Apis only: route, e.g. /orders/{id}; required'),
		auth: z.string().optional().describe('Apis only: how callers authenticate, e.g. bearer'),
		params: z.array(ApiParam).optional().describe('Apis only: path, query and header params'),
		request: ApiBody.optional().describe('Apis only: what it takes in the body'),
		responses: z.array(ApiResponse).optional().describe('Apis only: what it returns, by status'),
		handles: z
			.array(Id)
			.optional()
			.describe('Logic units only: ids of the apis and triggers that start it'),
		inputs: z
			.array(LogicField)
			.optional()
			.describe('Logic units only, required: what it takes; [] for nothing'),
		outputs: z
			.array(LogicField)
			.optional()
			.describe('Logic units only, required: what it returns; [] for nothing'),
		fails: z.array(LogicFail).optional().describe('Logic units only: the ways it can fail'),
		steps: z
			.array(LogicStep)
			.optional()
			.describe('Logic units only: its sequence; what it reads, writes and calls comes from it'),
		key: z
			.string()
			.optional()
			.describe('Flags only, required: the name the code asks the flag service for'),
		default: FlagValue.optional().describe('Flags only: the value production runs; default off'),
		family: Text.optional().describe(
			'Flags only: the name of a family of keys that are one flag per something, e.g. UseNewBilling.<country>; the Flags menu groups them under it'
		),
		when: FlagGate.optional(),
		schedule: Schedule.optional(),
		on: TriggerOn.optional(),
		message: Message.optional().describe(
			'Triggers only, replaced by on: a queue or topic in words; see sdv migrate triggers'
		),
		overlap: Overlap.optional().describe(
			'Schedule triggers only: a run due while the last is going is skipped (default), queued or allowed'
		),
		timeout: z.string().optional().describe('Triggers only: how long a run may take, e.g. 10m'),
		retries: z
			.number()
			.int()
			.min(0)
			.optional()
			.describe(
				'Triggers and channels: retries of a failed run or delivery; a channel sets the default for its triggers'
			),
		type: ChannelType.optional().describe('Channels only, required: queue or topic'),
		carries: Id.optional().describe('Channels only: id of the model its messages are'),
		via: Text.optional().describe(
			'Channels only: free text, the broker or component it runs on (e.g. a Dapr pub/sub)'
		),
		store: Store.optional().describe(
			'Modules only: what models stored here are kept as, rows (default) or files'
		),
		with: Text.optional().describe('Triggers only: what a run passes the unit, free text'),
		external: z
			.boolean()
			.optional()
			.describe(
				'Modules, apis and channels: used by consumers or senders the design does not show, so every rename or drop behind it breaks'
			),
		name: Text.optional().describe('Display name; defaults to the file name'),
		tags: z.array(z.string()).optional(),
		links: z.array(DocLink).optional(),
		meta: Meta.optional()
	})
	.describe('System Design Viewer entity file (<name>.<kind>.yaml)');
export type EntityFile = z.infer<typeof EntityFile>;

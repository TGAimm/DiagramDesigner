/**
 * The glyphs drawn before names (EntityGlyph and the canvas: Lucide's app-window, box,
 * braces, table, square-function, plug, zap, clock, mail, and channels', files' and events'
 * marks), as SVG path data on a 24-unit
 * grid, stroked 2.2 units wide with round ends and joins, as EntityGlyph styles them.
 */
export const GLYPHS: Record<string, string[]> = {
	system: [
		'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
		'M10 4v4',
		'M2 8h20',
		'M6 4v4'
	],
	module: [
		'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
		'm3.3 7 8.7 5 8.7-5',
		'M12 22V12'
	],
	class: [
		'M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1',
		'M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1'
	],
	table: [
		'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18'
	],
	logic: [
		'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
		'M9 17c2 0 2.8-1 2.8-2.8V10c0-2 1-3.3 3.2-3',
		'M9 11.2h5.7'
	],
	triggers: [
		'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'
	],
	// Who starts a `by` trigger: a person, the framework, something outside the design.
	user: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z'],
	framework: [
		'M20 7h-9',
		'M14 17H5',
		'M20 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
		'M10 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'
	],
	outside: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
	trigger: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z', 'M12 6v6l4 2'],
	message: [
		'M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z',
		'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7'
	],
	api: ['M12 22v-5', 'M9 8V2', 'M15 8V2', 'M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z'],
	// A channel: a queue is a pipe, a topic a broadcast. A file is a page with a folded corner.
	channel: ['M7 7h10a5 5 0 0 1 0 10H7a5 5 0 0 1 0-10z', 'M8 12h7', 'm12 9 3 3-3 3'],
	topic: [
		'M4.9 19.1C1 15.2 1 8.8 4.9 4.9',
		'M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5',
		'M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
		'M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5',
		'M19.1 4.9C23 8.8 23 15.1 19.1 19'
	],
	file: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4'],
	// Events: inbox, ban, plus, pencil, trash.
	received: [
		'M22 12h-6l-2 3h-4l-2-3H2',
		'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'
	],
	'dead-lettered': ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z', 'm4.9 4.9 14.2 14.2'],
	created: ['M5 12h14', 'M12 5v14'],
	updated: [
		'M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z'
	],
	deleted: [
		'M3 6h18',
		'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6',
		'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'
	]
};

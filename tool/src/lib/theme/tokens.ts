/**
 * Design tokens. The canvas references them as CSS custom properties (`var(--sdv-*)`) so the
 * theme switches without re-rendering.
 */
const light = {
	'canvas-bg': '#f7f6f3',
	grid: '#e4e1da',
	'text-muted': '#6e6c66',
	edge: '#8d8a83',
	/** Lines at rest: a step darker than `edge`, so they read zoomed out. */
	'edge-rest': '#5f5c56',
	selection: '#5468d4',

	// Systems and modules: neutral, told apart by form (see the Entity identity board).
	'system-fill': 'rgba(255, 255, 255, 0.6)',
	'system-stroke': '#cfcbc2',
	'system-text': '#1d1d1b',
	'module-fill': 'rgba(24, 24, 27, 0.025)',
	'module-stroke': 'rgba(24, 24, 27, 0.1)',
	'module-text': '#1d1d1b',
	'boundary-stroke': '#cfcbc2',
	'boundary-text': '#4a4842',

	'model-fill': '#ffffff',
	'model-header': '#f1efea',
	'model-stroke': '#d9d5cc',
	'model-text': '#1d1d1b',
	'model-key-fill': '#f4ead0',
	'model-key-text': '#73561a',
	'row-hover': 'rgba(84, 104, 212, 0.06)',
	'row-peer': 'rgba(84, 104, 212, 0.13)',
	'row-self': 'rgba(84, 104, 212, 0.2)',
	'row-flash': 'rgba(84, 104, 212, 0.45)',
	'link-ref': '#5468d4',
	'link-from': '#2f8a6b',
	'link-write': '#b5533c',
	'link-call': '#7a5bb5',
	'link-event': '#a21caf',
	// Card kinds: line (400), icon (500), name (700, 200 in dark), separators (100).
	'kind-class': '#38bdf8',
	'kind-class-icon': '#0ea5e9',
	'kind-class-text': '#0369a1',
	'kind-class-soft': '#e0f2fe',
	'kind-table': '#34d399',
	'kind-table-icon': '#10b981',
	'kind-table-text': '#047857',
	'kind-table-soft': '#d1fae5',
	'kind-logic': '#fbbf24',
	'kind-logic-icon': '#f59e0b',
	'kind-logic-text': '#b45309',
	'kind-logic-soft': '#fef3c7',
	// Triggers: the only kind whose name bar is tinted (head).
	'kind-trigger': '#a78bfa',
	'kind-trigger-icon': '#8b5cf6',
	'kind-trigger-text': '#6d28d9',
	'kind-trigger-soft': '#ede9fe',
	'kind-trigger-head': '#f5f3ff',
	// Channels: fuchsia, beside the triggers they feed; corners say which way messages flow.
	'kind-channel': '#e879f9',
	'kind-channel-icon': '#d946ef',
	'kind-channel-text': '#a21caf',
	'kind-channel-soft': '#fae8ff',

	'api-fill': '#ffffff',
	'api-stroke': '#8d8a83',
	'api-text': '#1d1d1b',
	'method-get': '#2f8a6b',
	'method-post': '#5468d4',
	'method-put': '#a8741a',
	'method-delete': '#c2453d',

	'sev-break': '#c2453d',
	'sev-check': '#9a6700',
	'op-fill': '#1d1d1b',
	'op-text': '#ffffff'
};

export type Token = keyof typeof light;

const dark: Record<Token, string> = {
	'canvas-bg': '#141518',
	grid: '#222328',
	'text-muted': '#9b9993',
	edge: '#76746f',
	'edge-rest': '#b3b0aa',
	selection: '#7b8cf0',

	'system-fill': 'rgba(255, 255, 255, 0.015)',
	'system-stroke': '#3f3f46',
	'system-text': '#e9e7e3',
	'module-fill': 'rgba(255, 255, 255, 0.03)',
	'module-stroke': 'rgba(255, 255, 255, 0.09)',
	'module-text': '#e9e7e3',
	'boundary-stroke': '#35363c',
	'boundary-text': '#b6b4ae',

	'model-fill': '#1b1c20',
	'model-header': '#24252a',
	'model-stroke': '#36373d',
	'model-text': '#e9e7e3',
	'model-key-fill': '#3a3120',
	'model-key-text': '#e3c47c',
	'row-hover': 'rgba(123, 140, 240, 0.08)',
	'row-peer': 'rgba(123, 140, 240, 0.16)',
	'row-self': 'rgba(123, 140, 240, 0.26)',
	'row-flash': 'rgba(123, 140, 240, 0.5)',
	'link-ref': '#8e9cf3',
	'link-from': '#5cc29d',
	'link-write': '#ec8a6f',
	'link-call': '#b49be8',
	'link-event': '#f0abfc',
	'kind-class': '#38bdf8',
	'kind-class-icon': '#0ea5e9',
	'kind-class-text': '#bae6fd',
	'kind-class-soft': '#183e52',
	'kind-table': '#34d399',
	'kind-table-icon': '#10b981',
	'kind-table-text': '#a7f3d0',
	'kind-table-soft': '#184338',
	'kind-logic': '#fbbf24',
	'kind-logic-icon': '#f59e0b',
	'kind-logic-text': '#fde68a',
	'kind-logic-soft': '#523c1b',
	'kind-trigger': '#a78bfa',
	'kind-trigger-icon': '#8b5cf6',
	'kind-trigger-text': '#ddd6fe',
	'kind-trigger-soft': '#3b2d63',
	'kind-trigger-head': '#251f38',
	'kind-channel': '#e879f9',
	'kind-channel-icon': '#d946ef',
	'kind-channel-text': '#f5d0fe',
	'kind-channel-soft': '#4a1d4f',

	'api-fill': '#1b1c20',
	'api-stroke': '#76746f',
	'api-text': '#e9e7e3',
	'method-get': '#5cc29d',
	'method-post': '#8e9cf3',
	'method-put': '#e3a94f',
	'method-delete': '#ec7a72',

	'sev-break': '#ec7a72',
	'sev-check': '#d29922',
	'op-fill': '#e9e7e3',
	'op-text': '#141518'
};

export const TOKENS = Object.keys(light) as Token[];

/** Each token's value in `theme`, for what draws without CSS (the WebGL canvas). */
export const tokenValues = (theme: 'light' | 'dark'): Record<Token, string> =>
	theme === 'dark' ? dark : light;

/** CSS declaring every token for both themes; `data-theme` on an ancestor selects one. */
export function themeCss(): string {
	const block = (values: Record<Token, string>) =>
		TOKENS.map((t) => `  --sdv-${t}: ${values[t]};`).join('\n');
	return `:root, [data-theme='light'] {\n${block(light)}\n  color-scheme: light;\n}\n[data-theme='dark'] {\n${block(dark)}\n  color-scheme: dark;\n}\n`;
}

const METHOD: Partial<Record<string, Token>> = {
	GET: 'method-get',
	POST: 'method-post',
	PUT: 'method-put',
	// PATCH changes what exists, as PUT does, so it shares PUT's colour.
	PATCH: 'method-put',
	DELETE: 'method-delete'
};

/** An HTTP method's colour token; methods without one (HEAD, OPTIONS) are drawn muted. */
export const methodToken = (method: string | undefined): Token =>
	METHOD[method ?? ''] ?? 'text-muted';

/** The same as a CSS colour, for markup. */
export const methodColor = (method: string | undefined) => `var(--sdv-${methodToken(method)})`;

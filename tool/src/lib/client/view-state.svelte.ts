import type { Focus } from '#lib/landscape/focus.ts';

/** A row in one box: a model field, a logic unit on a logic card, or an api on a rail. */
export interface FieldRef {
	box: string;
	/** Field, logic unit or (on a rail) api id. */
	field: string;
}

/**
 * Per-page UI state shared by the canvas and its nodes. Nodes read it directly, so a hover
 * never rebuilds the node list (which would drop Svelte Flow's measurements mid-gesture).
 */
export class ViewState {
	selectedNodes = $state.raw<string[]>([]);
	/** The row or api under the pointer, or the inspector entry under it. */
	hover = $state.raw<FieldRef | null>(null);
	/** A box whose name bar is under the pointer; every connection of what it holds is drawn. */
	hoverBox = $state.raw<string | null>(null);
	/** The field row clicked; its links stay drawn and the inspector shows them. */
	field = $state.raw<FieldRef | null>(null);
	/** The api clicked on a rail; a card beside it shows it. */
	api = $state.raw<string | null>(null);
	/** A field of the picked api's own body shape under the pointer; its lineage is drawn. */
	apiField = $state.raw<string | null>(null);
	/** Boxes the picked api's bodies use, with the parts using them (request, 201...). */
	apiBoxes = $state.raw<Record<string, string[]>>({});
	/** Rows a lit card has that the picked api's body leaves out, by box. */
	apiDim = $state.raw<Record<string, Record<string, true>>>({});
	/** Rows followed to from the inspector, for Back. */
	trail = $state.raw<FieldRef[]>([]);
	/** A row flashed after flying to it. */
	flash = $state.raw<FieldRef | null>(null);
	/** Rows lit by the focused field, by box: the field itself, or the other end of a link. */
	hot = $state.raw<Record<string, Record<string, 'self' | 'peer'>>>({});
	/** Folded cards (over `FOLD` fields, or a focus's neighbours) shown in full, by box; they stay so until collapsed. */
	expanded = $state.raw<Record<string, true>>({});
	/** Rail rows lit because the focused logic unit handles or calls their api. */
	hotApis = $state.raw<Record<string, true>>({});
	/** Boxes holding the other end of a focused link, outlined so a closed box shows where. */
	peerBoxes = $state.raw<Record<string, true>>({});
	/** Kinds of connection hidden from the key, by key entry. */
	hidden = $state.raw<Record<string, true>>({});
	/** The canvas shows only this subject and what connects to it (see `focusOn`). */
	focused = $state.raw<Focus | null>(null);
	/** A unit being played: the choices made, the calls stepped into, and the step shown. */
	play = $state.raw<{
		unit: string;
		choices: Record<string, number>;
		into: string[];
		at: number;
	} | null>(null);
}

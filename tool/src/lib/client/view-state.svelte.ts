import type { Focus } from '#lib/landscape/focus.ts';

/** A row in one box: a model field, a logic unit on a logic card, or an api on a rail. */
export interface FieldRef {
	box: string;
	/** Field, logic unit or (on a rail) api id. */
	field: string;
}

/**
 * How a row is lit: the row looked at (or the unit taking a played step), the other end of a
 * lit line, or a unit a played run has stepped into a call from.
 */
export type Hot = 'self' | 'peer' | 'caller';

/** How long the pointer rests on a row, name bar or rail before it lights, so sweeping across
 *  the canvas does not light and unlight everything it passes. Leaving is instant. */
export const HOVER_DELAY = 250;

/**
 * Per-page UI state shared by the canvas, what draws it (GlLayer) and the cards over it. They
 * read it directly, so a hover rebuilds nothing.
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
	hot = $state.raw<Record<string, Record<string, Hot>>>({});
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
	/** Boxes whose contents are drawn at this camera: a card its rows, a box its rail's
	 *  endpoints, where they read on or near the screen (see open.ts). */
	near = $state.raw<Record<string, true>>({});
	/** Boxes drawn in full however far out: what is looked at, picked or played, and the far
	 *  ends of its lines. A card shows its rows, a box its rail's endpoints. */
	full = $state.raw<Record<string, true>>({});
	/** The box whose rail is under the pointer: the rail lists its endpoints at any zoom. */
	railHover = $state<string | null>(null);
	/** A unit being played: the choices made, the calls stepped into and those stepped over on
	 *  purpose, and the step shown. */
	play = $state.raw<{
		unit: string;
		choices: Record<string, number>;
		into: string[];
		over: string[];
		at: number;
	} | null>(null);
}

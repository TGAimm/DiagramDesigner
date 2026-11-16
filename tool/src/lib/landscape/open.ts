import { RAIL, type Rail } from './apis.ts';
import { TABLE, type LandscapeBox } from './layout.ts';

/** Zooming in on something goes until its text would be drawn at READABLE px on screen. */
export const READABLE = 12;

/**
 * Adaptive detail: below LEGIBLE px on screen, a card's rows and a rail's endpoints are not
 * drawn, so a large landscape zoomed out draws only frames. Systems and modules are always
 * drawn open.
 */
export const LEGIBLE = 6;

/** Model and logic cards draw only their frames, their rows being under LEGIBLE px. */
export const cardsBrief = (zoom: number) => TABLE.row * zoom < LEGIBLE;

/**
 * Which box each api is drawn on, by box id: its parent's box when that is shown, else the
 * nearest shown box round it, so the api of a module inside a closed system sits on the
 * system. Host boxes come first in each list, then the boxes inside them, in layout order.
 */
export function apiHosts(boxes: LandscapeBox[], open: Set<string>): Map<string, string[]> {
	const byId = new Map(boxes.map((b) => [b.id, b]));
	const out = new Map<string, string[]>();
	for (const b of boxes) {
		if (!b.apis?.length) continue;
		let host = b;
		while (host.parentId && !open.has(host.parentId)) host = byId.get(host.parentId)!;
		out.set(host.id, [...(out.get(host.id) ?? []), ...b.apis]);
	}
	return out;
}

/** A rail lists its endpoints while its rows would read at LEGIBLE px; else it shows its name. */
export const railOpen = (rail: Rail, zoom: number) => RAIL.font * rail.scale * zoom >= LEGIBLE;

import { RAIL, type Rail } from './apis.ts';
import { TABLE, type LandscapeBox } from './layout.ts';

/** Zooming in on something goes until its text would be drawn at READABLE px on screen. */
export const READABLE = 12;

/**
 * Adaptive detail: a card's rows and a rail's endpoints are drawn only while they would read
 * at LEGIBLE px or more and are on or near the screen. Otherwise a card is its frame and name,
 * a rail its name. Systems and modules are always drawn open; layout never changes.
 */
export const LEGIBLE = 4;

/** Names never draw under this many px on screen while the box has room for them. */
export const NAME_MIN = 10;

/** How far past each side of the screen contents are drawn, as a share of its size. */
export const MARGIN = 0.5;

export interface Camera {
	x: number;
	y: number;
	zoom: number;
	/** Canvas size in pixels. */
	width: number;
	height: number;
}

/** Card rows read at LEGIBLE px. */
export const cardsLegible = (zoom: number) => TABLE.row * zoom >= LEGIBLE;

/** A rail's endpoints read at LEGIBLE px. */
export const railOpen = (rail: Rail, zoom: number) => RAIL.font * rail.scale * zoom >= LEGIBLE;

/** A canvas-px rectangle is on the screen, or within MARGIN of it. */
function near(x: number, y: number, w: number, h: number, cam: Camera) {
	const mx = cam.width * MARGIN;
	const my = cam.height * MARGIN;
	const left = x * cam.zoom + cam.x;
	const top = y * cam.zoom + cam.y;
	return (
		left < cam.width + mx &&
		top < cam.height + my &&
		left + w * cam.zoom > -mx &&
		top + h * cam.zoom > -my
	);
}

/**
 * Boxes drawing their contents at this camera: cards whose rows read and are near the screen,
 * and boxes whose rail's endpoints read and are near it (rail rows are keyed by the host box).
 */
export function drawnInFull(
	boxes: LandscapeBox[],
	rails: Map<string, Rail>,
	cam: Camera
): Set<string> {
	const out = new Set<string>();
	const cards = cardsLegible(cam.zoom);
	for (const b of boxes) {
		if (cards && (b.table || b.logic) && near(b.absX, b.absY, b.width, b.height, cam))
			out.add(b.id);
		const r = rails.get(b.id);
		if (
			r &&
			railOpen(r, cam.zoom) &&
			near(b.absX + b.width - r.width / 2, b.absY + r.top, r.width, r.height, cam)
		)
			out.add(b.id);
	}
	return out;
}

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

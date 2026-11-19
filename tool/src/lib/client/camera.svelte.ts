import { getContext, setContext } from 'svelte';

/**
 * The canvas camera: where the view is (`x`, `y` the screen position of canvas point 0,0, and
 * `zoom`), and how it moves. What is drawn over the canvas (cards, the minimap, the player)
 * moves it only through this (see `CanvasCamera`).
 */
export interface View {
	x: number;
	y: number;
	zoom: number;
}

export interface Bounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Move {
	/** Animated over this many ms; at once when left out or 0. */
	duration?: number;
}

export interface Camera {
	/** The view now; reactive. */
	readonly current: View;
	getViewport(): View;
	setViewport(view: View, move?: Move): Promise<boolean>;
	/** Canvas point `x`, `y` to the middle of the view, at `zoom` or the zoom now. */
	setCenter(x: number, y: number, move?: Move & { zoom?: number }): Promise<boolean>;
	/** `bounds` in view with `padding` (a share of their size) to spare round them. */
	fitBounds(bounds: Bounds, move?: Move & { padding?: number }): Promise<boolean>;
	/** Zooms by `factor` about the middle of the view. */
	zoomBy(factor: number, move?: Move): Promise<boolean>;
}

const KEY = Symbol('camera');
export const setCamera = (camera: Camera) => setContext(KEY, camera);
export const getCamera = () => getContext<Camera>(KEY);

/** What was under a gesture: the event that moved the view, or null for an animation. */
type Source = Event | null;

/** Wheel gestures end this long after their last event. */
const WHEEL_END = 150;
/** A press that moves the pointer less than this many px is a click, not a drag. */
const CLICK_SLOP = 3;

/**
 * The canvas's camera: wheel zoom about the pointer (pinch on a trackpad), drag to pan,
 * two-finger pinch on touch, and animated moves. It tells when a movement starts
 * (`onmovestart`), steps (`onmove`) and ends (`onmoveend`).
 */
export class CanvasCamera implements Camera {
	current = $state.raw<View>({ x: 0, y: 0, zoom: 1 });
	/** The view's size in screen px. */
	width = 1;
	height = 1;
	minZoom = 0.05;
	maxZoom = 64;
	onmovestart?: (source: Source) => void;
	onmove?: (source: Source) => void;
	onmoveend?: () => void;
	/** The last press moved the view: the click that ends it is not a click on what is drawn. */
	dragged = false;

	#moving = false;
	#endTimer: ReturnType<typeof setTimeout> | undefined;
	#frame = 0;
	#done: ((finished: boolean) => void) | undefined;

	getViewport(): View {
		return this.current;
	}

	#clamp(zoom: number) {
		return Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
	}

	/** Moves to `view` at once, as part of a gesture or animation from `source`. */
	#step(view: View, source: Source) {
		const zoom = this.#clamp(view.zoom);
		if (zoom !== view.zoom) {
			// Clamped about the middle of the view, so a zoom past the limit does not pan.
			const cx = (this.width / 2 - view.x) / view.zoom;
			const cy = (this.height / 2 - view.y) / view.zoom;
			view = { x: this.width / 2 - cx * zoom, y: this.height / 2 - cy * zoom, zoom };
		}
		const was = this.current;
		if (was.x === view.x && was.y === view.y && was.zoom === view.zoom) return;
		if (!this.#moving) {
			this.#moving = true;
			this.onmovestart?.(source);
		}
		this.current = view;
		this.onmove?.(source);
	}

	#end() {
		clearTimeout(this.#endTimer);
		if (!this.#moving) return;
		this.#moving = false;
		this.onmoveend?.();
	}

	#stop() {
		cancelAnimationFrame(this.#frame);
		this.#frame = 0;
		this.#done?.(false);
		this.#done = undefined;
	}

	setViewport(view: View, move: Move = {}): Promise<boolean> {
		this.#stop();
		const to = { ...view, zoom: this.#clamp(view.zoom) };
		if (!move.duration || typeof requestAnimationFrame === 'undefined') {
			this.#step(to, null);
			this.#end();
			return Promise.resolve(true);
		}
		const from = this.current;
		// The middle of the view travels in canvas px and the zoom by its logarithm, so a long
		// way at a far zoom and a short one close in take the same time and look alike.
		const centre = (v: View) => ({
			x: (this.width / 2 - v.x) / v.zoom,
			y: (this.height / 2 - v.y) / v.zoom
		});
		const [a, b] = [centre(from), centre(to)];
		const t0 = performance.now();
		return new Promise((resolve) => {
			this.#done = resolve;
			const tick = (now: number) => {
				const t = Math.min(1, (now - t0) / move.duration!);
				const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
				const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e);
				const cx = a.x + (b.x - a.x) * e;
				const cy = a.y + (b.y - a.y) * e;
				this.#step({ x: this.width / 2 - cx * zoom, y: this.height / 2 - cy * zoom, zoom }, null);
				if (t < 1) this.#frame = requestAnimationFrame(tick);
				else {
					this.#frame = 0;
					this.#done = undefined;
					this.#end();
					resolve(true);
				}
			};
			this.#frame = requestAnimationFrame(tick);
		});
	}

	setCenter(x: number, y: number, move: Move & { zoom?: number } = {}) {
		const zoom = this.#clamp(move.zoom ?? this.current.zoom);
		return this.setViewport(
			{ x: this.width / 2 - x * zoom, y: this.height / 2 - y * zoom, zoom },
			move
		);
	}

	fitBounds(bounds: Bounds, move: Move & { padding?: number } = {}) {
		const pad = 1 + (move.padding ?? 0.1);
		const zoom = this.#clamp(
			Math.min(this.width / (bounds.width * pad), this.height / (bounds.height * pad))
		);
		return this.setCenter(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
			...move,
			zoom
		});
	}

	zoomBy(factor: number, move: Move = {}) {
		const { x, y, zoom } = this.current;
		return this.setCenter((this.width / 2 - x) / zoom, (this.height / 2 - y) / zoom, {
			...move,
			zoom: zoom * factor
		});
	}

	/** Zooms by `factor` about screen point `px`, `py`. */
	#zoomAt(px: number, py: number, factor: number, source: Source) {
		const { x, y, zoom } = this.current;
		const z = this.#clamp(zoom * factor);
		this.#step({ x: px - ((px - x) * z) / zoom, y: py - ((py - y) * z) / zoom, zoom: z }, source);
	}

	/**
	 * Wheel, drag and pinch on `el` move the camera, and so do wheels and presses passed on to
	 * it (from the cards over the canvas). Presses that do not move the view stay clicks; the
	 * click ending one that did is dropped, and `dragged` tells it. Returns a function undoing it.
	 */
	attach(el: HTMLElement): () => void {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- pointers held down, not state
		const pointers = new Map<number, { x: number; y: number }>();
		let press: { x: number; y: number } | undefined;
		let pinch: { d: number; mx: number; my: number } | undefined;
		const local = (e: { clientX: number; clientY: number }) => {
			const r = el.getBoundingClientRect();
			return { x: e.clientX - r.left, y: e.clientY - r.top };
		};
		const spread = () => {
			const [a, b] = [...pointers.values()];
			return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
		};
		const onwheel = (e: WheelEvent) => {
			e.preventDefault();
			this.#stop();
			const p = local(e);
			// As d3-zoom: a line or page is worth more than a pixel, and a trackpad pinch
			// (ctrl + wheel) zooms faster.
			const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.002;
			this.#zoomAt(p.x, p.y, 2 ** (-e.deltaY * unit * (e.ctrlKey ? 10 : 1)), e);
			clearTimeout(this.#endTimer);
			this.#endTimer = setTimeout(() => this.#end(), WHEEL_END);
		};
		// A press is followed on the window, not captured: a press passed on from a card must
		// still click the card's button when it does not move.
		const follow = (on: boolean) => {
			if (on) {
				window.addEventListener('pointermove', onmove);
				window.addEventListener('pointerup', onup);
				window.addEventListener('pointercancel', onup);
			} else {
				window.removeEventListener('pointermove', onmove);
				window.removeEventListener('pointerup', onup);
				window.removeEventListener('pointercancel', onup);
			}
		};
		/** Drops the click a drag ends with, wherever it lands. */
		const noClick = (e: MouseEvent) => {
			e.stopPropagation();
			e.preventDefault();
		};
		const ondown = (e: PointerEvent) => {
			if (e.button !== 0 && e.pointerType === 'mouse') return;
			this.#stop();
			if (!pointers.size) follow(true);
			pointers.set(e.pointerId, local(e));
			if (pointers.size === 1) {
				press = local(e);
				this.dragged = false;
			} else if (pointers.size === 2) pinch = spread();
		};
		const onmove = (e: PointerEvent) => {
			const was = pointers.get(e.pointerId);
			if (!was) return;
			const p = local(e);
			pointers.set(e.pointerId, p);
			if (pinch && pointers.size === 2) {
				const now = spread();
				this.dragged = true;
				const { x, y, zoom } = this.current;
				this.#step({ x: x + now.mx - pinch.mx, y: y + now.my - pinch.my, zoom }, e);
				this.#zoomAt(now.mx, now.my, now.d / (pinch.d || 1), e);
				pinch = now;
				return;
			}
			if (!press) return;
			if (!this.dragged && Math.hypot(p.x - press.x, p.y - press.y) < CLICK_SLOP) return;
			// The first step of a drag takes the view along from where the press was.
			const from = this.dragged ? was : press;
			this.dragged = true;
			const { x, y, zoom } = this.current;
			this.#step({ x: x + p.x - from.x, y: y + p.y - from.y, zoom }, e);
		};
		const onup = (e: PointerEvent) => {
			if (!pointers.delete(e.pointerId)) return;
			if (pointers.size < 2) pinch = undefined;
			if (!pointers.size) {
				press = undefined;
				follow(false);
				this.#end();
				if (this.dragged) {
					// The click comes straight after the release, before any timer.
					window.addEventListener('click', noClick, true);
					setTimeout(() => window.removeEventListener('click', noClick, true));
				}
			}
		};
		el.addEventListener('wheel', onwheel, { passive: false });
		el.addEventListener('pointerdown', ondown);
		return () => {
			this.#stop();
			clearTimeout(this.#endTimer);
			follow(false);
			window.removeEventListener('click', noClick, true);
			el.removeEventListener('wheel', onwheel);
			el.removeEventListener('pointerdown', ondown);
		};
	}
}

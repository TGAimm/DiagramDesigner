/**
 * Text for the WebGL renderer, drawn by the browser itself so it looks as page text does: each
 * string is drawn with Canvas 2D's `fillText`, in the page's font, at the size it shows on
 * screen in device pixels, packed into shared atlas pages, and shown as a sprite, one pixel of
 * the raster to one pixel of the screen. Whole strings, so shaping, kerning and fallback fonts
 * are the browser's.
 *
 * While the view zooms, a text keeps its raster, scaled (briefly soft); once the camera rests,
 * texts whose size on screen changed are drawn again, nearest the middle of the screen first, a
 * few milliseconds per frame. A text gets a raster only once it is on screen.
 *
 * Coverage, not colour, is stored: a text drawn on an opaque fill keeps the browser's subpixel
 * (LCD) antialiasing, as page text on an opaque fill has, so its raster holds a coverage per
 * colour channel; it is drawn on an opaque ground far from its colour in each channel, and the
 * coverage read back. The shader blends the text colour over what is below it per channel, with
 * dual-source blending (WEBGL_blend_func_extended): colour = text × coverage + below ×
 * (1 − coverage). Other texts, and all where that extension is missing, hold one coverage in all
 * channels. The browser makes a dark text's edges heavier than a light one's, so every raster is
 * drawn in its own colour.
 */
import type {
	Container,
	Renderer,
	Shader,
	Sprite,
	Texture,
	TextureSource,
	WebGLRenderer
} from 'pixi.js';

type Pixi = typeof import('pixi.js');

/** Side of an atlas page, in texels. */
const PAGE = 2048;
/** Pages kept at most; when full, the page least on screen is emptied and reused. */
const MAX_PAGES = 4;
/** Rasters taller than this, or wider than a page, get a texture of their own. */
const SHELF_MAX = 256;
/** Empty texels around a raster's ink: room for its antialiasing, and none bleeding in. */
const PAD = 2;
/** Ink may reach past a glyph's advance and the font's ascent and descent by this, in em. */
const OVERHANG = 0.15;
/** The line box, as a multiple of the font size; a label's origin is its top. */
export const LINE = 1.2;
/** A big text is drawn only where it is on screen, and this share of the screen around it. */
const BIG_MARGIN = 0.25;
/**
 * Milliseconds per frame spent drawing texts that have no raster yet (they show once drawn), at
 * rest and moving, and then on redrawing those whose size changed.
 */
const NEW_REST_BUDGET = 12;
const NEW_MOVING_BUDGET = 8;
const REST_BUDGET = 6;
const MOVING_BUDGET = 3;
/** While moving, a text is redrawn once its raster is scaled past these. */
const MOVING_UP = 1.4;
const MOVING_DOWN = 0.7;
const BLEND = 'sdv-text';
const UPLOAD = 'sdv-text';

/**
 * The entity glyphs drawn before names (EntityGlyph's marks: Lucide's app-window, box,
 * braces, table, square-function, plug, zap, clock and mail), as SVG path data on a 24-unit
 * grid, stroked 2.2 units wide with round ends and joins, as EntityGlyph styles them.
 */
const GLYPHS: Record<string, string[]> = {
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
	trigger: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z', 'M12 6v6l4 2'],
	message: [
		'M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z',
		'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7'
	],
	api: ['M12 22v-5', 'M9 8V2', 'M15 8V2', 'M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z']
};
/** A glyph is 0.85em square and 0.4em from its name, as EntityGlyph and the names lay it out. */
const GLYPH_EM = 0.85;
const GLYPH_GAP = 0.4;
/**
 * A change mark's badge, as LandscapeNode's `.op`: its text 0.85em, the badge 1.15 of that
 * square with corners 0.2 of it, and 0.35 of it before what follows.
 */
const OP_EM = 0.85;
const OP_BOX = 1.15 * OP_EM;
const OP_RADIUS = 0.2 * OP_EM;
const OP_MARGIN = 0.35 * OP_EM;

/** Room before a label's text for its glyph and change mark, in em (see GlTextLayer.label). */
export function leadEm(o: { glyph?: string; op?: unknown; gap?: number }): number {
	const gap = o.gap ?? GLYPH_GAP;
	return (o.glyph ? GLYPH_EM + gap : 0) + (o.op ? OP_BOX + OP_MARGIN + gap : 0);
}

export interface GlLabelOptions {
	/**
	 * An entity glyph drawn before the text (see GLYPHS); with no text, the label is the glyph
	 * alone.
	 */
	glyph?: string;
	/** The glyph's colour, 0xRRGGBB, and alpha: a card kind's icon colour, else the text's at 75%. */
	glyphColor?: number;
	glyphAlpha?: number;
	/** A change mark (`+`, `~`, `−`) in a badge before the text, after the glyph. */
	op?: { text: string; color: number; fill: number; fillAlpha?: number };
	/** Space after the glyph and after the mark, in em; 0.4 as names lay them out. */
	gap?: number;
	/** Font size in px of the label's parent (canvas px, unless a parent scales it). */
	px: number;
	/** Text colour, 0xRRGGBB; its alpha goes in `alpha`. */
	color: number;
	/** CSS font weight. */
	weight?: number;
	/**
	 * Drawn on a fully opaque fill, so it may use subpixel antialiasing as the browser's own
	 * text does there. On a translucent ground its colour fringes would show.
	 */
	lcd?: boolean;
}

/** A text drawn by GlTextLayer: place it as a Container (position, alpha, visible). */
export interface GlLabel extends Container {
	/** Font size, in the parent's px; may change every frame. Its origin is the top of a LINE × px line box. */
	px: number;
	/** Its advance width at `px`, in the parent's px (measureText), with what goes before its text. */
	readonly width: number;
	/** Its text's own width at `px`, without what goes before it. */
	readonly advance: number;
	readonly text: string;
}

interface Patch {
	x: number;
	y: number;
	w: number;
	h: number;
	data: Uint8ClampedArray;
}

interface Shelf {
	y: number;
	h: number;
	/** Next free texel along it. */
	x: number;
	/** Rasters on it; when none, it is empty again. */
	live: number;
}

interface Page {
	source: TextureSource;
	shelves: Shelf[];
	/** Top of the room below the shelves. */
	top: number;
	/** Written since the last upload. */
	patches: Patch[];
	uploaded: boolean;
	/** Its GPU texture was made anew (lost context, or freed): what it held is gone. */
	lost: boolean;
	/** Holds one big raster. */
	big: boolean;
	bytes: number;
}

interface Raster {
	key: string;
	/** Font size drawn at, in device px. */
	size: number;
	page: Page;
	shelf?: Shelf;
	texture: Texture;
	/** Its top-left from the label's origin, in device px at `size`. */
	ox: number;
	oy: number;
	/** Labels showing it. */
	uses: number;
	/** The part of a big raster drawn, in device px from its ink box's top-left. */
	clip?: { x0: number; y0: number; x1: number; y1: number };
	/** Last frame a label showing it was on screen. */
	seen: number;
}

interface Metrics {
	/** Font ascent and descent per px of font size. */
	ascent: number;
	descent: number;
}

let labelClass: ReturnType<typeof makeLabelClass> | undefined;

export class GlTextLayer {
	private readonly P: Pixi;
	private readonly renderer: Renderer;
	private readonly family: string;
	/** Whether subpixel coverage can be blended (dual-source blending); else one coverage, blended as usual. */
	readonly lcd: boolean;
	private readonly labels = new Set<LabelImpl>();
	private readonly rasters = new Map<string, Raster>();
	private readonly pages: Page[] = [];
	private readonly pageOf = new WeakMap<TextureSource, Page>();
	private readonly metrics = new Map<number, Metrics>();
	/** Widths measured, by weight, size and text; the font each canvas has. */
	private readonly widths = new Map<string, number>();
	private readonly fonts = new WeakMap<CanvasRenderingContext2D, string>();
	private readonly measurers = new Map<string, CanvasRenderingContext2D>();
	/** Draw subpixel rasters (on an opaque canvas) and the others. */
	private readonly lcdCtx: CanvasRenderingContext2D;
	private readonly grayCtx: CanvasRenderingContext2D;
	private frame = 0;
	private bigSeq = 0;
	private lastWork = 0;
	private maxWork = 0;
	private pending = 0;
	private busy = false;
	private sharpAt = 0;

	constructor(P: Pixi, renderer: Renderer) {
		this.P = P;
		this.renderer = renderer;
		this.family = getComputedStyle(document.body).fontFamily;
		if (renderer.type !== P.RendererType.WEBGL) throw new Error('text needs WebGL');
		const gl = (renderer as WebGLRenderer).gl;
		this.lcd =
			!!gl.getExtension('WEBGL_blend_func_extended') &&
			(renderer as WebGLRenderer).context.webGLVersion === 2;
		const textures = (renderer as WebGLRenderer).texture as unknown as {
			_uploads: Record<string, unknown>;
		};
		textures._uploads[UPLOAD] = {
			id: UPLOAD,
			upload: (source: TextureSource, glTexture: GlTex, g: WebGL2RenderingContext) =>
				this.upload(source, glTexture, g)
		};
		if (this.lcd) registerBatcher(P);
		const canvas = (w: number, h: number) => {
			const c = document.createElement('canvas');
			c.width = w;
			c.height = h;
			return c;
		};
		this.lcdCtx = canvas(PAGE, SHELF_MAX).getContext('2d', {
			alpha: false,
			willReadFrequently: true
		})!;
		this.grayCtx = canvas(PAGE, SHELF_MAX).getContext('2d', { willReadFrequently: true })!;
	}

	/** A text `px` tall in its parent's px; place it as a Container. */
	label(text: string, opts: GlLabelOptions): GlLabel {
		const Label = (labelClass ??= makeLabelClass(this.P));
		const weight = opts.weight ?? 400;
		const lcd = this.lcd && !!opts.lcd;
		const sprite = new this.P.Sprite();
		sprite.roundPixels = true;
		sprite.visible = false;
		if (this.lcd) {
			sprite.blendMode = BLEND as never;
			// The sprite pipe batches with the default batcher; text goes through its own.
			const pipes = this.renderer.renderPipes as unknown as {
				sprite: { _getGpuSprite(s: Sprite): { batcherName: string } };
			};
			pipes.sprite._getGpuSprite(sprite).batcherName = BLEND;
		}
		const glyph = opts.glyph && GLYPHS[opts.glyph] ? opts.glyph : undefined;
		const alone = !!glyph && !text;
		const color = (alone ? (opts.glyphColor ?? opts.color) : opts.color) & 0xffffff;
		const l = new Label(this, text, color, weight, lcd, opts.px, sprite);
		this.labels.add(l);
		if (alone) {
			l.glyph = glyph;
			l.alpha = opts.glyphAlpha ?? 0.75;
			return l;
		}
		// What goes before the text is drawn apart, each in its own colour: the glyph, then the
		// change mark on its badge.
		const gap = opts.gap ?? GLYPH_GAP;
		let lead = 0;
		if (glyph) {
			l.addPart(this.label('', { ...opts, op: undefined }), 0);
			lead += GLYPH_EM + gap;
		}
		if (opts.op) {
			const bg = new this.P.Graphics()
				.roundRect(0, -OP_BOX / 2, OP_BOX, OP_BOX, OP_RADIUS)
				.fill({ color: opts.op.fill, alpha: opts.op.fillAlpha ?? 1 });
			const t = this.label(opts.op.text, {
				px: opts.px * OP_EM,
				color: opts.op.color,
				weight: 700,
				lcd: opts.lcd
			});
			l.addOp(bg, t, lead);
		}
		l.lead = leadEm(opts);
		return l;
	}

	/**
	 * Before each render: gives texts on screen a raster, first those with none, then redraws
	 * those whose size on screen changed (while `moving`, only those scaled far), each within a
	 * budget per frame. True if work is left for another frame. `screen` is the canvas in CSS px.
	 */
	update(screen: { width: number; height: number }, moving: boolean): boolean {
		const t0 = performance.now();
		this.frame++;
		this.ensureBlend();
		for (const p of this.pages) if (p.lost) this.evict(p);
		const dpr = this.renderer.resolution;
		const W = screen.width;
		const H = screen.height;
		const worlds = new Map<Container, World | null>();
		const must: Need[] = [];
		const soon: Need[] = [];
		for (const l of this.labels) {
			// A label holding only a change mark draws nothing itself; its parts are labels.
			if (!l.visible || !l.renderable || l.alpha <= 0 || (!l.glyph && !l.text.trim())) continue;
			const parent = l.parent ? worldOf(l.parent, worlds) : IDENTITY;
			if (!parent) continue;
			const a = parent.a * l.scale.x;
			const d = parent.d * l.scale.y;
			const x = parent.a * l.x + parent.tx;
			const y = parent.d * l.y + parent.ty;
			const w = l.width * a;
			const h = LINE * l.px * d;
			if (x > W || y > H || x + w < 0 || y + h < 0 || d <= 0) continue;
			const size = l.px * d * dpr;
			const need: Need = {
				l,
				size,
				x,
				y,
				w,
				h,
				d: Math.hypot(x + w / 2 - W / 2, y + h / 2 - H / 2)
			};
			l.need = need;
			l.seen = this.frame;
			const r = l.raster;
			if (r) r.seen = this.frame;
			if (size < 1) {
				if (r) this.release(r);
				l.show(undefined);
				continue;
			}
			if (!r) must.push(need);
			else if (r.clip && !this.covers(r, need, W, H, dpr)) must.push(need);
			else if (Math.abs(size / r.size - 1) > 1e-3) {
				const ratio = size / r.size;
				if (!moving || ratio > MOVING_UP || ratio < MOVING_DOWN) soon.push(need);
			}
		}
		// Texts with no raster first, nearest the middle first; emptying a page (see place) adds
		// the texts on screen that were on it.
		must.sort((p, q) => p.d - q.d);
		const first = moving ? NEW_MOVING_BUDGET : NEW_REST_BUDGET;
		let drawn = 0;
		for (; drawn < must.length; drawn++) {
			if (drawn && performance.now() - t0 > first) break;
			this.draw(must[drawn], W, H, dpr, must);
		}
		soon.sort((p, q) => p.d - q.d);
		const budget = moving ? MOVING_BUDGET : REST_BUDGET;
		let done = 0;
		for (const n of soon) {
			if (drawn < must.length || performance.now() - t0 > budget) break;
			if (moving && n.l.raster?.clip) {
				done++;
				continue;
			}
			this.draw(n, W, H, dpr, must);
			done++;
		}
		for (const p of this.pages) if (p.patches.length) p.source.update();
		this.lastWork = performance.now() - t0;
		this.maxWork = Math.max(this.maxWork, this.lastWork);
		this.pending = must.length - drawn + soon.length - done;
		// When every text on screen last became sharp after the view moved.
		if (!moving && !this.pending && this.busy) this.sharpAt = performance.now();
		this.busy = moving || this.pending > 0;
		return this.pending > 0;
	}

	/**
	 * What it holds (atlas pages, big rasters, bytes on the GPU) and how it went: the last update's
	 * time, the longest since the last call, work left, and when text last became sharp.
	 */
	stats() {
		const maxMs = this.maxWork;
		this.maxWork = 0;
		return {
			pages: this.pages.filter((p) => !p.big).length,
			big: this.pages.filter((p) => p.big).length,
			rasters: this.rasters.size,
			labels: this.labels.size,
			bytes: this.pages.reduce((s, p) => s + p.bytes, 0),
			ms: this.lastWork,
			maxMs,
			pending: this.pending,
			sharpAt: this.sharpAt
		};
	}

	destroy() {
		for (const l of [...this.labels]) l.destroy();
		for (const p of [...this.pages]) this.dropPage(p);
		const textures = (this.renderer as WebGLRenderer).texture as unknown as {
			_uploads?: Record<string, unknown>;
		};
		if (textures?._uploads) delete textures._uploads[UPLOAD];
	}

	// ---------------------------------------------------------------- labels

	/** Called by a label as it is destroyed. */
	forget(l: LabelImpl) {
		this.labels.delete(l);
		if (l.raster) this.release(l.raster);
		l.raster = undefined;
	}

	/** Width of `text` at `px`, by the browser's layout of it. */
	measure(text: string, weight: number, px: number): number {
		const key = `${weight}|${px}|${text}`;
		let w = this.widths.get(key);
		if (w === undefined) {
			if (this.widths.size > 50000) this.widths.clear();
			w = this.measurer(`${weight} ${px}px ${this.family}`).measureText(text).width;
			this.widths.set(key, w);
		}
		return w;
	}

	/**
	 * A canvas for measuring in `font`; one per font, as measuring right after a font change is
	 * slow. The last few used are kept.
	 */
	private measurer(font: string): CanvasRenderingContext2D {
		let ctx = this.measurers.get(font);
		if (ctx) this.measurers.delete(font);
		else {
			ctx = document.createElement('canvas').getContext('2d')!;
			ctx.font = font;
			if (this.measurers.size >= 16) this.measurers.delete(this.measurers.keys().next().value!);
		}
		this.measurers.set(font, ctx);
		return ctx;
	}

	/** Sets `ctx`'s font, unless it has it already (setting one is slow: it is parsed). */
	private font(ctx: CanvasRenderingContext2D, font: string) {
		if (this.fonts.get(ctx) !== font) {
			ctx.font = font;
			this.fonts.set(ctx, font);
		}
		return ctx;
	}

	private metricsOf(weight: number): Metrics {
		let m = this.metrics.get(weight);
		if (!m) {
			const t = this.measurer(`${weight} 100px ${this.family}`).measureText('Hg');
			m = { ascent: t.fontBoundingBoxAscent / 100, descent: t.fontBoundingBoxDescent / 100 };
			this.metrics.set(weight, m);
		}
		return m;
	}

	/** Gives `n.l` a raster at `n.size`, shared with other labels drawing the same. */
	private draw(n: Need, W: number, H: number, dpr: number, must: Need[]) {
		const { l, size } = n;
		const key = `${l.weight}|${l.color}|${l.lcd ? 1 : 0}|${size}|${l.glyph ?? ''}|${l.lead}|${l.text}`;
		let r = this.rasters.get(key);
		if (r && !r.clip) {
			if (l.raster !== r) {
				r.uses++;
				if (l.raster) this.release(l.raster);
				l.show(r);
			}
			r.seen = this.frame;
			return;
		}
		r = this.raster(l, size, key, n, W, H, dpr, must);
		if (l.raster) this.release(l.raster);
		l.show(r);
	}

	// ---------------------------------------------------------------- rasters

	/** Draws `l` at font size `size` device px into the atlas (or a texture of its own if big). */
	private raster(
		l: LabelImpl,
		size: number,
		key: string,
		n: Need,
		W: number,
		H: number,
		dpr: number,
		must: Need[]
	): Raster | undefined {
		const font = `${l.weight} ${size}px ${this.family}`;
		// The box drawn: the advance and the font's ascent and descent, and room around them for
		// ink past them. (Measuring the ink would be exact, but measureText finds glyph bounds,
		// which is slow for each new size.)
		const fm = this.metricsOf(l.weight);
		const k = size / l.px;
		const left = Math.ceil(OVERHANG * size) + PAD;
		const right = Math.ceil(l.advance * k + OVERHANG * size) + PAD;
		const asc = Math.ceil((fm.ascent + OVERHANG) * size) + PAD;
		const desc = Math.ceil((fm.descent + OVERHANG) * size) + PAD;
		const w = left + right;
		const h = asc + desc;
		// The baseline sits as the browser lays a line out: the font's ascent and descent at the
		// label's size, rounded to whole px, centred in the line box.
		const baseline =
			(LINE * l.px + Math.round(fm.ascent * l.px) - Math.round(fm.descent * l.px)) / 2;
		// What goes before the text (see `label`) moves it right.
		const ox = l.lead * size - left;
		const oy = baseline * k - asc;
		if (!l.text.trim() && !l.glyph) return undefined;
		if (w > PAGE || h > SHELF_MAX) {
			// Big: draw only what is on screen, and a margin round it.
			const sx = n.x * dpr + ox;
			const sy = n.y * dpr + oy;
			const mx = W * dpr * BIG_MARGIN;
			const my = H * dpr * BIG_MARGIN;
			const clip = {
				x0: Math.max(0, Math.floor(-mx - sx)),
				y0: Math.max(0, Math.floor(-my - sy)),
				x1: Math.min(w, Math.ceil(W * dpr + mx - sx)),
				y1: Math.min(h, Math.ceil(H * dpr + my - sy))
			};
			const cw = clip.x1 - clip.x0;
			const ch = clip.y1 - clip.y0;
			if (cw <= 0 || ch <= 0) return undefined;
			const page = this.newPage(cw, ch, true);
			const data = this.paint(l, font, left - clip.x0, asc - clip.y0, cw, ch);
			page.patches.push({ x: 0, y: 0, w: cw, h: ch, data });
			const texture = new this.P.Texture({ source: page.source });
			return {
				key: `${key}|${++this.bigSeq}`,
				size,
				page,
				texture,
				ox: ox + clip.x0,
				oy: oy + clip.y0,
				uses: 1,
				clip,
				seen: this.frame
			};
		}
		const spot = this.place(w, h, must);
		const data = this.paint(l, font, left, asc, w, h);
		spot.page.patches.push({ x: spot.x, y: spot.y, w, h, data });
		const texture = new this.P.Texture({
			source: spot.page.source,
			frame: new this.P.Rectangle(spot.x, spot.y, w, h)
		});
		const r: Raster = {
			key,
			size,
			page: spot.page,
			shelf: spot.shelf,
			texture,
			ox,
			oy,
			uses: 1,
			seen: this.frame
		};
		this.rasters.set(key, r);
		return r;
	}

	/** Whether big raster `r` holds all of its label that is on screen. */
	private covers(r: Raster, n: Need, W: number, H: number, dpr: number): boolean {
		const c = r.clip!;
		// Where its drawn part is on screen, and where the label is, in device px.
		const k = n.size / r.size;
		const x0 = n.x * dpr + r.ox * k;
		const y0 = n.y * dpr + r.oy * k;
		const x1 = x0 + (c.x1 - c.x0) * k;
		const y1 = y0 + (c.y1 - c.y0) * k;
		const vx0 = Math.max(0, n.x * dpr);
		const vy0 = Math.max(0, n.y * dpr);
		const vx1 = Math.min(W * dpr, (n.x + n.w) * dpr);
		const vy1 = Math.min(H * dpr, (n.y + n.h) * dpr);
		return x0 <= vx0 + 1 && y0 <= vy0 + 1 && x1 >= vx1 - 1 && y1 >= vy1 - 1;
	}

	/**
	 * Draws `l` with its pen at (`penX`, `penY`) on a `w` × `h` canvas and returns its coverage:
	 * per channel for a subpixel raster, else the same in all four.
	 */
	private paint(
		l: LabelImpl,
		font: string,
		penX: number,
		penY: number,
		w: number,
		h: number
	): Uint8ClampedArray {
		const big = w > PAGE || h > SHELF_MAX;
		let ctx = l.lcd ? this.lcdCtx : this.grayCtx;
		if (big) {
			const c = document.createElement('canvas');
			c.width = w;
			c.height = h;
			ctx = c.getContext('2d', { alpha: !l.lcd, willReadFrequently: true })!;
		}
		const fg = [(l.color >> 16) & 255, (l.color >> 8) & 255, l.color & 255];
		// For subpixel coverage, a ground far from the text in each channel, to read it back from.
		const ground = fg.map((c) => (c < 128 ? 255 : 0));
		this.font(ctx, font);
		ctx.textBaseline = 'alphabetic';
		ctx.textAlign = 'left';
		if (l.lcd) {
			ctx.fillStyle = `rgb(${ground.join(',')})`;
			ctx.fillRect(0, 0, w, h);
		} else ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = `rgb(${fg.join(',')})`;
		if (l.glyph) {
			// Centred on the line, as the names' flex rows centre it; size px is the font size.
			const size = parseFloat(font.split(' ')[1]);
			const fm = this.metricsOf(l.weight);
			const em = GLYPH_EM * size;
			const top = penY - ((fm.ascent - fm.descent) * size) / 2 - em / 2;
			ctx.save();
			ctx.translate(penX, top);
			ctx.scale(em / 24, em / 24);
			ctx.strokeStyle = ctx.fillStyle;
			ctx.lineWidth = 2.2;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			for (const d of GLYPHS[l.glyph]) ctx.stroke(new Path2D(d));
			ctx.restore();
			penX += (GLYPH_EM + GLYPH_GAP) * size;
		}
		ctx.fillText(l.text, penX, penY);
		const img = ctx.getImageData(0, 0, w, h);
		const d = img.data;
		if (l.lcd) {
			const scale = fg.map((c, i) => 255 / (c - ground[i]));
			const [sr, sg, sb] = scale;
			const [gr, gg, gb] = ground;
			for (let i = 0; i < d.length; i += 4) {
				const r = (d[i] - gr) * sr;
				const g = (d[i + 1] - gg) * sg;
				const b = (d[i + 2] - gb) * sb;
				d[i] = r;
				d[i + 1] = g;
				d[i + 2] = b;
				d[i + 3] = r > g ? (r > b ? r : b) : g > b ? g : b;
			}
		} else for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = d[i + 3];
		return d;
	}

	/** Room for a `w` × `h` raster: on a shelf of its height, a new shelf, a new page, or an emptied one. */
	private place(
		w: number,
		h: number,
		must: Need[]
	): { page: Page; shelf: Shelf; x: number; y: number } {
		const sh = Math.ceil(h / 4) * 4;
		for (const page of this.pages) {
			if (page.big) continue;
			for (const s of page.shelves) if (s.h === sh && s.x + w <= PAGE) return this.take(page, s, w);
		}
		for (const page of this.pages)
			if (!page.big && page.top + sh <= PAGE) return this.take(page, this.shelf(page, sh), w);
		const atlas = this.pages.filter((p) => !p.big);
		if (atlas.length < MAX_PAGES) {
			const page = this.newPage(PAGE, PAGE, false);
			return this.take(page, this.shelf(page, sh), w);
		}
		// Full: empty the page least seen on screen lately, and draw its texts on screen again.
		const age = (p: Page) => {
			let n = 0;
			for (const r of this.rasters.values()) if (r.page === p && r.seen === this.frame) n++;
			return n;
		};
		const page = atlas.reduce((a, b) => (age(b) < age(a) ? b : a));
		for (const l of this.labels)
			if (l.raster?.page === page && l.seen === this.frame && l.need) must.push(l.need);
		this.evict(page);
		return this.take(page, this.shelf(page, sh), w);
	}

	private shelf(page: Page, h: number): Shelf {
		const s: Shelf = { y: page.top, h, x: 0, live: 0 };
		page.top += h;
		page.shelves.push(s);
		return s;
	}

	private take(page: Page, shelf: Shelf, w: number) {
		const x = shelf.x;
		shelf.x += w;
		shelf.live++;
		return { page, shelf, x, y: shelf.y };
	}

	private newPage(w: number, h: number, big: boolean): Page {
		const source = new this.P.TextureSource({
			width: w,
			height: h,
			resolution: 1,
			format: 'rgba8unorm',
			alphaMode: 'premultiplied-alpha',
			scaleMode: 'linear',
			addressMode: 'clamp-to-edge',
			autoGenerateMipmaps: false
		});
		source.uploadMethodId = UPLOAD;
		const page: Page = {
			source,
			shelves: [],
			top: 0,
			patches: [],
			uploaded: false,
			lost: false,
			big,
			bytes: w * h * 4
		};
		this.pageOf.set(source, page);
		this.pages.push(page);
		return page;
	}

	/** Empties `page`: every raster on it is dropped, and its labels drawn again when on screen. */
	private evict(page: Page) {
		page.lost = false;
		for (const l of this.labels) if (l.raster?.page === page) l.show(undefined);
		if (page.big) return this.dropPage(page);
		for (const [key, r] of this.rasters)
			if (r.page === page) {
				r.texture.destroy(false);
				this.rasters.delete(key);
			}
		page.shelves = [];
		page.top = 0;
	}

	/** One label less shows `r`; with none left, its room is freed. */
	private release(r: Raster) {
		if (--r.uses > 0) return;
		r.texture.destroy(false);
		if (r.clip) {
			this.dropPage(r.page);
			return;
		}
		if (this.rasters.get(r.key) !== r) return;
		this.rasters.delete(r.key);
		const s = r.shelf!;
		if (--s.live > 0) return;
		s.x = 0;
		const { shelves } = r.page;
		// Empty shelves at the bottom of the page give their room back.
		while (shelves.length && shelves[shelves.length - 1].live === 0) {
			r.page.top = shelves.pop()!.y;
		}
	}

	private dropPage(p: Page) {
		const i = this.pages.indexOf(p);
		if (i >= 0) this.pages.splice(i, 1);
		p.source.destroy();
	}

	// ---------------------------------------------------------------- GPU

	/** Uploads what was drawn on a page since the last upload (PixiJS calls it on `source.update()`). */
	private upload(source: TextureSource, glTexture: GlTex, gl: WebGL2RenderingContext) {
		const page = this.pageOf.get(source);
		if (!page) return;
		const w = source.pixelWidth;
		const h = source.pixelHeight;
		if (glTexture.width !== w || glTexture.height !== h) {
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				glTexture.internalFormat,
				w,
				h,
				0,
				glTexture.format,
				glTexture.type,
				null
			);
			glTexture.width = w;
			glTexture.height = h;
			if (page.uploaded) page.lost = true;
		}
		for (const p of page.patches)
			gl.texSubImage2D(
				gl.TEXTURE_2D,
				0,
				p.x,
				p.y,
				p.w,
				p.h,
				glTexture.format,
				glTexture.type,
				p.data
			);
		page.patches.length = 0;
		page.uploaded = true;
	}

	/** Adds the text blend to PixiJS's blend modes (they are made anew with each GL context). */
	private ensureBlend() {
		if (!this.lcd) return;
		const state = (this.renderer as WebGLRenderer).state as unknown as {
			blendModesMap: Record<string, number[]>;
			gl: WebGL2RenderingContext;
		};
		if (state.blendModesMap[BLEND]) return;
		const gl = state.gl;
		const ext = gl.getExtension('WEBGL_blend_func_extended')!;
		state.blendModesMap[BLEND] = [
			gl.ONE,
			ext.ONE_MINUS_SRC1_COLOR_WEBGL,
			gl.ONE,
			ext.ONE_MINUS_SRC1_ALPHA_WEBGL
		];
	}
}

interface GlTex {
	width: number;
	height: number;
	internalFormat: number;
	format: number;
	type: number;
}

interface Need {
	l: LabelImpl;
	/** Font size on screen, in device px. */
	size: number;
	/** Its line box on screen, in CSS px. */
	x: number;
	y: number;
	w: number;
	h: number;
	/** Distance from the middle of the screen. */
	d: number;
}

interface World {
	a: number;
	d: number;
	tx: number;
	ty: number;
}
const IDENTITY: World = { a: 1, d: 1, tx: 0, ty: 0 };

/** `c`'s transform to the screen (scale and offset; nothing here rotates), or null if hidden. */
function worldOf(c: Container, cache: Map<Container, World | null>): World | null {
	let w = cache.get(c);
	if (w !== undefined) return w;
	if (!c.visible || !c.renderable || c.alpha <= 0) w = null;
	else {
		const p = c.parent ? worldOf(c.parent, cache) : IDENTITY;
		w = p && {
			a: p.a * c.scale.x,
			d: p.d * c.scale.y,
			tx: p.a * (c.x - c.pivot.x * c.scale.x) + p.tx,
			ty: p.d * (c.y - c.pivot.y * c.scale.y) + p.ty
		};
	}
	cache.set(c, w);
	return w;
}

type LabelImpl = InstanceType<ReturnType<typeof makeLabelClass>>;

function makeLabelClass(P: Pixi) {
	return class Label extends P.Container implements GlLabel {
		raster: Raster | undefined;
		/** The last frame it was on screen, and what it needed then. */
		seen = 0;
		need: Need | undefined;
		private _px: number;
		/** The entity glyph it is, if it is one alone (see GLYPHS). */
		glyph: string | undefined = undefined;
		/** Room before its text, in em, for the parts drawn there (see GlTextLayer.label). */
		lead = 0;
		/** Its glyph and change mark, each placed `at` em from its origin. */
		private readonly parts: { l: LabelImpl; at: number; op?: Container }[] = [];
		/** Text width per px of font size, measured at the size it was made with when first asked. */
		private perPx = -1;
		private readonly px0: number;

		constructor(
			private readonly layer: GlTextLayer,
			readonly text: string,
			readonly color: number,
			readonly weight: number,
			readonly lcd: boolean,
			px: number,
			private readonly sprite: Sprite
		) {
			super();
			this._px = this.px0 = px;
			sprite.tint = color;
			this.addChild(sprite);
		}

		get px() {
			return this._px;
		}
		set px(v: number) {
			if (v === this._px) return;
			this._px = v;
			this.fit();
			this.place();
		}

		/** Its text's width (or its glyph's, if it is one alone) at `px`. */
		get advance() {
			if (this.perPx < 0)
				this.perPx = this.glyph
					? GLYPH_EM
					: this.px0 > 0
						? this.layer.measure(this.text, this.weight, this.px0) / this.px0
						: 0;
			return this.perPx * this._px;
		}

		override get width() {
			return this.lead * this._px + this.advance;
		}
		override set width(_: number) {}

		/** Adds its glyph, `at` em from its origin. */
		addPart(l: GlLabel, at: number) {
			this.parts.push({ l: l as LabelImpl, at });
			this.addChild(l);
			this.place();
		}

		/** Adds its change mark: badge `bg`, drawn 1 px to the em, and text `t` centred on it. */
		addOp(bg: Container, t: GlLabel, at: number) {
			this.parts.push({ l: t as LabelImpl, at, op: bg });
			this.addChild(bg, t);
			this.place();
		}

		/** Places its parts for its size, each centred on the line as a flex row centres it. */
		private place() {
			const px = this._px;
			for (const p of this.parts) {
				if (!p.op) {
					p.l.px = px;
					p.l.position.set(p.at * px, 0);
					continue;
				}
				p.op.scale.set(px);
				p.op.position.set(p.at * px, (LINE / 2) * px);
				p.l.px = OP_EM * px;
				p.l.position.set(
					(p.at + OP_BOX / 2) * px - p.l.width / 2,
					((LINE - LINE * OP_EM) / 2) * px
				);
			}
		}

		/** Shows raster `r`, or none; releasing the one it showed is the layer's part. */
		show(r: Raster | undefined) {
			this.raster = r;
			this.sprite.visible = !!r;
			if (r) this.sprite.texture = r.texture;
			this.fit();
		}

		/** Sizes the sprite so one texel of its raster is one device px at the raster's size. */
		private fit() {
			const r = this.raster;
			if (!r) return;
			const k = this._px / r.size;
			this.sprite.scale.set(k);
			this.sprite.position.set(r.ox * k, r.oy * k);
		}

		override destroy(options?: Parameters<Container['destroy']>[0]) {
			for (const p of this.parts) {
				p.op?.destroy();
				p.l.destroy();
			}
			this.parts.length = 0;
			this.layer.forget(this);
			super.destroy(options);
		}
	};
}

// -------------------------------------------------------------------- batcher

let registered = false;

/**
 * A batcher like PixiJS's default one, whose shader writes a second colour, the coverage per
 * channel, for the dual-source blend set up in `ensureBlend`.
 */
function registerBatcher(P: Pixi) {
	if (registered) return;
	registered = true;
	const shaders = new Map<number, Shader>();
	const shaderFor = (max: number) => {
		let s = shaders.get(max);
		if (!s) {
			const glProgram = new P.GlProgram({
				vertex: VERTEX,
				fragment: fragment(max),
				name: 'sdv-text'
			});
			// PixiJS puts its own header (precision, name) above the source, but an #extension
			// must come first: use the source as written.
			Object.assign(glProgram, { vertex: VERTEX, fragment: fragment(max) });
			s = new P.Shader({
				glProgram,
				resources: { batchSamplers: P.getBatchSamplersUniformGroup(max) }
			});
			shaders.set(max, s);
		}
		return s;
	};
	class TextBatcher extends P.DefaultBatcher {
		static override extension = { type: [P.ExtensionType.Batcher], name: BLEND } as never;
		constructor(options: { maxTextures: number }) {
			super(options);
			(this as { name: string }).name = BLEND;
			this.shader = shaderFor(options.maxTextures);
		}
		override _updateMaxTextures(max: number) {
			this.shader = shaderFor(max);
		}
	}
	P.extensions.add(TextBatcher);
}

const VERTEX = /* glsl */ `#version 300 es
precision highp float;
in vec2 aPosition;
in vec2 aUV;
in vec4 aColor;
in vec2 aTextureIdAndRound;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec2 uResolution;
out vec2 vUV;
out vec4 vColor;
out float vTextureId;
void main(void) {
	mat3 m = uProjectionMatrix * uWorldTransformMatrix;
	gl_Position = vec4((m * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
	if (aTextureIdAndRound.x == 1.0) {
		gl_Position.xy = (floor(((gl_Position.xy * 0.5 + 0.5) * uResolution) + 0.5) / uResolution) * 2.0 - 1.0;
	}
	vTextureId = aTextureIdAndRound.y;
	vUV = aUV;
	vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uWorldColorAlpha;
}
`;

function fragment(max: number) {
	let sample = '';
	for (let i = 0; i < max; i++)
		sample += `${i ? 'else ' : ''}${i < max - 1 ? `if (vTextureId < ${i}.5) ` : ''}c = texture(uTextures[${i}], vUV);\n`;
	return /* glsl */ `#version 300 es
#extension GL_EXT_blend_func_extended : require
precision mediump float;
precision mediump sampler2D;
in vec2 vUV;
in vec4 vColor;
in float vTextureId;
uniform sampler2D uTextures[${max}];
layout(location = 0, index = 0) out vec4 finalColor;
layout(location = 0, index = 1) out vec4 coverage;
void main(void) {
	vec4 c;
	${sample}
	finalColor = vec4(vColor.rgb * c.rgb, vColor.a * c.a);
	coverage = vColor.a * c;
}
`;
}

/**
 * Text for the WebGL renderer that stays crisp at any scale: glyphs are signed distance fields
 * (SDF) made at runtime from the page's font with tiny-sdf, packed into atlas pages as they
 * are first used, and drawn by PixiJS's BitmapText with its distance-field shader (its
 * coverage made plain, see useSharpShader).
 *
 * PixiJS finds a bitmap font by its family name in its asset cache (`<family>-bitmap`) and
 * calls `ensureCharacters(text)` on it before laying out each text, so a font registered there
 * under a made-up family name grows by the glyphs each new text needs. Its shader takes a
 * texture whose colour is the distance (edge at 0.5) and alpha is 1, and sets its edge
 * softness per text from the text's scale and the font's `distanceField.range`.
 */
import TinySDF from '@mapbox/tiny-sdf';
import type { BitmapText, BufferImageSource, CharData, Texture } from 'pixi.js';

type Pixi = typeof import('pixi.js');

/** A text's size at scale 1, in px; glyphs are drawn into the atlas at this size too. */
export const GLYPH_PX = 48;
/** Room around a glyph's ink in its atlas cell, in texels; it also keeps mipmaps from bleeding. */
const BUFFER = 8;
/**
 * Texels of distance the field spans, half inside the edge and half outside; the outer half
 * fills BUFFER. A wide field keeps a one-pixel edge down to text RADIUS / GLYPH_PX px high.
 */
const RADIUS = 16;
/** Side of an atlas page, in texels. */
const PAGE = 1024;

/** A text object drawn crisply at any scale. Its size at scale 1 is GLYPH_PX px; callers set scale = px / GLYPH_PX and tint. */
export function glText(P: Pixi, text: string, opts: { bold?: boolean } = {}): BitmapText {
	const family = sdfFont(P, getComputedStyle(document.body).fontFamily, !!opts.bold);
	return new P.BitmapText({ text, style: { fontFamily: family, fontSize: GLYPH_PX } });
}

/** Family names of the distance-field fonts registered with PixiJS. */
const registered = new Set<string>();

/**
 * The family name of the distance-field font for this page font and weight, made on first use.
 * The name is the font itself, so a reloaded module (as in development) finds its fonts again.
 */
function sdfFont(P: Pixi, family: string, bold: boolean): string {
	const weight = bold ? 'bold' : 'normal';
	const name = `sdv-sdf ${weight} ${family}`;
	if (registered.has(name)) return name;
	registered.add(name);
	useSharpShader(P);
	if (!P.Cache.has(`${name}-bitmap`)) {
		const font = new (sdfFontClass(P))(name, family, weight);
		P.Cache.set(`${name}-bitmap`, font);
		// Most text is ASCII: draw it at once, so it lands in the atlas before its first upload.
		font.ensureCharacters(ASCII);
	}
	return name;
}

/**
 * PixiJS's distance-field shader brightens a light text's edges (a gamma of up to 1/2.2 on its
 * coverage), which makes small light text on a dark ground run together into blobs. Its
 * BitmapText pipe makes the shader per text in `getSdfShader`; this swaps in programs whose
 * coverage is the plain distance across one device pixel, as the bitmap text it replaces had.
 */
function useSharpShader(P: Pixi) {
	const pipe = P.BitmapTextPipe.prototype as unknown as {
		getSdfShader(this: { _renderer: import('pixi.js').Renderer }): import('pixi.js').SdfShader;
		sharp?: true;
	};
	if (pipe.sharp) return;
	pipe.sharp = true;
	const made = pipe.getSdfShader;
	const programs = new Map<number, [import('pixi.js').GlProgram, import('pixi.js').GpuProgram]>();
	pipe.getSdfShader = function () {
		const shader = made.call(this);
		const max = this._renderer.limits.maxBatchableTextures;
		let p = programs.get(max);
		if (!p) {
			const gl = [
				P.colorBitGl,
				P.generateTextureBatchBitGl(max),
				P.localUniformMSDFBitGl,
				{ name: 'msdf-bit', fragment: { header: SHARP_GLSL } },
				P.roundPixelsBitGl
			];
			const gpu = [
				P.colorBit,
				P.generateTextureBatchBit(max),
				P.localUniformMSDFBit,
				{ name: 'msdf-bit', fragment: { header: SHARP_WGSL } },
				P.roundPixelsBit
			];
			p = [
				P.compileHighShaderGlProgram({ name: 'sdv-sdf-shader', bits: gl }),
				P.compileHighShaderGpuProgram({ name: 'sdv-sdf-shader', bits: gpu })
			];
			programs.set(max, p);
		}
		[shader.glProgram, shader.gpuProgram] = p;
		return shader;
	};
}

/**
 * Coverage from a distance texel: `distance` is device px per unit of field value. Text too
 * small for the field to span a pixel takes the field itself as coverage, so the empty ground
 * around a glyph stays empty.
 */
const SHARP_GLSL = /* glsl */ `
	float calculateMSDFAlpha(vec4 msdfColor, vec4 shapeColor, float distance) {
		float d = min(msdfColor.r, msdfColor.a);
		return shapeColor.a * clamp(max(distance, 1.0) * (d - 0.5) + 0.5, 0.0, 1.0);
	}
`;
const SHARP_WGSL = /* wgsl */ `
	fn calculateMSDFAlpha(msdfColor:vec4<f32>, shapeColor:vec4<f32>, distance:f32) -> f32 {
		let d = min(msdfColor.r, msdfColor.a);
		return shapeColor.a * clamp(max(distance, 1.0) * (d - 0.5) + 0.5, 0.0, 1.0);
	}
`;

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

interface Page {
	texture: Texture;
	data: Uint8Array;
	/** Rows written since the last upload. */
	dirty: [number, number] | undefined;
}

let fontClass: ReturnType<typeof makeFontClass> | undefined;
const sdfFontClass = (P: Pixi) => (fontClass ??= makeFontClass(P));

function makeFontClass(P: Pixi) {
	return class SdfFont extends P.AbstractBitmapFont<unknown> {
		declare pages: Page[];
		private readonly sdf: TinySDF;
		/** The canvas tiny-sdf draws on; its transform shifts ink that hangs left of the pen. */
		private readonly draw: CanvasRenderingContext2D;
		/** Measures text in the font, as the canvas did before tiny-sdf's measure was replaced. */
		private readonly measure: (text: string) => TextMetrics;
		/** What tiny-sdf is told of the next glyph it draws. */
		private next: Partial<TextMetrics> = {};
		private readonly ascent: number;
		/** Texts and adjacent pairs of characters already seen. */
		private readonly seen = new Set<string>();
		private readonly pairs = new Set<string>();
		private x = 0;
		private y = 0;
		private rowHeight = 0;

		constructor(name: string, family: string, weight: string) {
			super();
			this.sdf = new TinySDF({
				fontSize: GLYPH_PX,
				buffer: BUFFER,
				radius: RADIUS,
				cutoff: 0.5,
				fontFamily: family,
				fontWeight: weight
			});
			this.draw = (this.sdf as unknown as { ctx: CanvasRenderingContext2D }).ctx;
			this.measure = this.draw.measureText.bind(this.draw);
			// tiny-sdf sizes a glyph by its ink right of the pen less its ink left of it, so it
			// clips glyphs that hang left (a j); it is told of the ink as shifted right of the pen.
			this.draw.measureText = () => this.next as TextMetrics;
			const metrics = P.CanvasTextMetrics.measureFont(`${weight} ${GLYPH_PX}px ${family}`);
			this.ascent = metrics.ascent;
			Object.assign(this, {
				fontFamily: name,
				fontMetrics: metrics,
				lineHeight: metrics.fontSize,
				baseLineOffset: 0,
				baseMeasurementFontSize: GLYPH_PX,
				baseRenderedFontSize: GLYPH_PX,
				applyFillAsTint: true,
				// PixiJS sets the edge's softness from this and the text's scale, which leaves
				// out the screen's pixel ratio: fold it in, so edges are one device pixel soft.
				distanceField: { type: 'sdf', range: RADIUS * (globalThis.devicePixelRatio || 1) }
			});
		}

		/** Adds the glyphs `text` needs, and the kerning between its neighbouring characters. */
		ensureCharacters(text: string) {
			if (this.seen.has(text)) return;
			this.seen.add(text);
			let prev: string | undefined;
			for (const ch of P.CanvasTextMetrics.graphemeSegmenter(text)) {
				if (!(ch in this.chars)) this.addGlyph(ch);
				if (prev !== undefined) this.kern(prev, ch);
				prev = ch;
			}
			this.upload();
		}

		private addGlyph(ch: string) {
			const ctx = this.draw;
			const m = this.measure(ch);
			const char: CharData = {
				id: ch.codePointAt(0) ?? 0,
				xOffset: 0,
				yOffset: 0,
				xAdvance: m.width,
				kerning: {}
			};
			this.chars[ch] = char;
			if (/^\s$/.test(ch)) return;
			// tiny-sdf draws from the pen at the cell's buffer and keeps only what is right of it.
			const left = Math.max(0, Math.ceil(m.actualBoundingBoxLeft));
			this.next = {
				width: m.width,
				actualBoundingBoxAscent: m.actualBoundingBoxAscent,
				actualBoundingBoxDescent: m.actualBoundingBoxDescent,
				actualBoundingBoxLeft: 0,
				actualBoundingBoxRight: m.actualBoundingBoxRight + left
			};
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
			ctx.translate(left, 0);
			const g = this.sdf.draw(ch);
			if (!g.glyphWidth || !g.glyphHeight) return;
			const page = this.place(g.width, g.height);
			const { data } = page;
			for (let row = 0; row < g.height; row++) {
				let o = ((this.y + row) * PAGE + this.x) * 4;
				for (let i = row * g.width, end = i + g.width; i < end; i++, o += 4)
					data[o] = data[o + 1] = data[o + 2] = g.data[i];
			}
			page.dirty = [
				Math.min(page.dirty?.[0] ?? this.y, this.y),
				Math.max(page.dirty?.[1] ?? 0, this.y + g.height)
			];
			char.texture = new P.Texture({
				source: page.texture.source,
				frame: new P.Rectangle(this.x, this.y, g.width, g.height)
			});
			char.xOffset = -BUFFER - left;
			char.yOffset = this.ascent - g.glyphTop - BUFFER;
			this.x += g.width;
		}

		/** The page to put a w × h cell at (this.x, this.y), moving on a row or a page if full. */
		private place(w: number, h: number): Page {
			if (this.x + w > PAGE) {
				this.x = 0;
				this.y += this.rowHeight;
				this.rowHeight = 0;
			}
			if (!this.pages.length || this.y + h > PAGE) {
				this.pages.push(newPage(P));
				this.x = this.y = this.rowHeight = 0;
			}
			this.rowHeight = Math.max(this.rowHeight, h);
			return this.pages[this.pages.length - 1];
		}

		private kern(a: string, b: string) {
			const pair = a + b;
			if (this.pairs.has(pair)) return;
			this.pairs.add(pair);
			const amount = this.measure(pair).width - this.chars[a].xAdvance - this.chars[b].xAdvance;
			if (Math.abs(amount) > 0.01) this.chars[b].kerning[a] = amount;
		}

		/** Sends the rows of each page written since the last upload to the GPU. */
		private upload() {
			for (const page of this.pages)
				if (page.dirty) {
					(page.texture.source as BufferImageSource).update(
						page.dirty[0] * PAGE,
						page.dirty[1] * PAGE
					);
					page.dirty = undefined;
				}
		}
	};
}

function newPage(P: Pixi): Page {
	const data = new Uint8Array(PAGE * PAGE * 4);
	// Far outside every glyph, with an alpha of 1 (the shader takes the lesser of colour and alpha).
	for (let i = 3; i < data.length; i += 4) data[i] = 255;
	const source = new P.BufferImageSource({
		resource: data,
		width: PAGE,
		height: PAGE,
		format: 'rgba8unorm',
		alphaMode: 'no-premultiply-alpha',
		autoGenerateMipmaps: true,
		mipLevelCount: Math.log2(PAGE) + 1,
		scaleMode: 'linear',
		mipmapFilter: 'linear',
		addressMode: 'clamp-to-edge'
	});
	return { texture: new P.Texture({ source }), data, dirty: undefined };
}

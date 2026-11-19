/**
 * Connection lines for the WebGL renderer, drawn by a shader so that zooming rebuilds nothing.
 *
 * A layer of lines is one PixiJS Mesh. Its vertices sit on the lines' points in canvas px and
 * carry, beside them, everything that keeps its size on screen in screen px: how far the vertex
 * moves out to the line's edge (miter joins, butt caps), how far a line's end draws back under
 * its head, the head's corners. The vertex shader takes the zoom from the mesh's world
 * transform and divides those screen px by it, so the camera moving changes a matrix and no
 * vertex. The fragment shader draws dashes in screen px from the distance along the line,
 * smooths each line's sides from its distance to the centre in device px, and leaves out a
 * line's body where its head covers it, so a faded line is not darker under its head.
 *
 * Each segment is its own quad, cut on the miter at either end, so the distance along it is
 * exact across its width and dashes end square. Per line, in order: its halo (the same path
 * wider, in the canvas colour), its body, its head; the mesh draws them in that order, so a
 * later line's halo cuts through an earlier line where they cross, as each line drawn on its
 * own would.
 */
import type { Buffer, Geometry, Mesh, Shader } from 'pixi.js';
import type { Point } from '#lib/landscape/route.ts';
import type { Token } from '#lib/theme/tokens.ts';

type Pixi = typeof import('pixi.js');

/** What a line looks like; widths, dashes and heads in screen px, points in canvas px. */
export interface LineSpec {
	points: readonly Point[];
	width: number;
	color: Token;
	/** An arrow at the end or a diamond at the start. */
	head?: 'arrow' | 'diamond';
	/** Width of the halo in the canvas colour under the line. */
	halo?: number;
	/** Dash and gap. */
	dash?: readonly [number, number];
	/** Faded, as lines at rest are while something is looked at. */
	dim?: boolean;
}

/** Heads in screen px: length along the line and width across it. */
export const HEADS = {
	arrow: { length: 10, width: 8 },
	diamond: { length: 16, width: 10 }
} as const;
/** How far a line's body runs into its head, in screen px, so a wide line does not blunt the tip. */
export const HEAD_INSET = 5;
const DIM_ALPHA = 0.25;
/** Room beyond a line's edge for its smoothed edge, in screen px (at least half a device px). */
const FRINGE = 1;
/** A miter longer than this many half widths (a near reversal) is cut short. */
const MITER_LIMIT = 4;
/** No cut: a value far below any distance. */
const NO_CUT = -1e6;
/** A diamond's two triangles, from its tip round. */
const DIAMOND = [0, 1, 2, 0, 2, 3];

/**
 * A vertex, in floats: position (canvas px), offset (screen px), shift (unit direction, the
 * canvas px it may move, the sign it moves the distance by), edge (distance from the centre
 * and half width, screen px), along (distance along the line in canvas px, plus screen px),
 * dash (dash, gap, phase), head (+1 or -1 towards the tip, where the tip is along the line,
 * how much of the body the head covers in screen px, its segment's length), colour (four
 * bytes).
 */
const F = { offset: 2, shift: 4, edge: 8, along: 10, dash: 12, head: 15, colour: 19 } as const;
export const STRIDE = 20;

/** A layer's vertices and indices, kept and grown across builds. */
export class LineBuffers {
	vertices = new Float32Array(0);
	/** The vertices' bytes as 32-bit words, for the packed colours. */
	words = new Uint32Array(0);
	indices = new Uint32Array(0);
	vertexCount = 0;
	indexCount = 0;

	/** Makes room for `v` vertices and `i` indices; true if the arrays were replaced. */
	reserve(v: number, i: number): boolean {
		let grew = false;
		if (this.vertices.length < v * STRIDE) {
			this.vertices = new Float32Array(grow(v) * STRIDE);
			this.words = new Uint32Array(this.vertices.buffer);
			grew = true;
		}
		if (this.indices.length < i) {
			this.indices = new Uint32Array(grow(i));
			grew = true;
		}
		return grew;
	}
}
const grow = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(n, 256)));

// A line's points with repeats dropped, the distance along it to each in canvas px, and the
// miter at each, in half widths.
let xs = new Float64Array(64);
let ys = new Float64Array(64);
let ds = new Float64Array(64);
let mxs = new Float64Array(64);
let mys = new Float64Array(64);

function clean(points: readonly Point[]): number {
	if (xs.length < points.length) {
		const n = grow(points.length);
		[xs, ys, ds, mxs, mys] = [1, 2, 3, 4, 5].map(() => new Float64Array(n));
	}
	let n = 0;
	for (const p of points) {
		if (n && p.x === xs[n - 1] && p.y === ys[n - 1]) continue;
		xs[n] = p.x;
		ys[n] = p.y;
		ds[n] = n ? ds[n - 1] + Math.hypot(p.x - xs[n - 1], p.y - ys[n - 1]) : 0;
		n++;
	}
	for (let i = 0; i < n; i++) {
		// Unit directions of the segments before (a) and after (b) point i; one at either end.
		const i0 = i > 0 ? i - 1 : 0;
		const i1 = i < n - 1 ? i + 1 : n - 1;
		let ax = (xs[i] - xs[i0]) / (ds[i] - ds[i0] || 1);
		let ay = (ys[i] - ys[i0]) / (ds[i] - ds[i0] || 1);
		let bx = (xs[i1] - xs[i]) / (ds[i1] - ds[i] || 1);
		let by = (ys[i1] - ys[i]) / (ds[i1] - ds[i] || 1);
		if (i === 0) [ax, ay] = [bx, by];
		else if (i === n - 1) [bx, by] = [ax, ay];
		// Between the normals (left of travel), as long as reaches both edges.
		let mx = -ay - by;
		let my = ax + bx;
		const ml = Math.hypot(mx, my);
		if (ml < 1e-9) [mx, my] = [-ay, ax];
		else {
			const scale = Math.min(MITER_LIMIT, ml / (my * ax - mx * ay)) / ml;
			mx *= scale;
			my *= scale;
		}
		mxs[i] = mx;
		mys[i] = my;
	}
	return n;
}

/** The colour `rgba` with its alpha scaled by `a`, as four bytes (r first). */
function fade(rgba: number, a: number): number {
	if (a === 1) return rgba;
	return ((rgba & 0xffffff) | (Math.round((rgba >>> 24) * a) << 24)) >>> 0;
}

/**
 * Fills `out` with the triangles of `lines`, in order; true if its arrays were replaced. `rgba`
 * gives a token's colour as four bytes, red in the lowest (see `tokenRgba`).
 */
export function buildLines(
	lines: readonly LineSpec[],
	rgba: (t: Token) => number,
	out: LineBuffers
): boolean {
	let nv = 0;
	let ni = 0;
	for (const l of lines) {
		const n = l.points.length;
		if (n < 2) continue;
		const strips = l.halo ? 2 : 1;
		nv += strips * 4 * (n - 1) + 4;
		ni += strips * 6 * (n - 1) + 6;
	}
	const grew = out.reserve(nv, ni);
	const v = out.vertices;
	const w = out.words;
	const ix = out.indices;
	let vc = 0;
	let ic = 0;

	/** Writes one vertex at (x, y), moved `ox`, `oy` screen px, and returns its index. */
	const vertex = (
		x: number,
		y: number,
		ox: number,
		oy: number,
		side: number,
		half: number,
		colour: number
	) => {
		const k = vc * STRIDE;
		v.fill(0, k, k + STRIDE);
		v[k] = x;
		v[k + 1] = y;
		v[k + F.offset] = ox;
		v[k + F.offset + 1] = oy;
		v[k + F.edge] = side;
		v[k + F.edge + 1] = half;
		v[k + F.head + 2] = NO_CUT;
		w[k + F.colour] = colour;
		return vc++;
	};

	/**
	 * Quads along the cleaned points, `hw` screen px either side of them, mitered; for a line's
	 * body, with its head (where its end draws back, what the head covers) and dash.
	 */
	const strip = (
		n: number,
		hw: number,
		colour: number,
		head: LineSpec['head'],
		dash: LineSpec['dash']
	) => {
		const e = hw + FRINGE;
		const total = ds[n - 1];
		// How far from its tip the head covers the whole width of the body, in screen px.
		const hl = head ? HEADS[head].length : 0;
		const covered =
			head === 'arrow' ? hl : head ? hl - (hl / 2) * (hw / (HEADS[head].width / 2)) : 0;
		// The segment the head is on, in canvas px.
		const headSeg = head === 'arrow' ? total - ds[n - 2] : head ? ds[1] : 0;
		for (let s = 0; s < n - 1; s++) {
			const len = ds[s + 1] - ds[s];
			const ux = (xs[s + 1] - xs[s]) / len;
			const uy = (ys[s + 1] - ys[s]) / len;
			const first = vc;
			for (let i = s; i <= s + 1; i++) {
				// A route may double back on itself; there the miter is the incoming normal, which
				// for the segment going back lies on its other side.
				const flip = mys[i] * ux - mxs[i] * uy < 0 ? -e : e;
				const ox = mxs[i] * flip;
				const oy = mys[i] * flip;
				// How far the miter moves the edge along this segment, in screen px.
				const along = ox * ux + oy * uy;
				for (const sign of SIDES) {
					const k = vertex(xs[i], ys[i], sign * ox, sign * oy, sign * e, hw, colour) * STRIDE;
					if (!head && !dash) continue;
					// The end under the head draws back HEAD_INSET px, never past its segment's other end.
					if ((head === 'arrow' && i === n - 1) || (head === 'diamond' && i === 0)) {
						const toward = head === 'arrow' ? -1 : 1;
						v[k + F.shift] = toward * ux;
						v[k + F.shift + 1] = toward * uy;
						v[k + F.shift + 2] = headSeg;
						v[k + F.shift + 3] = toward;
					}
					v[k + F.along] = ds[i];
					v[k + F.along + 1] = sign * along;
					v[k + F.dash] = dash?.[0] ?? 0;
					v[k + F.dash + 1] = dash?.[1] ?? 0;
					// A diamond's line dashes from where it leaves the diamond.
					v[k + F.dash + 2] = head === 'diamond' ? -HEAD_INSET : 0;
					if (head) {
						v[k + F.head] = head === 'arrow' ? -1 : 1;
						v[k + F.head + 1] = head === 'arrow' ? total : 0;
						v[k + F.head + 2] = covered;
						v[k + F.head + 3] = headSeg;
					}
				}
			}
			ix[ic++] = first;
			ix[ic++] = first + 1;
			ix[ic++] = first + 2;
			ix[ic++] = first + 1;
			ix[ic++] = first + 3;
			ix[ic++] = first + 2;
		}
	};

	for (const l of lines) {
		if (l.points.length < 2) continue;
		const n = clean(l.points);
		if (n < 2) continue;
		const a = l.dim ? DIM_ALPHA : 1;
		if (l.halo) strip(n, l.halo / 2, fade(rgba('canvas-bg'), a), undefined, undefined);
		const colour = fade(rgba(l.color), a);
		strip(n, l.width / 2, colour, l.head, l.dash);
		if (!l.head) continue;
		// The head, along the segment it ends: its tip on the line's end (arrow) or start (diamond).
		const { length: hl, width: hw } = HEADS[l.head];
		const end = l.head === 'arrow' ? n - 1 : 0;
		const from = l.head === 'arrow' ? n - 2 : 1;
		const len = Math.abs(ds[end] - ds[from]);
		const ux = (xs[end] - xs[from]) / len;
		const uy = (ys[end] - ys[from]) / len;
		const at = (along: number, side: number) =>
			vertex(xs[end], ys[end], -ux * along - uy * side, -uy * along + ux * side, 0, 1e4, colour);
		const tip = at(0, 0);
		if (l.head === 'arrow') {
			at(hl, hw / 2);
			at(hl, -hw / 2);
			ix[ic++] = tip;
			ix[ic++] = tip + 1;
			ix[ic++] = tip + 2;
		} else {
			at(hl / 2, hw / 2);
			at(hl, 0);
			at(hl / 2, -hw / 2);
			for (const k of DIAMOND) ix[ic++] = tip + k;
		}
	}
	out.vertexCount = vc;
	out.indexCount = ic;
	return grew;
}
const SIDES = [1, -1] as const;

// ------------------------------------------------------------ colours
const rgbaCache = new WeakMap<object, Map<Token, number>>();

/** A token's colour as four bytes, red lowest, as the lines' vertices carry it; cached per theme. */
export function tokenRgba(P: Pixi, values: Record<Token, string>): (t: Token) => number {
	let m = rgbaCache.get(values);
	if (!m) rgbaCache.set(values, (m = new Map()));
	const cache = m;
	return (t) => {
		let c = cache.get(t);
		if (c === undefined) {
			const [r, g, b, a] = new P.Color(values[t]).toArray();
			const byte = (f: number) => Math.round(f * 255);
			c = (byte(r) | (byte(g) << 8) | (byte(b) << 16) | (byte(a) << 24)) >>> 0;
			cache.set(t, c);
		}
		return c;
	};
}

// ------------------------------------------------------------ the shader
const vertex = /* glsl */ `
in vec2 aPosition;
in vec2 aOffset;
in vec4 aShift;
in vec2 aEdge;
in vec2 aAlong;
in vec3 aDash;
in vec4 aHead;
in vec4 aColor;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;

out vec4 vColor;
out vec2 vEdge;
out vec3 vDash;
out float vCut;

void main() {
	mat3 model = uWorldTransformMatrix * uTransformMatrix;
	// Canvas px to screen px: the camera's scale.
	float zoom = length(model[0].xy);
	// An end under a head draws back ${HEAD_INSET} px, never past its segment's other end.
	float pull = min(${HEAD_INSET.toFixed(1)}, aShift.z * zoom);
	vec2 p = aPosition + (aOffset + aShift.xy * pull) / zoom;
	gl_Position = vec4((uProjectionMatrix * model * vec3(p, 1.0)).xy, 0.0, 1.0);
	vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uColor * uWorldColorAlpha;
	vEdge = aEdge;
	// Screen px along the line.
	float s = aAlong.x * zoom + aAlong.y + aShift.w * pull;
	vDash = vec3(s + aDash.z, aDash.xy);
	// Screen px from the head's tip past what the head covers, which stays on its own segment.
	vCut = aHead.x * (s - aHead.y * zoom) - min(aHead.z, aHead.w * zoom);
}
`;

const fragment = /* glsl */ `
in vec4 vColor;
in vec2 vEdge;
in vec3 vDash;
in float vCut;

uniform float uPixel;

out vec4 finalColor;

// How much of a device pixel lies inside an edge d screen px away (inside positive).
float cover(float d) {
	return clamp(d * uPixel + 0.5, 0.0, 1.0);
}

void main() {
	float a = cover(vEdge.y - abs(vEdge.x)) * cover(vCut);
	if (vDash.y > 0.0) {
		float period = vDash.y + vDash.z;
		float t = mod(vDash.x, period);
		a *= cover(t < vDash.y ? min(t, vDash.y - t) : -min(t - vDash.y, period - t));
	}
	finalColor = vColor * a;
}
`;

/** The lines' shader, shared by every layer of one renderer; `resolution` is device px per screen px. */
export function lineShader(P: Pixi, resolution: number): Shader {
	return new P.Shader({
		glProgram: new P.GlProgram({
			name: 'sdv-lines',
			vertex,
			fragment,
			preferredVertexPrecision: 'highp',
			preferredFragmentPrecision: 'highp'
		}),
		resources: {
			lineUniforms: new P.UniformGroup({ uPixel: { value: resolution, type: 'f32' } })
		}
	});
}

/** One layer of lines: a mesh to put in the scene, refilled when its lines change. */
export class LineLayer {
	readonly mesh: Mesh<Geometry, Shader>;
	readonly #buffers = new LineBuffers();
	readonly #geometry: Geometry;
	readonly #vb: Buffer;
	readonly #ib: Buffer;

	constructor(P: Pixi, shader: Shader) {
		this.#buffers.reserve(1, 1);
		this.#vb = new P.Buffer({
			data: this.#buffers.vertices,
			usage: P.BufferUsage.VERTEX | P.BufferUsage.COPY_DST
		});
		this.#ib = new P.Buffer({
			data: this.#buffers.indices,
			usage: P.BufferUsage.INDEX | P.BufferUsage.COPY_DST
		});
		const at = (offset: number, format: 'float32x2' | 'float32x3' | 'float32x4' | 'unorm8x4') => ({
			buffer: this.#vb,
			format,
			stride: STRIDE * 4,
			offset: offset * 4
		});
		this.#geometry = new P.Geometry({
			attributes: {
				aPosition: at(0, 'float32x2'),
				aOffset: at(F.offset, 'float32x2'),
				aShift: at(F.shift, 'float32x4'),
				aEdge: at(F.edge, 'float32x2'),
				aAlong: at(F.along, 'float32x2'),
				aDash: at(F.dash, 'float32x3'),
				aHead: at(F.head, 'float32x4'),
				aColor: at(F.colour, 'unorm8x4')
			},
			indexBuffer: this.#ib
		});
		this.mesh = new P.Mesh({ geometry: this.#geometry, shader });
		this.mesh.visible = false;
	}

	/** Draws `lines`, in order, instead of what the layer drew. */
	set(lines: readonly LineSpec[], rgba: (t: Token) => number) {
		const b = this.#buffers;
		if (buildLines(lines, rgba, b)) {
			this.#vb.data = b.vertices;
			this.#ib.data = b.indices;
		}
		// Upload only what was written.
		this.#vb.setDataWithSize(b.vertices, b.vertexCount * STRIDE, true);
		this.#ib.setDataWithSize(b.indices, b.indexCount, true);
		this.#geometry.indexCount = b.indexCount;
		this.mesh.visible = b.indexCount > 0;
	}

	/** Frees the layer's buffers; the mesh is destroyed with the scene. */
	destroy() {
		this.#geometry.destroy(true);
	}
}

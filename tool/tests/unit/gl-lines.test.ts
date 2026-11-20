import { describe, expect, it } from 'vitest';
import {
	buildLines,
	HEAD_INSET,
	LineBuffers,
	STRIDE,
	type LineSpec
} from '../../src/lib/components/canvas/gl/lines';

const rgba = () => 0xff336699;
const at = (b: LineBuffers, v: number, f: number) => b.vertices[v * STRIDE + f];
/** A vertex's colour word. */
const colour = (b: LineBuffers, v: number) => b.words[v * STRIDE + 19];

describe('WebGL lines', () => {
	it('joins an orthogonal corner with a miter and ends with butt caps', () => {
		const b = new LineBuffers();
		const line: LineSpec = {
			points: [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
				{ x: 100, y: 50 }
			],
			width: 2,
			color: 'edge-rest'
		};
		buildLines([line], rgba, b);
		expect(b.vertexCount).toBe(8);
		expect(b.indexCount).toBe(12);
		// Each segment is a quad. Start: straight across, the half width plus the fringe.
		expect([at(b, 0, 2), at(b, 0, 3)]).toEqual([-0, 2]);
		// Corner: out along the diagonal, so both edges meet square.
		expect(at(b, 2, 2)).toBeCloseTo(-2);
		expect(at(b, 2, 3)).toBeCloseTo(2);
		expect([at(b, 2, 8), at(b, 2, 9)]).toEqual([2, 1]);
		expect(colour(b, 2)).toBe(0xff336699);
	});

	it('keeps a segment that doubles back on its own side of the line', () => {
		const b = new LineBuffers();
		const points = [0, -50, 20, -10].map((y) => ({ x: 0, y }));
		buildLines([{ points, width: 2, color: 'edge-rest' }], rgba, b);
		// Each segment's quad: its + side starts and ends on the same side, so it does not twist.
		for (let s = 0; s < 3; s++)
			expect(Math.sign(at(b, 4 * s, 2))).toBe(Math.sign(at(b, 4 * s + 2, 2)));
	});

	it('draws a halo first, then the line, then its head, with the end drawn back under it', () => {
		const b = new LineBuffers();
		buildLines(
			[
				{
					points: [
						{ x: 0, y: 0 },
						{ x: 0, y: 0 },
						{ x: 0, y: 40 }
					],
					width: 2,
					color: 'edge-rest',
					halo: 6,
					head: 'arrow',
					dim: true
				}
			],
			rgba,
			b
		);
		// Repeated points dropped: halo 4, line 4, arrow 3.
		expect(b.vertexCount).toBe(11);
		expect(b.indexCount).toBe(6 + 6 + 3);
		// The halo is in the canvas colour, faded with the line.
		expect(colour(b, 0) >>> 24).toBe(64);
		// The line's end draws back up its segment, which is 40 canvas px long.
		expect([at(b, 6, 4), at(b, 6, 5), at(b, 6, 6), at(b, 6, 7)]).toEqual([-0, -1, 40, -1]);
		// The arrow's base corners are 10 px back from the tip, 4 px aside.
		expect([at(b, 9, 2), at(b, 9, 3)]).toEqual([-4, -10]);
		expect(HEAD_INSET).toBe(5);
	});

	it('moves each corner by the lanes of its segments, and the head with its segment', () => {
		const b = new LineBuffers();
		const lane = { nx: 0, ny: -0.5, step: 4, room: 6 };
		const bend = { nx: 0.5, ny: 0, step: 4, room: 2 };
		buildLines(
			[
				{
					points: [
						{ x: 0, y: 0 },
						{ x: 100, y: 0 },
						{ x: 100, y: 50 }
					],
					width: 2,
					color: 'edge-rest',
					head: 'arrow',
					lanes: [lane, bend]
				}
			],
			rgba,
			b
		);
		const fields = (v: number, f: number) => [0, 1, 2, 3].map((k) => at(b, v, f + k));
		// The first segment's start: its own lane, no bend.
		expect(fields(0, 20)).toEqual([0, -0.5, 4, 6]);
		expect(fields(0, 24)).toEqual([0, 0, 0, 0]);
		// Its end, at the corner: its lane, and the lane of the segment it bends into.
		expect(fields(2, 24)).toEqual([0.5, 0, 4, 2]);
		// The second segment's start, at the corner: its lane, bent from the first's.
		expect(fields(4, 20)).toEqual([0.5, 0, 4, 2]);
		expect(fields(4, 24)).toEqual([0, -0.5, 4, 6]);
		// The arrow, on the last segment: in its lane.
		expect(fields(8, 20)).toEqual([0.5, 0, 4, 2]);
	});

	it('draws a line on its route when its lanes do not match its points', () => {
		const b = new LineBuffers();
		const points = [0, 0, 40].map((y) => ({ x: 0, y }));
		const lanes = [{ nx: 1, ny: 0, step: 4, room: 9 }, undefined];
		buildLines([{ points, width: 2, color: 'edge-rest', lanes }], rgba, b);
		expect(at(b, 0, 20)).toBe(0);
	});

	it('rebuilds 500 lit lines of 6 points quickly (target: under 2 ms)', () => {
		const lines: LineSpec[] = Array.from({ length: 500 }, (_, i) => ({
			points: [0, 1, 2, 3, 4, 5].map((k) => ({ x: i * 7 + (k >> 1) * 40, y: ((k + 1) >> 1) * 30 })),
			width: 2,
			color: 'link-ref',
			head: i % 3 ? 'arrow' : 'diamond',
			dash: i % 2 ? [5, 4] : undefined
		}));
		const b = new LineBuffers();
		for (let i = 0; i < 20; i++) buildLines(lines, rgba, b);
		const t0 = performance.now();
		for (let i = 0; i < 50; i++) buildLines(lines, rgba, b);
		const ms = (performance.now() - t0) / 50;
		expect(b.vertexCount).toBe(500 * 20 + Math.ceil(500 / 3) * 4 + (500 - Math.ceil(500 / 3)) * 3);
		// Loose, so a busy machine does not fail it; the log says how fast it was.
		expect(ms).toBeLessThan(5);
		console.log(`500 lines rebuilt in ${ms.toFixed(3)} ms`);
	});
});

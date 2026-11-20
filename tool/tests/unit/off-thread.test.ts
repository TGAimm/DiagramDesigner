import { describe, expect, it, vi } from 'vitest';
import { OffThread, serveOffThread, type OffThreadPort } from '../../src/lib/client/off-thread';
import { layoutLandscape } from '../../src/lib/landscape/layout';
import { loadFixture } from './helpers';

/** A worker serving `work` in this thread: messages copied both ways as a worker's are, a task later. */
class InProcess<In, Out> implements OffThreadPort<In, Out> {
	onmessage: OffThreadPort<In, Out>['onmessage'] = null;
	onerror: OffThreadPort<In, Out>['onerror'] = null;
	sent: In[] = [];
	private serve: (m: { id: number; input: In }) => void;
	constructor(work: (input: In) => Out) {
		this.serve = serveOffThread(work, (m) =>
			setTimeout(() => this.onmessage?.({ data: structuredClone(m) }))
		);
	}
	postMessage(m: { id: number; input: In }) {
		const copy = structuredClone(m);
		this.sent.push(copy.input);
		setTimeout(() => this.serve(copy));
	}
	terminate() {}
}

const double = (n: number) => n * 2;

describe('OffThread', () => {
	it('works in the page at once without a worker', () => {
		const done = vi.fn();
		new OffThread(double).run(4, done);
		expect(done).toHaveBeenCalledWith(8);
	});

	it('works the newest input only, of those sent while one was worked', async () => {
		const port = new InProcess(double);
		const t = new OffThread(double, () => port);
		const done = vi.fn();
		for (const n of [1, 2, 3]) t.run(n, (out) => done(n, out));
		await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(2));
		expect(port.sent).toEqual([1, 3]);
		expect(done.mock.calls).toEqual([
			[1, 2],
			[3, 6]
		]);
	});

	it('works in the page what the worker failed at, and goes on with the worker', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const port = new InProcess((n: number) => {
			if (n === 1) throw new Error('no');
			return double(n);
		});
		const t = new OffThread(double, () => port);
		const done = vi.fn();
		t.run(1, done);
		await vi.waitFor(() => expect(done).toHaveBeenCalledWith(2));
		t.run(5, done);
		await vi.waitFor(() => expect(done).toHaveBeenCalledWith(10));
		expect(port.sent).toEqual([1, 5]);
		error.mockRestore();
	});

	it('works in the page from then on once the worker broke, what waited too', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const port = new InProcess(double);
		const t = new OffThread(double, () => port);
		const done = vi.fn();
		t.run(1, done);
		t.run(2, done);
		port.onerror?.({ message: 'gone' });
		expect(done.mock.calls).toEqual([[2], [4]]);
		t.run(3, done);
		expect(done).toHaveBeenLastCalledWith(6);
		error.mockRestore();
	});

	it('works in the page input a worker cannot be sent', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const port = new InProcess((f: () => number) => f());
		const t = new OffThread(
			(f: () => number) => f(),
			() => port
		);
		const done = vi.fn();
		t.run(() => 7, done);
		expect(done).toHaveBeenCalledWith(7);
		error.mockRestore();
	});

	it('lays out in a worker exactly as in the page', async () => {
		const { model } = loadFixture();
		type In = { model: typeof model };
		const lay = ({ model }: In) => layoutLandscape(model);
		const t = new OffThread(lay, () => new InProcess(lay));
		const done = vi.fn();
		t.run({ model }, done);
		await vi.waitFor(() => expect(done).toHaveBeenCalled());
		expect(done.mock.calls[0][0]).toEqual(layoutLandscape(model));
	});
});

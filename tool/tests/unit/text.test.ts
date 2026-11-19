import { describe, expect, it } from 'vitest';
import { identParts } from '../../src/lib/render/text';

describe('identParts', () => {
	it('breaks at humps, never inside one', () => {
		expect(identParts('getOrderDeliveryDate')).toEqual(['get', 'Order', 'Delivery', 'Date']);
		expect(identParts('VehicleHasInvalidOERimSize')).toEqual([
			'Vehicle',
			'Has',
			'Invalid',
			'OERim',
			'Size'
		]);
	});
	it('breaks after dots, slashes and dashes, and before brackets', () => {
		expect(identParts('Order.lineId')).toEqual(['Order.', 'line', 'Id']);
		expect(identParts('/api/v1/carts')).toEqual(['/', 'api/', 'v1/', 'carts']);
		expect(identParts('sbq-orders')).toEqual(['sbq-', 'orders']);
		expect(identParts('Message<Order>')).toEqual(['Message', '<Order>']);
	});
	it('keeps a word whole', () => {
		expect(identParts('string')).toEqual(['string']);
	});
});

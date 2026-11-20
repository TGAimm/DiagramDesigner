import { describe, expect, it } from 'vitest';
import { methodColor, methodToken } from '../../src/lib/theme/tokens';

describe('method colours', () => {
	it('give PATCH the colour of PUT', () => {
		expect(methodToken('PATCH')).toBe('method-put');
		expect(methodColor('PATCH')).toBe(methodColor('PUT'));
	});

	it('draw a method without a colour muted', () => {
		expect(methodToken('HEAD')).toBe('text-muted');
		expect(methodColor(undefined)).toBe('var(--sdv-text-muted)');
	});
});

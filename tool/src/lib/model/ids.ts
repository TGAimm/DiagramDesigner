const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const CHARS = LETTERS + '0123456789';

const pick = (chars: string) =>
	chars[globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % chars.length];

/** 10 characters, starting with a letter so it is also a valid kebab-case id. */
export function generateId(): string {
	let id = pick(LETTERS);
	while (id.length < 10) id += pick(CHARS);
	return id;
}

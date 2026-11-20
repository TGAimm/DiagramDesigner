/**
 * Lets the page handle input, timers and drawing before going on: resolves in a task of its own,
 * after whatever else waits.
 */
export const yieldToPage = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

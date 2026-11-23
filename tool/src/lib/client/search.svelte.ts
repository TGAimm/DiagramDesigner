/** Whether the search box is open; the topbar and ⌘K / Ctrl+K open it, the canvas draws it. */
export const search = $state({ open: false });

/** A flag key the Flags menu asks the canvas to focus on; the canvas takes it and clears it. */
export const flagAsk = $state<{ key: string | null }>({ key: null });

// Semicolon-free code: a lone backtick in a comment must not pair with a
// later one and turn the code in between into a class list.
export function useZoom(ref: { current: HTMLElement | null }) {
	// --- Cached (` key toggles) container rect ---
	const update = () => {
		const container = ref.current
		if (!container) return
		// use the effective container height (p is the padding), not the container
		return container.getBoundingClientRect()
	}

	return { update, label: `zoom`, row: "flex block p-2" }
}

/**
 * Motion policy (dashboard-v3 §16): durations ~25% faster than Arc defaults.
 * Originals: instant 0.12 · fast 0.16 · exit 0.18 · standard 0.24 · considered 0.48 ·
 * snappy 0.26 · smooth 0.40 · morph 0.42 · stagger 0.016/0.04/0.08/0.035.
 * Springs keep stiffness/damping; only visualDuration shrank. Safety timings
 * (HoldToConfirm, timeouts, refresh intervals) live elsewhere and are untouched.
 */
export const motionTokens = {
	duration: { instant: 0.09, fast: 0.12, exit: 0.14, standard: 0.18, considered: 0.36 },
	ease: {
		enter: [0.16, 1, 0.3, 1],
		exit: [0.7, 0, 0.84, 0],
		standard: [0.22, 1, 0.36, 1],
		/** For elements that move while already on screen. */
		inOut: [0.65, 0, 0.35, 1],
	},
	spring: {
		responsive: { type: 'spring', stiffness: 520, damping: 44 },
		gentle: { type: 'spring', stiffness: 340, damping: 34 },
		/** Presses, toggles, thumbs, and small indicators. Settles fast and never overshoots, so nothing jitters. */
		snappy: { type: 'spring', visualDuration: 0.21, bounce: 0 },
		/** Panels, height changes, and layout shifts. Critically damped, never overshoots. */
		smooth: { type: 'spring', visualDuration: 0.32, bounce: 0 },
		/** Shape morphs, shared layout highlights, and width changes that follow new content. No bounce: sizes and positions settle without overshoot. */
		morph: { type: 'spring', visualDuration: 0.34, bounce: 0 },
	},
	/** Stagger steps in seconds. Keep total stagger under roughly 0.4s. */
	stagger: { char: 0.012, word: 0.03, line: 0.06, item: 0.026 },
	/** Blur radii in px for text and content crossfades. Keep blur small and brief. */
	blur: { subtle: 2, soft: 4, text: 8 },
} as const;

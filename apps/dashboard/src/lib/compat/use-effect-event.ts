import * as React from 'react';

/**
 * useEffectEvent compatibility shim.
 *
 * React 19.2 exports `useEffectEvent`, but webpack's static CJS export
 * detection misses it inside some chunk graphs (the build logs the warning
 * "Attempted import error: 'useEffectEvent' is not exported from 'react'"),
 * which turns the named import into `undefined` at runtime and crashes any
 * component that calls it. This shim is the React-documented behavior
 * equivalent — stable identity, always reads the latest closure — built only
 * from exports webpack reliably detects.
 */
export function useEffectEvent<T extends (...args: never[]) => unknown>(callback: T): T {
	const ref = React.useRef(callback);
	React.useInsertionEffect(() => {
		ref.current = callback;
	});
	return React.useMemo(() => ((...args: never[]) => ref.current(...args)) as T, []);
}

// One place to load async data with built-in loading AND error handling, so a
// failed IndexedDB read shows a recoverable error state instead of a blank
// screen that hangs forever (the reliability net — pro-grade audit T1-1).
//
// Usage:
//   const { data, loading, error, reload } = useAsyncData(
//     () => Promise.all([getAll<Foo>('foo'), getAll<Bar>('bar')]),
//     [refreshKey],
//   );
//   if (error) return <ScreenError onRetry={reload} />;
//   if (loading || !data) return <ScreenLoading />;
import { useCallback, useEffect, useState } from 'react';

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: boolean;
  reload: () => void;
}

export function useAsyncData<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    loader()
      .then((result) => {
        if (!alive) return;
        setData(result);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // Fail SAFE to a recoverable error state — never a blank/hung screen.
        console.error('Data load failed', e);
        setError(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // `loader` is intentionally omitted (it's re-created each render); the caller
    // controls re-runs via `deps`, and `nonce` drives reload().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { messageOf } from '../core/errors';

export interface AsyncState<T> {
  loading: boolean;
  data: T | null;
  error: string | null;
  reload: () => Promise<void>;
}

/** Small data-loading hook with a stable reload callback and cancel safety. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loaderRef.current();
      if (alive.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (alive.current) {setError(messageOf(e));}
    } finally {
      if (alive.current) {setLoading(false);}
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { loading, data, error, reload };
}

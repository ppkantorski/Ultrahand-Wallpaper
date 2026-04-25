import { useCallback, useEffect, useRef, useState } from "react";

type Updater<T> = T | ((prev: T) => T);

export function useHistory<T>(initial: T, debounceMs = 400) {
  const [present, setPresent] = useState<T>(initial);
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);

  const presentRef = useRef(present);
  presentRef.current = present;
  const lastCommitRef = useRef<T>(initial);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const last = lastCommitRef.current;
    const cur = presentRef.current;
    if (last !== cur) {
      setPast((p) => [...p, last]);
      setFuture([]);
      lastCommitRef.current = cur;
    }
  }, []);

  const set = useCallback(
    (updater: Updater<T>) => {
      setPresent((prev) =>
        typeof updater === "function"
          ? (updater as (p: T) => T)(prev)
          : updater,
      );
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(commit, debounceMs);
    },
    [commit, debounceMs],
  );

  const undo = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPast((p) => {
      if (p.length === 0) return p;
      const previous = p[p.length - 1]!;
      const cur = presentRef.current;
      // If there's an uncommitted change, commit it before stepping back
      if (lastCommitRef.current !== cur) {
        setFuture((f) => [cur, ...f]);
        lastCommitRef.current = previous;
        setPresent(previous);
        return p.slice(0, -1);
      }
      setFuture((f) => [cur, ...f]);
      lastCommitRef.current = previous;
      setPresent(previous);
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0]!;
      setPast((p) => [...p, presentRef.current]);
      lastCommitRef.current = next;
      setPresent(next);
      return f.slice(1);
    });
  }, []);

  const reset = useCallback((next: T) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPresent(next);
    setPast([]);
    setFuture([]);
    lastCommitRef.current = next;
  }, []);

  // Cleanup pending timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return {
    state: present,
    set,
    commit,
    undo,
    redo,
    reset,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}

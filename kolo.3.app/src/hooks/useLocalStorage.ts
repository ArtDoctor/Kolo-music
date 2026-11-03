import { useEffect, useState } from "react";

export function readLocalStorage<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocalStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: persistence is best-effort.
  }
}

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() =>
    readLocalStorage(key, initialValue),
  );

  useEffect(() => {
    writeLocalStorage(key, value);
  }, [key, value]);

  return [value, setValue] as const;
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function useDebouncedSearch(delayMs = 400) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const change = useCallback((value: string) => {
    setInput(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setQuery(value.trim()), delayMs);
  }, [delayMs]);
  const submit = useCallback((value: string) => {
    clearTimeout(timer.current);
    setInput(value);
    setQuery(value.trim());
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { input, query, change, submit };
}

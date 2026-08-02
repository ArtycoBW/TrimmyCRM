"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

/**
 * Keeps interactions disabled in server-rendered HTML until React has attached
 * their event handlers.
 */
export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

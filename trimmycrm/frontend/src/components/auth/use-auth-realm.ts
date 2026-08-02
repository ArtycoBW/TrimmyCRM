"use client";

import { useSyncExternalStore } from "react";

import { currentAuthRealm } from "@/lib/auth/realm";
import type { AuthRealm } from "@/lib/api/types";

const subscribe = () => () => undefined;

export function useAuthRealm() {
  return useSyncExternalStore<AuthRealm>(
    subscribe,
    currentAuthRealm,
    () => "platform",
  );
}

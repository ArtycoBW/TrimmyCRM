"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV === "development") return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }, []);

  return null;
}

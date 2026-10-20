"use client";

import { useEffect, useState } from "react";
import { adminMe } from "@/lib/admin";

// One request per page load; the server re-checks the role on every privileged call anyway.
let cached: Promise<boolean> | null = null;

/** True only for the game owner (UI hint for owner-only buttons; never a security check). */
export function useIsOwner(): boolean {
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    cached ??= adminMe().then((r) => r.role === "owner", () => false);
    let alive = true;
    cached.then((v) => alive && setOwner(v));
    return () => {
      alive = false;
    };
  }, []);
  return owner;
}

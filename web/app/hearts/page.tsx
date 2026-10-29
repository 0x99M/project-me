"use client";

import { useEffect, useRef } from "react";
import { startHearts } from "./engine";
import { MARKUP } from "./markup";

export default function HeartsPage() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current) return;
    return startHearts(root.current);
  }, []);

  return (
    <div
      ref={root}
      className="hearts-root"
      dangerouslySetInnerHTML={{ __html: MARKUP }}
    />
  );
}

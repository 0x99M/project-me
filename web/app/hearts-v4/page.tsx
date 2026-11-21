"use client";

import { useEffect, useRef } from "react";
import { startHeartsV4 } from "./engine";
import { MARKUP } from "./markup";

export default function HeartsV4Page() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current) return;
    return startHeartsV4(root.current);
  }, []);

  return (
    <div
      ref={root}
      className="hv4"
      dangerouslySetInnerHTML={{ __html: MARKUP }}
    />
  );
}

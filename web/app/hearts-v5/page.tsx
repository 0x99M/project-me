"use client";

import { useEffect, useRef } from "react";
import { startHeartsV5 } from "./engine";
import { MARKUP } from "./markup";

export default function HeartsV5Page() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current) return;
    return startHeartsV5(root.current);
  }, []);

  return (
    <div
      ref={root}
      className="hv5"
      dangerouslySetInnerHTML={{ __html: MARKUP }}
    />
  );
}

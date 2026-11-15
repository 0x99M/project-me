"use client";

import { useEffect, useRef } from "react";
import { startHeartsV2 } from "./engine";
import { MARKUP } from "./markup";

export default function HeartsV2Page() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current) return;
    return startHeartsV2(root.current);
  }, []);

  return (
    <div
      ref={root}
      className="hv2"
      dangerouslySetInnerHTML={{ __html: MARKUP }}
    />
  );
}

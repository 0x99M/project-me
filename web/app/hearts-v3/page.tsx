"use client";

import { useEffect, useRef } from "react";
import { startHeartsV3 } from "./engine";
import { MARKUP } from "./markup";

export default function HeartsV3Page() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current) return;
    return startHeartsV3(root.current);
  }, []);

  return (
    <div
      ref={root}
      className="hv3"
      dangerouslySetInnerHTML={{ __html: MARKUP }}
    />
  );
}

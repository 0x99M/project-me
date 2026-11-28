"use client";

import { useEffect, useRef } from "react";
import { startHeartsV6 } from "./engine";
import { MARKUP } from "./markup";

export default function HeartsV6Page() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current) return;
    return startHeartsV6(root.current);
  }, []);

  return (
    <div
      ref={root}
      className="hv6"
      dangerouslySetInnerHTML={{ __html: MARKUP }}
    />
  );
}

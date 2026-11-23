"use client";

import { useState, useSyncExternalStore } from "react";
import { hex } from "./hex";

export type HeroProduct = {
  id: string;
  name: string;
  meta: string;
  tagline: string;
  bg: string;
  fg: string;
  accent: string;
  long?: boolean;
};

/** How long each product holds the hero, in ms. The pip's fill animation is the timer. */
const HOLD = 4800;


/** A three-second skit of what each product does. Unknown products get their initial. */
function Act({ id, name }: { id: string; name: string }) {
  switch (id) {
    case "shadowkit": {
      // A habit streak filling in, day by day.
      const done = new Set([0, 1, 2, 3, 5, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 26, 28, 29, 30, 31, 32, 33]);
      let order = 0;
      return (
        <div className="pf-act-grid">
          {Array.from({ length: 35 }, (_, i) =>
            done.has(i) ? (
              <i key={i} className="on" style={{ animationDelay: `${order++ * 70}ms` }} />
            ) : (
              <i key={i} />
            ),
          )}
        </div>
      );
    }
    case "recipes":
      // A video shrinks into the corner and a recipe writes itself beside it.
      return (
        <>
          <div className="pf-act-video">
            <b />
          </div>
          <div className="pf-act-recipe">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </>
      );
    case "clipmer":
      // Things you copied stack up, newest on top.
      return (
        <div className="pf-act-clips">
          <span>ssh deploy@0x99m.com</span>
          <span>#4535c9</span>
          <span>npm run build &amp;&amp; git push</span>
          <span>https://clipmer.app</span>
        </div>
      );
    case "dotpane":
      // Panes drop onto the dotted grid and snap into place.
      return (
        <div className="pf-act-dots">
          <i />
          <i />
          <i />
          <i />
        </div>
      );
    case "backtesting":
      // An equity curve draws itself.
      return (
        <svg className="pf-act-curve" viewBox="0 0 200 120">
          <line x1="6" y1="30" x2="194" y2="30" />
          <line x1="6" y1="60" x2="194" y2="60" />
          <line x1="6" y1="90" x2="194" y2="90" />
          <path d="M8 100 L28 92 L44 97 L62 76 L78 83 L96 58 L112 66 L130 44 L146 52 L164 30 L186 22" />
          <circle cx="186" cy="22" r="5" />
        </svg>
      );
    default:
      return <div className="pf-act-mono">{name.charAt(0)}</div>;
  }
}

const REDUCED = "(prefers-reduced-motion: reduce)";
function subscribeReduced(cb: () => void) {
  const mq = matchMedia(REDUCED);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function getReduced() {
  return matchMedia(REDUCED).matches;
}

export function Hero({ products, nav }: { products: HeroProduct[]; nav: React.ReactNode }) {
  const n = products.length;
  const [index, setIndex] = useState(0);
  const [turn, setTurn] = useState(0); // bumps on every change so the skit and timer restart
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const reduced = useSyncExternalStore(subscribeReduced, getReduced, () => false);

  const running = playing && !hovered && !focused && !reduced;
  const p = products[index];

  function show(k: number) {
    setIndex(((k % n) + n) % n);
    setTurn((t) => t + 1);
  }

  const style = {
    "--hero-bg": p.bg,
    "--hero-fg": p.fg,
    "--hero-accent": p.accent,
  } as React.CSSProperties;

  return (
    <section
      className="pf-hero"
      id="top"
      style={style}
      onFocus={(e) => {
        // Keyboard focus pauses the reel; a tap or click on a pip does not.
        if ((e.target as HTMLElement).matches(":focus-visible")) setFocused(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div className="pf-wrap pf-hero-inner">
        <header className="pf-top">
          <a href="#top" className="pf-mark">
            0x99M
          </a>
          {nav}
          <p className="pf-count">
            {/* CSS counts 0x00 up to the total in hex; see .pf-count-num */}
            <span className="pf-count-num" aria-hidden="true" style={{ "--pf-total": n } as React.CSSProperties} />
            <span aria-hidden="true">shipped</span>
            <span className="pf-sr">{n} products shipped</span>
          </p>
        </header>

        <h1 className="pf-hero-title">Mustafa builds things that ship.</h1>

        <div
          className="pf-show"
          role="group"
          aria-roledescription="carousel"
          aria-label="Products"
          onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
          onPointerLeave={() => setHovered(false)}
        >
          <div className="pf-show-copy" aria-live={running ? "off" : "polite"} key={`c${turn}`}>
            <p className="pf-show-meta">
              <span className="pf-show-num">{hex(index + 1)}</span>
              <span>{p.meta}</span>
            </p>
            <p className="pf-show-namebox">
              <span className={p.long ? "pf-show-name pf-show-name-long" : "pf-show-name"}>{p.name}</span>
            </p>
            <p className="pf-show-tag">{p.tagline}</p>
            <a className="pf-show-more" href={`#${p.id}`}>
              More on {p.name} <span aria-hidden="true">↓</span>
            </a>
          </div>
          <div className="pf-act" aria-hidden="true" key={`a${turn}`}>
            <Act id={p.id} name={p.name} />
          </div>
        </div>

        <div className="pf-hero-foot">
          <div className="pf-controls">
            <button
              type="button"
              className="pf-play"
              onClick={() => setPlaying((v) => !v)}
              aria-label={playing ? "Pause the product reel" : "Play the product reel"}
              hidden={reduced}
            >
              {playing ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5.5v13l11-6.5z" />
                </svg>
              )}
            </button>
            <div className="pf-pips">
              {products.map((q, k) => (
                <button
                  key={q.id}
                  type="button"
                  className="pf-pip"
                  aria-label={`Show ${q.name}`}
                  aria-current={k === index ? "true" : undefined}
                  title={q.name}
                  onClick={() => show(k)}
                >
                  {k === index && !reduced && (
                    <span
                      key={turn}
                      className="pf-pip-fill"
                      style={{
                        animationDuration: `${HOLD}ms`,
                        animationPlayState: running ? "running" : "paused",
                      }}
                      onAnimationEnd={() => show(index + 1)}
                    />
                  )}
                </button>
              ))}
            </div>
          </div>
          <p className="pf-lead">
            Solo developer. {n} products so far, across phone, desktop and web. Each one designed, built and run by
            me.
          </p>
          <a href={`#${products[0].id}`} className="pf-down" aria-label="Jump to the first product">
            ↓
          </a>
        </div>
      </div>
    </section>
  );
}

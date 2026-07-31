"use client";

import { useEffect, useRef } from "react";

type Product = {
  title: string;
  href?: string;
  desc: string;
  meta: string;
};

type Social = {
  label: string;
  href: string;
  path: string;
};

const products: Product[] = [
  {
    title: "Videos.Recipes",
    href: "https://videos.recipes",
    desc: "AI that turns YouTube cooking videos into structured, searchable recipes — tiered billing, real-time extraction, export to PDF or DOCX.",
    meta: "AI · SaaS",
  },
  {
    title: "Clipmer",
    href: "https://clipmer.app",
    desc: "Keyboard-first clipboard history for Linux — search, pinned items, notes, and auto-paste on GNOME/Wayland.",
    meta: "Linux · Desktop",
  },
  {
    title: "Backtesting SaaS",
    desc: "Multi-asset trading-strategy backtesting on Next.js + FastAPI, with Auth0 for auth and Paddle for billing.",
    meta: "Fintech · SaaS",
  },
];

// Brand marks from simple-icons (24×24, single path), inlined so the page pulls
// nothing external.
const socials: Social[] = [
  {
    label: "GitHub",
    href: "https://github.com/0x99M",
    path: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  },
  {
    label: "X",
    href: "https://x.com/0x99M",
    path: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/mustafa-alsheikh/",
    path: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  },
];

export default function SoloPage() {
  const rootRef = useRef<HTMLElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = root.querySelectorAll<HTMLElement>("[data-reveal]");
    if (els.length === 0) return;
    // No observer (or reduced-motion CSS keeps them visible anyway): just show all.
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Top scroll-progress bar: width tracks how far down the page you are.
  useEffect(() => {
    const bar = progressRef.current;
    if (!bar) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      bar.style.transform = `scaleX(${progress})`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <main className="solo" ref={rootRef}>
      <div className="progress" ref={progressRef} aria-hidden="true" />

      {/* With JS off, reveal everything immediately. */}
      <noscript>
        <style
          dangerouslySetInnerHTML={{
            __html:
              ".solo [data-reveal]{opacity:1 !important;transform:none !important}",
          }}
        />
      </noscript>

      <div className="wrap">
        <header className="topbar">
          <span className="mark">0x99M</span>
          <span>Jordan</span>
        </header>

        <section className="intro">
          <p className="eyebrow">Solo SaaS builder</p>
          <h1 className="name">
            <span className="line">
              <span className="line-inner">Mustafa</span>
            </span>
            <span className="line">
              <span className="line-inner">
                Alsheikh<span className="dot">.</span>
              </span>
            </span>
          </h1>
          <p className="lead">
            I design, build, and ship SaaS end-to-end — solo. From the first
            commit to billing, deploys, and everything in between.
          </p>
          <p className="creds">
            Ex-Amazon · Technical Team Lead · CS, University of Jordan
          </p>
        </section>

        <section className="products" aria-label="Products">
          <div className="section-label" data-reveal>
            <span>Products</span>
            <span className="count">
              {String(products.length).padStart(2, "0")}
            </span>
          </div>
          <ol className="index">
            {products.map((product, index) => {
              const number = String(index + 1).padStart(2, "0");
              const inner = (
                <>
                  <span className="num">{number}</span>
                  <span className="row-main">
                    <span className="row-title">
                      {product.title}
                      {product.href && <span className="arrow">↗</span>}
                    </span>
                    <span className="row-desc">{product.desc}</span>
                  </span>
                  <span className="row-meta">{product.meta}</span>
                </>
              );
              return (
                <li key={product.title} data-reveal>
                  {product.href ? (
                    <a
                      className="row"
                      href={product.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {inner}
                    </a>
                  ) : (
                    <div className="row">{inner}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        <footer className="foot">
          <span>© 2026 Mustafa Alsheikh</span>
          <div className="socials">
            {socials.map((social) => (
              <a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={social.label}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d={social.path} />
                </svg>
              </a>
            ))}
          </div>
        </footer>
      </div>
    </main>
  );
}

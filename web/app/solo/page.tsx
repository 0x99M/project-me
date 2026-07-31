import Link from "next/link";

type Product = {
  title: string;
  href?: string;
  desc: string;
  meta: string;
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

export default function SoloPage() {
  return (
    <main className="solo">
      <div className="wrap">
        <header className="topbar">
          <span className="mark">0x99M</span>
          <span>Jordan</span>
        </header>

        <section className="intro">
          <p className="eyebrow">Solo SaaS builder</p>
          <h1 className="name">
            Mustafa
            <br />
            Alsheikh<span className="dot">.</span>
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
          <div className="section-label">
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
                <li key={product.title}>
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

        <section className="contact" aria-label="Contact">
          <div className="section-label">
            <span>Let&apos;s talk</span>
          </div>
          <a className="email" href="mailto:me@0x99m.com">
            me@0x99m.com
          </a>
          <div className="links">
            <a
              href="https://github.com/0x99M"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/0x99M
            </a>
            <span className="sep">·</span>
            <Link href="/portfolio">Full CV ↗</Link>
          </div>
        </section>

        <footer className="foot">
          <span>© 2026 Mustafa Alsheikh</span>
          <span>0x99m.com</span>
        </footer>
      </div>
    </main>
  );
}

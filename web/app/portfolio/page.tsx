import { Hero, type HeroProduct } from "./hero";
import { hex } from "./hex";

type Product = {
  id: string;
  name: string;
  meta: string;
  /** One line for the hero reel. */
  tagline: string;
  pitch: string;
  /** Band colours; the text colour has to pass 4.5:1 on the band. */
  band: { bg: string; fg: string; accent: string; buttonText: string };
  link?: { href: string; label: string };
  image?: { src: string; alt: string; width: number; height: number };
  /** Long names get a smaller display size so they still fit one line. */
  long?: boolean;
};

const products: Product[] = [
  {
    id: "shadowkit",
    name: "Shadowkit",
    meta: "Android · iOS · Linux",
    tagline: "Money, habits, notes and a journal in one quiet app.",
    pitch:
      "Your life, one quiet app. Money, habits, notes and a journal on your phone; network, focus and battery on your computer. Offline. No account.",
    band: { bg: "#0d1014", fg: "#edeff2", accent: "#46e0e6", buttonText: "#0d1014" },
    link: { href: "https://shadowkit.app", label: "shadowkit.app" },
    image: {
      src: "/portfolio/shadowkit.png",
      alt: "Shadowkit on two phones: the Today screen and a habit streak grid",
      width: 1200,
      height: 630,
    },
  },
  {
    id: "recipes",
    name: "Videos.Recipes",
    meta: "AI SaaS · Open source",
    tagline: "Paste a cooking video, get a clean recipe.",
    pitch:
      "Paste a YouTube cooking video, get a clean recipe: ingredients, steps, searchable, exportable to PDF or DOCX.",
    band: { bg: "#c2412b", fg: "#ffffff", accent: "#ffffff", buttonText: "#8e2a18" },
    link: { href: "https://github.com/0x99M/videos-recipes", label: "Source on GitHub" },
    image: {
      src: "/portfolio/videos-recipes.png",
      alt: "Videos.Recipes showing a recipe extracted from a video",
      width: 1920,
      height: 955,
    },
    long: true,
  },
  {
    id: "clipmer",
    name: "Clipmer",
    meta: "Linux desktop",
    tagline: "Everything you copied, one shortcut away.",
    pitch:
      "Everything you copied, one shortcut away. Search, pin, annotate and auto-paste on GNOME and Wayland.",
    band: { bg: "#4535c9", fg: "#ffffff", accent: "#ffffff", buttonText: "#2e2194" },
    link: { href: "https://clipmer.app", label: "clipmer.app" },
    image: {
      src: "/portfolio/clipmer.png",
      alt: "Clipmer's clipboard history popup",
      width: 1920,
      height: 956,
    },
  },
  {
    id: "dotpane",
    name: "Dotpane",
    meta: "Web app · Coming soon",
    tagline: "Small panes on a dotted grid, wired to your APIs.",
    pitch:
      "Write small HTML, CSS and JS panes and drop them on a dotted grid. Each one can call your APIs while your keys stay on the server. 400+ ready-made panes, and an MCP server so AI agents can build with it.",
    band: { bg: "#c9f24d", fg: "#1a1c1f", accent: "#1a1c1f", buttonText: "#c9f24d" },
    link: { href: "https://dotpane.com", label: "dotpane.com" },
    image: {
      src: "/portfolio/dotpane.png",
      alt: "A Dotpane canvas: weather, to-do, music and uptime panes on a dotted grid",
      width: 1698,
      height: 851,
    },
  },
  {
    id: "backtesting",
    name: "Backtesting",
    meta: "Fintech SaaS",
    tagline: "Test a trading strategy before it touches real money.",
    pitch:
      "Test a trading strategy across asset classes before it touches real money. Next.js and FastAPI, Auth0 and Paddle.",
    band: { bg: "#0f2a44", fg: "#ffffff", accent: "#7cc4ff", buttonText: "#0f2a44" },
    long: true,
  },
];

const socials = [
  { label: "Follow on X", href: "https://x.com/0x99M", primary: true },
  { label: "GitHub", href: "https://github.com/0x99M" },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/mustafa-alsheikh/" },
];

function Band({ product, index }: { product: Product; index: number }) {
  // Image on the right for odd bands, left for even, so the page zig-zags.
  const imageFirst = index % 2 === 1;
  const style = {
    "--band-bg": product.band.bg,
    "--band-fg": product.band.fg,
    "--band-accent": product.band.accent,
    "--band-button-text": product.band.buttonText,
  } as React.CSSProperties;

  return (
    <section id={product.id} className="pf-band" style={style} aria-labelledby={`${product.id}-name`}>
      <div className="pf-wrap pf-band-inner">
        <p className="pf-band-meta">
          <span className="pf-band-num">{hex(index + 1)}</span>
          <span>{product.meta}</span>
        </p>
        <h2 id={`${product.id}-name`} className={product.long ? "pf-name pf-name-long" : "pf-name"}>
          {product.name}
        </h2>
        <div className={product.image ? "pf-band-body" : "pf-band-body pf-band-body-text"}>
          <div className={imageFirst ? "pf-band-copy pf-second" : "pf-band-copy"}>
            <p className="pf-pitch">{product.pitch}</p>
            {product.link && (
              <a className="pf-button" href={product.link.href} target="_blank" rel="noopener noreferrer">
                {product.link.label} <span aria-hidden="true">↗</span>
              </a>
            )}
          </div>
          {product.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="pf-shot"
              src={product.image.src}
              alt={product.image.alt}
              width={product.image.width}
              height={product.image.height}
              loading={index === 0 ? "eager" : "lazy"}
              decoding="async"
            />
          )}
        </div>
      </div>
    </section>
  );
}

const heroProducts: HeroProduct[] = products.map((p) => ({
  id: p.id,
  name: p.name,
  meta: p.meta,
  tagline: p.tagline,
  bg: p.band.bg,
  fg: p.band.fg,
  accent: p.band.accent,
  long: p.long,
}));

export default function PortfolioPage() {
  const nav = (
    <nav aria-label="Products" className="pf-nav">
      {products.map((product) => (
        <a key={product.id} href={`#${product.id}`}>
          {product.name}
        </a>
      ))}
    </nav>
  );

  return (
    <main className="pf-page">
      <Hero products={heroProducts} nav={nav} />

      {products.map((product, index) => (
        <Band key={product.id} product={product} index={index} />
      ))}

      <footer className="pf-footer">
        <div className="pf-wrap pf-footer-inner">
          <h2 className="pf-footer-title">
            Next one&apos;s
            <br />
            coming.
          </h2>
          <div className="pf-socials">
            {socials.map((social) => (
              <a
                key={social.href}
                href={social.href}
                className={social.primary ? "pf-button pf-button-light" : "pf-button pf-button-ghost"}
                target="_blank"
                rel="noopener noreferrer"
              >
                {social.label} <span aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
          <p className="pf-copy">© {new Date().getFullYear()} Mustafa Alsheikh · 0x99m.com</p>
        </div>
      </footer>
    </main>
  );
}

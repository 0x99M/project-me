import PortfolioClient from "./portfolio-client";

const projects = [
  {
    title: "Videos.Recipes",
    description:
      "AI-powered SaaS that turns YouTube cooking videos into structured, searchable recipes — with tiered subscriptions, real-time extraction, and export to PDF or DOCX.",
    image: "/portfolio/videos-recipes.png",
    link: "https://videos.recipes",
    technologies: [
      "Next.js",
      "TypeScript",
      "PostgreSQL",
      "DrizzleORM",
      "Clerk Auth",
      "Paddle",
      "Railway",
    ],
  },
  {
    title: "Clipmer",
    description:
      "Tray-based clipboard history manager for Linux. Keyboard-first popup with search, pinned items, notes, and auto-paste — built for Ubuntu on GNOME/Wayland.",
    image: "/portfolio/clipmer.png",
    link: "https://clipmer.app",
    technologies: [
      "Electron",
      "Next.js",
      "Tailwind CSS",
      "GNOME Shell",
      "Railway",
    ],
  },
];

const experiences = [
  {
    role: "Technical Team Lead · Revest",
    summary:
      "Leading delivery on the loyalty platform — portal revamp, sales targeting, and integrations with external loyalty and installment providers.",
    date: "02/2026 – Present",
    bullets: [
      "Led the revamp of the Next.js portal, shipping 20+ features and migrating the UI from MUI to Untitled UI and Tailwind CSS alongside the design team.",
      "Built sales targets, letting customers set goals across 15+ dimensions including customers, products, stores, and regions.",
      "Led implementation of promotions, product variations, customer nationality and short address, and OTP verification for customer actions.",
      "Integrated the platform with external loyalty programs and installment sales providers.",
      "Implemented points transfer between different loyalty platforms.",
    ],
  },
  {
    role: "Full Stack Developer · Revest",
    summary:
      "Built a customer loyalty platform serving hundreds of stores with point-based rewards and real-time redemption tracking.",
    date: "09/2025 – 01/2026",
    bullets: [
      "Architected the backend with NestJS and PostgreSQL, supporting thousands of transactions daily, while shipping frontend features in Next.js.",
      "Designed the system architecture and technical specifications — database schema, API contracts, and service boundaries.",
      "Drove technical direction through architecture discussions, code reviews, and unblocking engineers on tricky implementations.",
    ],
  },
  {
    role: "Founding Engineer · 0x99M",
    summary:
      "Shipping AI-powered SaaS and developer tooling end-to-end — product, design, backend, billing, and ops.",
    date: "11/2023 – Present",
    bullets: [
      {
        before: "Shipped ",
        link: { href: "https://videos.recipes", label: "Videos.Recipes" },
        after:
          " — a SaaS that extracts structured recipes from YouTube cooking videos in real time via youtubei.js, with PostgreSQL/Drizzle storage, full-text search, and one-click export to PDF or DOCX.",
      },
      "Developed a multi-asset trading backtesting SaaS on Next.js + FastAPI, with Auth0 for auth, Paddle for billing, and AWS for compute and storage.",
      {
        before: "Shipped ",
        link: { href: "https://clipmer.app", label: "Clipmer" },
        after:
          " — a tray-based clipboard history manager for Linux (Electron + GNOME Shell extension) with a Next.js marketing site, distributed as .deb and AppImage.",
      },
    ],
  },
  {
    role: "Software Development Engineer L4 · Amazon",
    summary:
      "Scaled the Exchange Program Control Portal from 1 to 4 marketplaces.",
    date: "08/2022 – 10/2023",
    bullets: [
      "Led enhancements to the Exchange Program Control Portal, expanding its scope from 1 to 4 marketplaces.",
      "Redesigned marketplace onboarding, achieving a 90% improvement in expansion efficiency.",
      "Collaborated across teams to scale system architecture and support growing operational needs.",
    ],
  },
  {
    role: "Software Developer · UniTicker",
    summary:
      "Optimized market data infrastructure to unlock rapid product iteration.",
    date: "08/2021 – 08/2022",
    bullets: [
      "Optimized infrastructure, reducing server RAM usage by 71% (from 350+ GB to under 100 GB).",
      "Improved data streaming latency from 4+ hours to under 5 seconds.",
      "Refactored core market data processing, enhancing performance and maintainability — making it 70% easier to onboard new developers and implement new features.",
    ],
  },
];

const skillCategories = [
  {
    title: "Languages",
    icon: "💻",
    tags: ["TypeScript", "Python", "JavaScript", "Java", "C++", "Dart"],
  },
  {
    title: "Frameworks & Libraries",
    icon: "🚀",
    tags: [
      "Next.js",
      "React",
      "NestJS",
      "FastAPI",
      "Flutter",
      "Spring",
      "Tailwind CSS",
    ],
  },
  {
    title: "Cloud & Infrastructure",
    icon: "☁️",
    tags: [
      "AWS EC2",
      "AWS S3",
      "AWS Lambda",
      "DynamoDB",
      "AppRunner",
      "RDS",
      "REST APIs",
      "Linux",
      "Shell Scripting",
    ],
  },
  {
    title: "Tools & Platforms",
    icon: "🛠️",
    tags: ["Git", "GitHub", "Docker", "Postman", "Paddle", "Figma", "Jira"],
  },
];

export default function PortfolioPage() {
  return (
    <PortfolioClient
      projects={projects}
      experiences={experiences}
      skillCategories={skillCategories}
    />
  );
}

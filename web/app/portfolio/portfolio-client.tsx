"use client";

import { useEffect, useRef, useState } from "react";

type Project = {
  title: string;
  description: string;
  image: string;
  link: string;
  technologies?: string[];
};

type ExperienceBullet =
  | string
  | {
      before: string;
      link: { href: string; label: string };
      after: string;
    };

type Experience = {
  role: string;
  summary: string;
  date: string;
  bullets: ExperienceBullet[];
};

type SkillCategory = {
  title: string;
  icon: string;
  tags: string[];
};

const navItems = [
  { href: "#hero", label: "Home" },
  { href: "#projects", label: "Projects" },
  { href: "#experience", label: "Experience" },
  { href: "#skills", label: "Skills" },
  { href: "#education", label: "Education" },
];

export default function PortfolioClient({
  projects,
  experiences,
  skillCategories,
}: {
  projects: Project[];
  experiences: Experience[];
  skillCategories: SkillCategory[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("hero");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rootRef.current) return;
    const root = rootRef.current;
    const els = root.querySelectorAll<HTMLElement>("[data-animate]");
    if (!("IntersectionObserver" in window) || els.length === 0) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -12% 0px" }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const offset = window.scrollY + 120;
      let current = "hero";
      for (const item of navItems) {
        const id = item.href.slice(1);
        const el = document.getElementById(id);
        if (el && offset >= el.offsetTop) current = id;
      }
      setActiveSection(current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 768) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const handleNavClick = (href: string) => (e: React.MouseEvent) => {
    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      const offset =
        target.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top: offset, behavior: "smooth" });
      setMenuOpen(false);
    }
  };

  return (
    <div ref={rootRef}>
      <div
        className={`section-indicator ${menuOpen ? "is-menu-open" : ""}`}
      >
        <a
          href="#hero"
          className="logo-box"
          onClick={handleNavClick("#hero")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="Logo" className="logo-img" />
        </a>
        <button
          className={`nav-toggle ${menuOpen ? "is-active" : ""}`}
          type="button"
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          aria-label="Toggle navigation"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span className="nav-toggle-bar"></span>
        </button>
        <div className="nav-links" id="primary-navigation">
          <div className="nav-links-primary">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={`indicator-item ${
                  activeSection === item.href.slice(1) ? "is-active" : ""
                }`}
                onClick={handleNavClick(item.href)}
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      <main>
        <section id="hero" className="section hero" data-animate>
          <div className="container hero-layout">
            <div className="hero-copy">
              <p className="eyebrow">Full-stack engineer</p>
              <h1>
                Designing reliable products with calm, intentional code.
              </h1>
              <p className="lead">
                4+ years building scalable SaaS, trading platforms, and
                loyalty systems with TypeScript, Python, and AWS. Focused on
                shipping resilient experiences that feel effortless to use.
              </p>
            </div>
          </div>
        </section>

        <section id="projects" className="section" data-animate>
          <div className="container">
            <div className="section-heading">
              <h2>Projects</h2>
              <p>
                Selected work — products and experiments I&apos;ve built,
                designed, and shipped.
              </p>
            </div>
            <div className="project-grid">
              {projects.length === 0 ? (
                <p className="muted">
                  No projects available yet. Check back soon.
                </p>
              ) : (
                projects.map((project, index) => (
                  <article
                    key={project.title}
                    className="project-card"
                    data-animate
                    style={
                      {
                        ["--delay" as string]: `${index * 80}ms`,
                      } as React.CSSProperties
                    }
                  >
                    <div className="project-media">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={project.image}
                        alt={project.title}
                        loading="lazy"
                      />
                    </div>
                    <div className="project-body">
                      <h2>
                        <a
                          className="project-title-link"
                          href={project.link}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {project.title}
                        </a>
                      </h2>
                      <p>{project.description}</p>
                      {project.technologies && (
                        <ul className="project-tags">
                          {project.technologies.map((tech) => (
                            <li key={tech}>{tech}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>

        <section
          id="experience"
          className="section experience-section"
          data-animate
        >
          <div className="container">
            <div className="section-heading">
              <h2>Experience</h2>
              <p>
                End-to-end product delivery across SaaS, fintech, and
                infrastructure.
              </p>
            </div>
            <div className="experience-stack">
              {experiences.map((exp) => (
                <article
                  key={exp.role}
                  className="experience-card"
                  data-animate
                >
                  <header>
                    <div>
                      <p className="experience-role">{exp.role}</p>
                      <p className="experience-summary">{exp.summary}</p>
                    </div>
                    <span className="experience-date">{exp.date}</span>
                  </header>
                  <ul>
                    {exp.bullets.map((bullet, i) => (
                      <li key={i}>
                        {typeof bullet === "string" ? (
                          bullet
                        ) : (
                          <>
                            {bullet.before}
                            <a
                              className="inline-link"
                              href={bullet.link.href}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {bullet.link.label}
                            </a>
                            {bullet.after}
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="skills" className="section" data-animate>
          <div className="container">
            <div className="section-heading">
              <h2>Skills</h2>
              <p>
                Comfortable across the stack, from product thinking to
                infrastructure.
              </p>
            </div>
            <div className="skills-container">
              {skillCategories.map((cat) => (
                <div key={cat.title} className="skill-category" data-animate>
                  <h3 className="skill-category-title">
                    <span className="skill-icon">{cat.icon}</span>
                    {cat.title}
                  </h3>
                  <div className="skill-tags">
                    {cat.tags.map((tag) => (
                      <span key={tag} className="skill-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="education" className="section" data-animate>
          <div className="container">
            <div className="section-heading">
              <h2>Education</h2>
              <p>
                Computer Science, University of Jordan · GPA 3.66/4.00
              </p>
            </div>
            <div className="education-card" data-animate>
              <div>
                <p className="education-period">2017 – 2021</p>
                <p className="education-role">
                  Bachelor&apos;s in Computer Science
                </p>
              </div>
              <ul>
                <li>
                  Active judge, tester, and trainer in programming contests
                  (1,500+ problems solved).
                </li>
                <li>
                  Jordanian University Collegiate Programming Contest 2020 –
                  Gold (2nd).
                </li>
                <li>
                  Jordanian Collegiate Programming Contest 2020 – Bronze
                  (10th).
                </li>
                <li>
                  Jordanian University Collegiate Programming Contest 2019 –
                  Gold (3rd).
                </li>
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">
          <p>Built with intention · 2026</p>
          <a href="mailto:me@0x99m.com">me@0x99m.com</a>
        </div>
      </footer>
    </div>
  );
}

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  PenLine,
  ShieldCheck,
  Layers,
  SlidersHorizontal,
  Download,
  Sparkles,
  Menu,
  X,
  Type,
  ScanLine,
  Check,
} from "lucide-react";
import { styles } from "../engine/styles";
import { generate } from "../engine/generate";
import { renderPage } from "../engine/render";
import { defaults } from "../types";
import "./Landing.effects.css";
export function Brand() {
  return (
    <span className="brand">
      <i>
        <PenLine size={20} />
      </i>
      inkforge<span>AI</span>
    </span>
  );
}
export default function Landing({ onLaunch }: { onLaunch: () => void }) {
  const [style, setStyle] = useState("classic"),
    [text, setText] = useState("Some thoughts\nfeel better in ink."),
    [preview, setPreview] = useState(""),
    [menu, setMenu] = useState(false);
  const reduced = useReducedMotion(),
    reveal = {
      initial: { opacity: 0, y: reduced ? 0 : 20 },
      whileInView: { opacity: 1, y: 0 },
      viewport: { once: true },
      transition: { duration: 0.65 },
    };
  useEffect(() => {
    let canceled = false;
    generate({
      text: text || "Your words, handwritten.",
      mode: "default",
      engine: "browser",
      styleId: style,
      settings: { ...defaults, size: 52, margin: 65, paper: "ivory" },
      seed: 42,
      fallback: false,
    })
      .then((doc) => renderPage(doc, 0, 0.75))
      .then((c) => {
        if (!canceled) setPreview(c.toDataURL());
      })
      .catch(() => {});
    return () => {
      canceled = true;
    };
  }, [text, style]);
  return (
    <div className="landing">
      <div className="landing-atmosphere" aria-hidden="true">
        <div className="landing-aurora landing-aurora-violet" />
        <div className="landing-aurora landing-aurora-cyan" />
        <div className="landing-grid" />
      </div>
      <nav className="landing-nav">
        <a href="#" aria-label="InkForge home">
          <Brand />
        </a>
        <div className="nav-links">
          <a href="#styles">The styles</a>
          <a href="#how">How it works</a>
          <a href="#technology">Technology</a>
        </div>
        <button className="button small" onClick={onLaunch}>
          Open studio <ArrowUpRight size={15} />
        </button>
        <button
          className="mobile-menu"
          aria-label={menu ? "Close navigation" : "Open navigation"}
          aria-expanded={menu}
          onClick={() => setMenu((v) => !v)}
        >
          {menu ? <X size={19} /> : <Menu size={19} />}
        </button>
        {menu && (
          <div className="mobile-links">
            <a href="#styles" onClick={() => setMenu(false)}>
              Explore styles
            </a>
            <a href="#how" onClick={() => setMenu(false)}>
              How it works
            </a>
            <a href="#technology" onClick={() => setMenu(false)}>
              Technology & privacy
            </a>
          </div>
        )}
      </nav>
      <main>
        <section className="hero">
          <motion.div {...reveal} className="hero-copy">
            <span className="eyebrow">
              <span className="dot" /> DIGITAL PRECISION. HUMAN EXPRESSION.
            </span>
            <h1>
              Your words.
              <br />
              Your handwriting.
              <br />
              <em>Infinite possibilities.</em>
            </h1>
            <p>
              Give digital words a handwritten soul.
              <br />
              Choose a ready-to-write style, or make the letters
              <br className="desktop-break" /> unmistakably yours.
            </p>
            <div className="hero-actions">
              <button className="button primary" onClick={onLaunch}>
                Start writing <ArrowUpRight size={18} />
              </button>
              <a href="#styles" className="text-link">
                Explore handwriting styles <ArrowRight size={15} />
              </a>
            </div>
            <span className="hero-note">
              <ShieldCheck size={14} /> Free to create. No account required.
            </span>
            <div className="landing-capabilities" aria-label="Available features">
              <span><PenLine size={13} /> Personal handwriting</span>
              <span><Layers size={13} /> Custom paper</span>
              <span><Download size={13} /> PDF & PNG</span>
            </div>
          </motion.div>
          <motion.div
            {...reveal}
            transition={{ duration: 0.8, delay: 0.15 }}
            className="hero-art"
          >
            <div className="landing-stage-grid" aria-hidden="true" />
            <div className="landing-stage-orbit" aria-hidden="true" />
            <svg className="landing-flow-lines" viewBox="0 0 560 500" fill="none" aria-hidden="true">
              <path d="M45 420H120Q155 420 155 385V300Q155 270 185 270H400Q435 270 435 235V80" />
              <path d="M80 105H220Q245 105 245 130V365Q245 395 275 395H505" />
              <circle cx="45" cy="420" r="4" />
              <circle cx="435" cy="80" r="4" />
              <circle cx="505" cy="395" r="4" />
            </svg>
            <div className="landing-stage-label"><span className="dot" /> LIVE CANVAS <span>01 / INKFORGE</span></div>
            <div className="digital-card">
              <span>
                <Type size={13} /> YOUR WORDS
              </span>
              <textarea
                aria-label="Try typed text"
                value={text}
                maxLength={110}
                onChange={(e) => setText(e.target.value)}
              />
              <small>
                Try changing these words <ArrowUpRight size={11} />
              </small>
            </div>
            <div className="conversion-mark">
              <PenLine size={23} />
            </div>
            <div className="hero-paper">
              <div className="hero-paper-meta">
                A LITTLE MORE HUMAN <span>01</span>
              </div>
              {preview && (
                <img
                  src={preview}
                  alt="Actual browser-rendered handwriting preview"
                />
              )}
              <div className="hero-paper-footer">
                <span className="dot" />{" "}
                {styles.find((s) => s.id === style)?.name} / browser preset
              </div>
            </div>
            <div className="landing-ink-signal" aria-hidden="true">
              <span><PenLine size={15} /></span>
              <div>From thought to ink<small>Made with your words.</small></div>
              <i /><i /><i /><i /><i />
            </div>
            <span className="art-caption">
              Live browser rendering · choose a preset below
            </span>
          </motion.div>
        </section>
        <div className="format-strip">
          <span>THE FEELING OF INK. THE FREEDOM OF DIGITAL.</span>
          <div>
            TYPE <ArrowRight size={13} /> CHOOSE A STYLE{" "}
            <ArrowRight size={13} /> MAKE IT YOURS
          </div>
        </div>
        <section className="section" id="styles">
          <motion.div {...reveal} className="section-heading">
            <span className="eyebrow">FIND YOUR KIND OF HANDWRITING</span>
            <h2>
              Four styles.
              <br />A thousand ways to say it.
            </h2>
            <p>
              Distinct, openly licensed browser presets. Choose one to try the
              live preview above.
            </p>
          </motion.div>
          <div className="landing-styles">
            {styles.map((s, i) => (
              <motion.button
                {...reveal}
                key={s.id}
                aria-pressed={s.id === style}
                className={s.id === style ? "selected" : ""}
                onClick={() => {
                  setStyle(s.id);
                  document
                    .querySelector(".hero-art")
                    ?.scrollIntoView({ block: "center", behavior: reduced ? "instant" : "smooth" });
                }}
              >
                <span className="style-number">
                  0{i + 1} {s.id === style ? <Check size={15} /> : <ArrowUpRight size={15} />}
                </span>
                <span
                  className="style-specimen"
                  style={{ fontFamily: s.family }}
                >
                  Stay curious.
                </span>
                <strong>{s.name}</strong>
                <small>{s.description}</small>
                <span className="engine-tag">BROWSER PRESET</span>
              </motion.button>
            ))}
          </div>
        </section>
        <section className="section personal-section">
          <motion.div {...reveal}>
            <span className="eyebrow">YOUR HANDWRITING. A NEW MEDIUM.</span>
            <h2>
              The little things
              <br />
              that make it <em>you.</em>
            </h2>
            <p>
              The curve of an “a”. A familiar slant. Upload a handwritten note
              and bring its original word shapes into your next page.
            </p>
            <p className="muted">
              Matching words reuse ink from your document. Review the recognized
              labels, add letter samples, or use the optional local neural engine
              to approximate words your note does not contain.
            </p>
            <button className="button" onClick={onLaunch}>
              Explore personal handwriting <ArrowUpRight size={15} />
            </button>
          </motion.div>
          <div className="personal-visual">
            <div className="glyph-card">
              <span>YOUR INK, REIMAGINED</span>
              <div style={{ fontFamily: "Caveat" }}>
                a <i>b</i> c <i>d</i>
              </div>
              <small>Illustrative worksheet samples</small>
            </div>
            <div className="personal-callout">
              <ScanLine size={19} />
              <div>
                Original ink. New possibilities.
                <small>Upload. Review. Create.</small>
              </div>
            </div>
          </div>
        </section>
        <section className="section" id="how">
          <motion.div {...reveal} className="section-heading">
            <span className="eyebrow">FROM A THOUGHT TO A PAGE</span>
            <h2>Make something worth keeping.</h2>
          </motion.div>
          <div className="steps">
            {[
              {
                name: "Type.",
                text: "Your words stay your words. Paste a letter, a note, or a whole chapter.",
                icon: Type,
              },
              {
                name: "Choose.",
                text: "Start with a browser preset. Add your personal handwriting whenever you like.",
                icon: PenLine,
              },
              {
                name: "Generate.",
                text: "Shape the paper, ink, spacing, and rhythm. See your pages come to life.",
                icon: Sparkles,
              },
              {
                name: "Download.",
                text: "Take your finished pages into a high-resolution PDF or PNG.",
                icon: Download,
              },
            ].map((step, i) => (
              <motion.article {...reveal} key={step.name}>
                <div>
                  <span>0{i + 1}</span>
                  <step.icon size={21} />
                </div>
                <h3>{step.name}</h3>
                <p>{step.text}</p>
              </motion.article>
            ))}
          </div>
        </section>
        <section className="section technology" id="technology">
          <motion.div {...reveal}>
            <span className="eyebrow">KNOW WHAT MAKES THE MARK.</span>
            <h2>
              Three real engines.
              <br />
              One honest studio.
            </h2>
            <p>
              Browser presets render licensed fonts. Personal mode reuses words
              from your note or letters you extracted. Optional DiffusionPen
              approximates new words in your style through a local Python service.
            </p>
            <p className="muted">
              Every preview identifies its engine. Neural generation can make
              spelling and style errors. Free static hosting serves the browser
              engines; it does not supply a diffusion GPU.
            </p>
          </motion.div>
          <div className="tech-list">
            <div>
              <PenLine size={19} />
              <span>
                Ready-to-write presets
                <small>Works in your browser. No upload required.</small>
              </span>
              <span className="tech-label">LOCAL</span>
            </div>
            <div>
              <ScanLine size={19} />
              <span>
                Your original handwriting
                <small>
                  Uploaded word samples and extracted letter shapes.
                </small>
              </span>
              <span className="tech-label">LOCAL</span>
            </div>
            <div>
              <Sparkles size={19} />
              <span>
                DiffusionPen synthesis
                <small>
                  Optional Python service with verified checkpoints.
                </small>
              </span>
              <span className="tech-label">OPTIONAL</span>
            </div>
          </div>
        </section>
        <section className="section finishing">
          <motion.div {...reveal} className="section-heading">
            <span className="eyebrow">THE FINISH IS YOURS.</span>
            <h2>More than just letters.</h2>
          </motion.div>
          <div className="finishing-grid">
            <article>
              <Layers />
              <h3>A page for every thought.</h3>
              <p>
                A4 or US Letter. Plain, ivory, ruled, dotted, or grid. Automatic
                wrapping and multiple pages.
              </p>
            </article>
            <article>
              <SlidersHorizontal />
              <h3>A rhythm that feels right.</h3>
              <p>
                Fine-tune writing size, spacing, slant, ink, and seeded
                variation. Preview and export use the same layout.
              </p>
            </article>
            <article>
              <ShieldCheck />
              <h3>Your words stay close.</h3>
              <p>
                Browser rendering and storage stay on your device. Neural
                references go only to the local service when you choose that
                engine.
              </p>
            </article>
          </div>
        </section>
        <motion.section {...reveal} className="final-cta">
          <span className="eyebrow">YOUR NEXT PAGE IS WAITING.</span>
          <h2>
            Make every word
            <br />
            <em>feel like you.</em>
          </h2>
          <button className="button primary" onClick={onLaunch}>
            Open InkForge studio <ArrowUpRight size={18} />
          </button>
        </motion.section>
      </main>
      <footer className="landing-footer">
        <Brand />
        <span>Digital words. Human expression.</span>
        <a href="#technology">
          Technology & privacy <ArrowUpRight size={13} />
        </a>
      </footer>
    </div>
  );
}

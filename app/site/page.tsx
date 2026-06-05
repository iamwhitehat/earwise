'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { track } from '@vercel/analytics'
import { ScanDemo } from '../_components/scan-demo'
import { FAQS } from './faqs'
import './earwise-site.css'

// ── signal-burst mark ────────────────────────────────────────────────────────
// A node broadcasting arcs up-and-to-the-right. Lime variant carries the `bmark`
// class so the stylesheet recolors it to deep-green on light surfaces; the
// near-black variant (sidebar tile, band watermark) sits on lime and stays dark.
function BurstMark({
  size = 26,
  className,
  c = '#B6FF3C',
  outer = '#9BE22A',
  sw = 16,
  style,
}: {
  size?: number
  className?: string
  c?: string
  outer?: string
  sw?: number
  style?: CSSProperties
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" className={className} style={style} aria-hidden="true">
      <circle cx="96" cy="170" r="15" fill={c} />
      <path d="M135,170 A39,39 0 0 0 96,131" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" />
      <path d="M167,170 A71,71 0 0 0 96,99" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" />
      <path d="M199,170 A103,103 0 0 0 96,67" fill="none" stroke={outer} strokeWidth={sw} strokeLinecap="round" />
    </svg>
  )
}

const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#0E0F13" strokeWidth="2.5">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

export default function EarwiseSite() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [scrolled, setScrolled] = useState(false)
  const [showSticky, setShowSticky] = useState(false)
  const [stickyDismissed, setStickyDismissed] = useState(false)
  const [openFaq, setOpenFaq] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  // theme: dark-first, persisted (own key so it never clashes with the app's)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('earwise:theme')
      if (saved === 'light' || saved === 'dark') setTheme(saved)
    } catch {
      /* storage unavailable */
    }
  }, [])

  function toggleTheme() {
    setTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light'
      try {
        localStorage.setItem('earwise:theme', next)
      } catch {
        /* storage unavailable */
      }
      return next
    })
  }

  // nav shadow + sticky-CTA visibility on scroll (CTA appears once past the hero)
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 12)
      setShowSticky(window.scrollY > window.innerHeight * 0.9)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // reveal-on-scroll
  useEffect(() => {
    const els = rootRef.current?.querySelectorAll('.reveal')
    if (!els || els.length === 0) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <div className="ew-site" data-theme={theme} ref={rootRef}>
      {/* ============ NAV ============ */}
      <header className={`nav${scrolled ? ' scrolled' : ''}`}>
        <div className="wrap nav-in">
          <a href="#top" className="brand">
            <BurstMark size={26} className="bmark" />
            earwise
          </a>
          <nav className="nav-links">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#mission">Mission</a>
            <a href="#faq">FAQ</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <div className="nav-cta">
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label="Toggle light or dark theme"
              title="Toggle theme"
            >
              <svg className="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
              <svg className="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="4.5" />
                <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
              </svg>
            </button>
            <Link href="/login" className="signin">Sign in</Link>
            <a href="#try" className="btn btn-lime btn-sm">
              Scan free
              <Arrow />
            </a>
          </div>
        </div>
      </header>

      {/* ============ HERO ============ */}
      <section className="hero" id="top">
        <div className="hero-glow" />
        <div className="hero-grid" />
        <div className="wrap hero-in">
          <span className="pill"><b>NEW</b> Reply to high-intent threads the same day they post</span>
          <h1>See who&apos;s asking to buy what you sell — <span className="sig">right now.</span></h1>
          <p className="hero-sub">
            earwise scans Reddit, Hacker News &amp; StackOverflow for people actively looking for what
            you offer — and drafts a reply in your voice. Type your niche and watch it happen, free.
          </p>
          {/* The live demo IS the hero — type a niche, get real buyers + a drafted reply. */}
          <div id="try" style={{ maxWidth: 640, margin: '26px auto 0' }}>
            <ScanDemo />
          </div>
          <div className="hero-trust">
            <span><span className="ck">✓</span> No signup, no card</span>
            <span><span className="ck">✓</span> Real Reddit threads, cited</span>
            <span><span className="ck">✓</span> <a href="#how" style={{ color: 'inherit' }}>See how it works ↓</a></span>
          </div>

        </div>
      </section>

      {/* ============ LOGO CLOUD ============ */}
      <section className="cloud wrap">
        <p className="cloud-wedge">Like <b>GummySearch</b> for Reddit demand — but earwise finds the buyer <strong>and</strong> drafts the reply.</p>
        <div className="cloud-row">
          {['r/SaaS', 'r/startups', 'r/Entrepreneur', 'r/indiehackers', 'r/SideProject', 'r/marketing'].map((s) => (
            <span key={s} className="cloud-logo"><span className="ph" />{s}</span>
          ))}
        </div>
      </section>

      {/* ============ PROBLEM ============ */}
      <section className="sec">
        <div className="wrap">
          <div className="sec-head reveal">
            <span className="kicker">The problem</span>
            <h2 className="h2">You&apos;re guessing at demand.<br />Your buyers already said what they want.</h2>
            <p className="lead">They&apos;re posting it in public, every day — the frustration, the workaround, the &quot;is there a tool that…&quot;. Most founders never see it, drown in noise, or show up a week too late.</p>
          </div>
          <div className="prob-grid">
            {[
              { h: 'Surveys lie', p: 'People tell you what sounds reasonable. Unprompted threads tell you what actually hurts — in their own words.' },
              { h: 'The signal drowns', p: "One real buyer per hundred posts. Reading it by hand doesn't scale, and the gold sinks before you find it." },
              { h: 'You show up late', p: 'By the time a trend is obvious, the thread is buried and ten competitors already replied. Early is the whole game.' },
            ].map((c) => (
              <div className="prob-card reveal" key={c.h}>
                <div className="x"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg></div>
                <h3>{c.h}</h3>
                <p>{c.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section className="sec" id="how">
        <div className="wrap">
          <div className="sec-head reveal">
            <span className="kicker">How it works</span>
            <h2 className="h2">From raw threads to your next move — automatically.</h2>
            <p className="lead">Point earwise at the places your buyers gather. It does the reading, the ranking, and the first draft. You make the call.</p>
          </div>
          <div className="steps">
            {[
              { n: '01', h: 'Watch', p: 'Add the subreddits where your market actually talks. Start from a preset or let earwise suggest the right ones.' },
              { n: '02', h: 'Read', p: 'Every post is classified — pain point, feature request, tool complaint — so nothing real slips past you.' },
              { n: '03', h: 'Rank', p: 'Threads roll up into scored opportunities, live trends, and the exact buyer language people use.' },
              { n: '04', h: 'Reply', p: 'High-intent signals come with a drafted opener that cites the thread. Edit, post, win the lane.' },
            ].map((s) => (
              <div className="step reveal" key={s.n}>
                <div className="step-n">{s.n}</div>
                <h3>{s.h}</h3>
                <p>{s.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FEATURES ============ */}
      <section className="sec" id="features">
        <div className="wrap">
          <div className="sec-head center reveal">
            <span className="kicker center">What you get</span>
            <h2 className="h2">Everything you need to read demand and act on it.</h2>
          </div>

          {/* Feature 1: Signals */}
          <div className="feat reveal">
            <div className="feat-copy">
              <p className="feat-tag">Signals</p>
              <h3>The threads worth your time, ranked by intent.</h3>
              <p>earwise scores every post on how badly the person wants a solution — engagement, language, recency — and floats the highest-intent ones to the top. No more doomscrolling for a needle.</p>
              <ul className="feat-list">
                <li>Intent scoring tuned for &quot;I&apos;d pay for this&quot; moments</li>
                <li>Spike detection when a topic suddenly heats up</li>
                <li>Every signal links straight to the live thread</li>
              </ul>
            </div>
            <div className="feat-visual">
              <div className="sig-card" style={{ margin: '0 0 12px' }}>
                <div className="sig-score">94<small>SCORE</small></div>
                <div className="sig-body">
                  <div className="sig-meta">r/SaaS · 2h ago · 47 upvotes</div>
                  <p className="sig-title">&quot;Tired of guessing what to build next. Is there a tool that reads Reddit for demand?&quot;</p>
                  <div className="sig-tags"><span className="sig-tag spike">▲ spiking</span><span className="sig-tag">pain point</span></div>
                </div>
              </div>
              <div className="sig-card" style={{ margin: '0 0 12px' }}>
                <div className="sig-score">88<small>SCORE</small></div>
                <div className="sig-body">
                  <div className="sig-meta">r/startups · 5h ago · 33 upvotes</div>
                  <p className="sig-title">&quot;How do you all validate demand before writing a line of code?&quot;</p>
                  <div className="sig-tags"><span className="sig-tag">feature request</span><span className="sig-tag">high intent</span></div>
                </div>
              </div>
              <div className="sig-card" style={{ margin: 0 }}>
                <div className="sig-score mid">71<small>SCORE</small></div>
                <div className="sig-body">
                  <div className="sig-meta">r/indiehackers · 11h ago · 19 upvotes</div>
                  <p className="sig-title">&quot;Wish something just told me which subreddits my buyers hang out in.&quot;</p>
                  <div className="sig-tags"><span className="sig-tag">tool complaint</span></div>
                </div>
              </div>
            </div>
          </div>

          {/* Feature 2: Buyer Language */}
          <div className="feat flip reveal">
            <div className="feat-copy">
              <p className="feat-tag">Buyer Language</p>
              <h3>Write copy in the exact words your buyers use.</h3>
              <p>earwise mines the recurring phrases across every thread — the way real people describe the pain. Drop them straight into your landing page, ads, and cold emails. No more marketing-speak.</p>
              <ul className="feat-list">
                <li>Ranked phrases by how often buyers actually say them</li>
                <li>Grouped by pain, desire, and objection</li>
                <li>One-click export to your swipe file</li>
              </ul>
            </div>
            <div className="feat-visual">
              <p className="bl-head">Top buyer phrases · r/SaaS · 30d</p>
              <div className="bl-phrase"><span className="bl-q">&quot;<span className="hl">tired of guessing</span> what to build&quot;</span><span className="bl-bar"><i style={{ width: '92%' }} /></span><span className="bl-n">142</span></div>
              <div className="bl-phrase"><span className="bl-q">&quot;<span className="hl">validate demand</span> before I build&quot;</span><span className="bl-bar"><i style={{ width: '78%' }} /></span><span className="bl-n">118</span></div>
              <div className="bl-phrase"><span className="bl-q">&quot;<span className="hl">where my buyers</span> actually hang out&quot;</span><span className="bl-bar"><i style={{ width: '64%' }} /></span><span className="bl-n">97</span></div>
              <div className="bl-phrase"><span className="bl-q">&quot;surveys feel <span className="hl">useless</span>&quot;</span><span className="bl-bar"><i style={{ width: '51%' }} /></span><span className="bl-n">73</span></div>
              <div className="bl-phrase"><span className="bl-q">&quot;too much <span className="hl">noise to read by hand</span>&quot;</span><span className="bl-bar"><i style={{ width: '40%' }} /></span><span className="bl-n">58</span></div>
            </div>
          </div>

          {/* Feature 3: Opportunities */}
          <div className="feat reveal">
            <div className="feat-copy">
              <p className="feat-tag">Opportunity Score</p>
              <h3>See which problems are worth building for.</h3>
              <p>Individual threads roll up into ranked opportunities — weighted by volume, engagement, and growth — so you can tell a one-off rant from a market that&apos;s quietly on fire.</p>
              <ul className="feat-list">
                <li>Log-scaled scoring that won&apos;t saturate on big subs</li>
                <li>Week-over-week trend so you catch the rise, not the peak</li>
                <li>Drill into any score to read the threads behind it</li>
              </ul>
            </div>
            <div className="feat-visual">
              <p className="bl-head">Top opportunities · this week</p>
              {[
                { r: '01', n: 'Demand validation tooling', s: 'pain point · 142 posts', w: '94%', sc: '94', up: '+38%' },
                { r: '02', n: 'Reddit lead discovery', s: 'feature request · 96 posts', w: '81%', sc: '81', up: '+22%' },
                { r: '03', n: 'Buyer-language mining', s: 'tool complaint · 64 posts', w: '73%', sc: '73', up: '+12%' },
                { r: '04', n: 'Sub recommendation', s: 'feature request · 41 posts', w: '58%', sc: '58', up: '+7%' },
              ].map((o) => (
                <div className="opp-card" key={o.r}>
                  <span className="opp-rank">{o.r}</span>
                  <span className="opp-name">{o.n}<small>{o.s}</small></span>
                  <span className="opp-track"><i style={{ width: o.w }} /></span>
                  <span className="opp-score">{o.sc}</span>
                  <span className="opp-up">{o.up}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Feature 4: AI Replies */}
          <div className="feat flip reveal">
            <div className="feat-copy">
              <p className="feat-tag">AI-drafted replies</p>
              <h3>Show up helpful, the same day they ask.</h3>
              <p>Every high-intent signal comes with a drafted opener that references their actual post — helpful first, never spammy. Tweak the tone, paste it in, and be the founder who was there first.</p>
              <ul className="feat-list">
                <li>Grounded in the real thread — no generic templates</li>
                <li>Helpful-first tone you can dial up or down</li>
                <li>Track which lanes you&apos;ve already replied to</li>
              </ul>
            </div>
            <div className="feat-visual reply-mock">
              <div className="reply-src">&quot;Anyone found a tool that pulls buyer language straight from Reddit threads? Tired of guessing.&quot; — r/SaaS</div>
              <div className="reply-draft">
                <span className="lbl">Drafted opener</span>
                Funny timing — I got tired of the exact same guessing game. The trick that worked for me was pulling the recurring phrases across threads instead of reading one-by-one. Happy to share the list I built for this space if it&apos;s useful.
              </div>
              <div className="reply-actions">
                <span className="b">Regenerate</span>
                <span className="b">Adjust tone</span>
                <span className="b go">Copy &amp; open thread</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ PROOF BAND ============ */}
      <section className="band">
        <BurstMark size={280} className="band-mark" c="#0E0F13" outer="#0E0F13" sw={16} />
        <div className="wrap">
          <span className="kicker">Evidence, not vibes</span>
          <h2>Every insight earwise gives you links back to a real thread you can read.</h2>
          <p>No black-box &quot;trends.&quot; No invented numbers. If earwise says demand is spiking, you can click through to the exact posts and see it for yourself — then reply while it&apos;s still hot.</p>
          <div className="band-stats">
            <div className="band-stat"><div className="v">Every post</div><div className="k">read &amp; classified — pain, feature, or complaint</div></div>
            <div className="band-stat"><div className="v">Same day</div><div className="k">from a fresh post to a drafted, ready-to-post reply</div></div>
            <div className="band-stat"><div className="v">100%</div><div className="k">of signals cited to the source thread, every time</div></div>
          </div>
        </div>
      </section>

      {/* ============ MISSION ============ */}
      <section className="sec mission" id="mission">
        <div className="wrap">
          <span className="kicker center">Our mission</span>
          <p className="big">Help founders build what the market is <span className="sig">already asking for</span> — and get there before anyone else is listening.</p>
          <p className="by">{'// earwise — catch the signal first'}</p>
        </div>
      </section>

      {/* ============ FAQ (before pricing — deflate objections before the ask) ===== */}
      <section className="sec" id="faq">
        <div className="wrap">
          <div className="sec-head center reveal">
            <span className="kicker center">Questions</span>
            <h2 className="h2">Good. Ask away.</h2>
          </div>
          <div className="faq">
            {FAQS.map((f, i) => (
              <details className="qa" key={f.q} open={openFaq === i}>
                <summary
                  onClick={(e) => {
                    e.preventDefault()
                    setOpenFaq((cur) => (cur === i ? -1 : i))
                  }}
                >
                  {f.q}<span className="plus" />
                </summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ============ PRICING ============ */}
      <section className="sec" id="pricing">
        <div className="wrap">
          <div className="sec-head center reveal">
            <span className="kicker center">Pricing</span>
            <h2 className="h2">Start free. Upgrade when the signal pays for itself.</h2>
            <p className="lead" style={{ margin: '0 auto' }}>One winning reply covers it. Cancel anytime — your watchlist and exports come with you.</p>
          </div>
          <div className="price-grid">
            <div className="price reveal">
              <div className="price-name">Starter</div>
              <div className="price-desc">For testing the waters and your first validation sprint.</div>
              <div className="price-amt"><span className="n">$0</span><span className="per">/ forever</span></div>
              <div className="price-note">no card required</div>
              <Link href="/login" className="btn btn-ghost">Start free</Link>
              <ul className="price-feats">
                <li>3 watched subreddits</li>
                <li>Weekly scans</li>
                <li>Signals &amp; opportunity scores</li>
                <li className="off">Buyer-language mining</li>
                <li className="off">AI-drafted replies</li>
              </ul>
            </div>
            <div className="price pop reveal">
              <span className="price-pop-tag">Most popular</span>
              <div className="price-name">Pro</div>
              <div className="price-desc">For founders actively hunting demand and replying daily.</div>
              <div className="price-amt"><span className="n">$39</span><span className="per">/ month</span></div>
              <div className="price-note">billed monthly · or $29/mo yearly</div>
              <Link href="/login?plan=pro" className="btn btn-lime">Start 14-day trial</Link>
              <ul className="price-feats">
                <li>25 watched subreddits</li>
                <li>Daily scans + spike alerts</li>
                <li>Full buyer-language mining</li>
                <li>AI-drafted replies &amp; openers</li>
                <li>Markdown / CSV export</li>
              </ul>
            </div>
            <div className="price reveal">
              <div className="price-name">Scale</div>
              <div className="price-desc">For teams running demand intel as a channel.</div>
              <div className="price-amt"><span className="n">$99</span><span className="per">/ month</span></div>
              <div className="price-note">billed monthly · 3 seats included</div>
              <Link href="/login" className="btn btn-ghost">Talk to us</Link>
              <ul className="price-feats">
                <li>Unlimited subreddits</li>
                <li>Hourly scans + real-time alerts</li>
                <li>Team seats &amp; shared lanes</li>
                <li>Advanced scoring &amp; trends</li>
                <li>API access</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="cta">
        <div className="cta-glow" />
        <div className="wrap cta-in">
          <BurstMark size={60} className="bmark" style={{ marginBottom: 26 }} />
          <h2>Your buyers are talking <span className="sig">right now.</span></h2>
          <p>Point earwise at them and see the demand within a minute. Free to start, no card.</p>
          <div className="hero-cta">
            <Link href="/scan" className="btn btn-lime">
              Scan your niche free
              <Arrow />
            </Link>
            <Link href="/login" className="btn btn-ghost">Create account</Link>
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="footer">
        <div className="wrap">
          <div className="foot-top">
            <div className="foot-brand">
              <a href="#top" className="brand">
                <BurstMark size={26} className="bmark" />
                earwise
              </a>
              <p>Demand intelligence for founders. Find what the market is broadcasting — and the opening you can win.</p>
              <p className="foot-tag">Catch the signal first.</p>
            </div>
            <div className="foot-col">
              <h4>Product</h4>
              <a href="#features">Signals</a>
              <a href="#features">Buyer language</a>
              <a href="#features">Opportunities</a>
              <a href="#features">AI replies</a>
              <a href="#pricing">Pricing</a>
            </div>
            <div className="foot-col">
              <h4>Company</h4>
              <a href="#mission">Mission</a>
              <a href="#how">How it works</a>
              <a href="#faq">FAQ</a>
              <a href="#">Changelog</a>
            </div>
            <div className="foot-col">
              <h4>Get started</h4>
              <Link href="/scan">Free scan</Link>
              <Link href="/login">Sign in</Link>
              <a href="#pricing">Pricing</a>
              <a href="mailto:hello@earwise.io">Contact</a>
            </div>
          </div>
          <div className="foot-bot">
            <p>© 2026 earwise · earwise.io</p>
            <p>Built for founders who&apos;d rather know than guess.</p>
          </div>
        </div>
      </footer>

      {/* Sticky CTA — appears once the visitor scrolls past the hero/demo. */}
      {!stickyDismissed && (
        <div className={`sticky-cta${showSticky ? ' show' : ''}`}>
          <p>See every buyer in your niche — plus a fresh batch every day.</p>
          <Link href="/login" className="btn btn-lime btn-sm" onClick={() => track('signup_click', { from: 'sticky' })}>
            Create free account
            <Arrow />
          </Link>
          <button className="sticky-dismiss" aria-label="Dismiss" onClick={() => setStickyDismissed(true)}>×</button>
        </div>
      )}
    </div>
  )
}

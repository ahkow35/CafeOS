import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';

export const metadata: Metadata = {
  title: 'CafeOS — staff leave, timesheets and claims for cafés',
  description:
    "Run your café's staff admin from your phone: leave, medical claims, part-timer timesheets and daily checklists in one place, with approvals sent straight to Telegram.",
  openGraph: {
    title: 'CafeOS — staff leave, timesheets and claims for cafés',
    description:
      "Run your café's staff admin from your phone: leave, medical claims, part-timer timesheets and daily checklists in one place, with approvals sent straight to Telegram.",
  },
};

const FEATURES = [
  {
    title: 'Leave',
    body: 'Staff apply for annual or medical leave. A manager reviews first, then the owner gives the final approval.',
  },
  {
    title: 'Medical claims',
    body: 'Staff submit a claim with a photo of the receipt. You set a yearly cap per person and approve with one tap.',
  },
  {
    title: 'Timesheets',
    body: 'Part-timers log their hours and sign off each month. Export a sheet ready for payroll.',
  },
  {
    title: 'Staff tasks',
    body: 'Opening and closing checklists, assigned to one person or everyone, ticked off during the shift.',
  },
];

const STAFF_POINTS = [
  {
    title: 'Mobile number and PIN',
    body: 'No email address or password to remember.',
  },
  {
    title: 'Works in the browser',
    body: 'Add it to the home screen like an app — nothing to download from a store.',
  },
  {
    title: 'One login, several cafés',
    body: 'Staff who work at more than one of your cafés use the same account and pick which one to open.',
  },
];

const OWNER_POINTS = [
  {
    title: 'Two-step approvals',
    body: 'A manager reviews a request first, then the owner gives the final approval.',
  },
  {
    title: 'Everything on record',
    body: 'Every request and decision is kept, with who approved it and when.',
  },
  {
    title: 'Telegram alerts',
    body: 'Get a message the moment a request needs your approval.',
  },
];

export default function HomePage() {
  return (
    <>
      <header className="home-nav">
        <div className="home-in home-nav-row">
          <div className="home-brand">
            <Image src="/logo.svg" alt="" width={26} height={26} unoptimized />
            <span>CafeOS</span>
          </div>
          <nav aria-label="Primary" className="home-nav-links">
            <a href="#features">Features</a>
            <a href="#staff">For staff</a>
            <Link href="/login" className="btn btn-sm">Sign in</Link>
            <Link href="/start" className="btn btn-primary btn-sm">Start free trial</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="home-hero">
          <div className="home-in home-hero-row">
            <div>
              <span className="home-eyebrow">For cafés and small F&amp;B teams in Singapore</span>
              <h1 className="home-h1">Run your café&apos;s staff admin from your phone.</h1>
              <p className="home-lede">
                Leave, medical claims, part-timer timesheets and daily checklists in one place.
                Staff sign in with their mobile number and a PIN — no email, no app store.
              </p>
              <div className="home-ctas">
                <Link href="/start" className="btn btn-primary btn-lg">Start free trial</Link>
                <a href="#features" className="btn btn-lg">See what it does</a>
              </div>
              <p className="home-fine">Tell us about your café and we&apos;ll set you up.</p>
            </div>
          </div>
        </section>

        <section id="features" className="home-band">
          <div className="home-in">
            <h2 className="home-h2">Everything that used to live in a group chat</h2>
            <p className="home-sub">Requests, approvals and records stay in one place, so nothing gets lost.</p>
            <div className="home-feats">
              {FEATURES.map((f) => (
                <div key={f.title} className="home-feat">
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="staff" className="home-band">
          <div className="home-in home-two">
            <div>
              <h2 className="home-h2">Easy for your staff</h2>
              <ul className="home-list">
                {STAFF_POINTS.map((p) => (
                  <li key={p.title}>
                    <span className="home-tick" aria-hidden="true">✓</span>
                    <div><b>{p.title}</b><span>{p.body}</span></div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="home-h2">In control as the owner</h2>
              <ul className="home-list">
                {OWNER_POINTS.map((p) => (
                  <li key={p.title}>
                    <span className="home-tick" aria-hidden="true">✓</span>
                    <div><b>{p.title}</b><span>{p.body}</span></div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="home-band">
          <div className="home-in">
            <div className="home-final">
              <div>
                <h2 className="home-h2">Try it with your team</h2>
                <p>Tell us about your café and we&apos;ll set you up.</p>
              </div>
              <Link href="/start" className="btn btn-primary btn-lg">Start free trial</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <div className="home-in home-footer-row">
          <span>© 2026 CafeOS</span>
          <span>
            <Link href="/login">Sign in</Link> · <Link href="/start">Start free trial</Link>
          </span>
        </div>
      </footer>
    </>
  );
}

'use client';

import { useState } from 'react';
import { ArrowRight, Brain, Zap, Shield, Bot } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { welcomeContent } from './content';

const FEATURE_ICONS: Record<string, LucideIcon> = { Bot, Brain, Shield };

export default function WelcomePage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    try {
      await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source: 'welcome' }),
      });
      setSubmitted(true);
    } catch {
      // Best-effort
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  const { hero, cta, features, pricing, footer } = welcomeContent;

  return (
    <div className="relative min-h-screen bg-black text-white">
      {/* Background effects */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 left-1/2 h-[800px] w-[800px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(200,184,240,0.08),transparent_70%)]" />
        <div className="absolute top-1/4 -right-1/4 h-[600px] w-[600px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(232,224,255,0.04),transparent_70%)]" />
      </div>

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 md:px-12">
        <div className="flex items-center gap-2">
          <Image
            src="/celune-logomark.svg"
            alt="Celune"
            className="h-7 w-auto"
            width={28}
            height={28}
            unoptimized
          />
          <span className="text-lg font-semibold tracking-tight">Celune</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-white/60 transition-colors hover:text-white">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-white/90"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main className="relative z-10 mx-auto max-w-4xl px-6 pt-24 pb-32 text-center md:pt-36">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm text-white/70">
          <Zap className="h-3.5 w-3.5" />
          {welcomeContent.badge}
        </div>

        <h1 className="mb-6 text-5xl leading-tight font-bold tracking-tight md:text-7xl">
          {hero.heading}
          <br />
          <span className="bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
            {hero.headingAccent}
          </span>
        </h1>

        <p className="mx-auto mb-12 max-w-2xl text-lg text-white/60 md:text-xl">
          {hero.description}
        </p>

        {/* CTA */}
        {submitted ? (
          <div className="inline-flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-6 py-3 text-green-400">
            {cta.successMessage}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/signup"
              className="flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-medium text-black transition-colors hover:bg-white/90"
            >
              {cta.primary}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <form onSubmit={handleWaitlist} className="flex items-center gap-2">
              <input
                type="email"
                placeholder={cta.waitlistPlaceholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
              />
              <button
                type="submit"
                disabled={submitting || !email.trim()}
                className="rounded-lg border border-white/20 px-4 py-3 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
              >
                {cta.waitlistButton}
              </button>
            </form>
          </div>
        )}
      </main>

      {/* Features */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pb-32">
        <div className="grid gap-6 md:grid-cols-3">
          {features.map((feature) => {
            const Icon = FEATURE_ICONS[feature.icon] ?? Bot;
            return (
              <div
                key={feature.title}
                className="rounded-xl border border-white/10 bg-white/[0.02] p-6"
              >
                <Icon className={`mb-4 h-8 w-8 ${feature.iconColor}`} />
                <h3 className="mb-2 text-lg font-semibold">{feature.title}</h3>
                <p className="text-sm text-white/50">{feature.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Pricing preview */}
      <section className="relative z-10 mx-auto max-w-3xl px-6 pb-32 text-center">
        <h2 className="mb-2 text-3xl font-bold">{pricing.heading}</h2>
        {'subtitle' in pricing && <p className="mb-8 text-sm text-white/50">{pricing.subtitle}</p>}
        <div className="mx-auto grid max-w-2xl gap-4 md:grid-cols-2">
          {pricing.tiers.map((tier) => (
            <div
              key={tier.name}
              className={
                tier.highlighted
                  ? 'rounded-xl border border-purple-500/30 bg-purple-500/5 p-6 ring-1 ring-purple-500/20'
                  : 'rounded-xl border border-white/10 bg-white/[0.02] p-6'
              }
            >
              <div
                className={`mb-1 text-sm ${tier.highlighted ? 'text-purple-400' : 'text-white/50'}`}
              >
                {tier.name}
              </div>
              <div className="mb-4 text-3xl font-bold">
                {tier.price}
                {tier.priceSuffix && (
                  <span className="text-lg text-white/40">{tier.priceSuffix}</span>
                )}
              </div>
              <ul className="space-y-2 text-left text-sm text-white/50">
                {tier.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 px-6 py-8 text-center text-xs text-white/30">
        <p>{footer}</p>
      </footer>
    </div>
  );
}

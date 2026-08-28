"use client";

import { useState } from "react";
import Link from "next/link";
import { ExploreNavigation, HeaderTools } from "./ExploreNavigation";
import { NEWS_PERIOD_OPTIONS } from "@/lib/news/periods";
import { useNewsPeriodPreference } from "@/hooks/useNewsPeriodPreference";
import { ThemeControl } from "./ThemeControl";

export function NewsSettings() {
  const [period, setPeriod] = useNewsPeriodPreference();
  const [saved, setSaved] = useState(false);

  return (
    <div className="site-frame" id="top">
      <header className="site-header settings-site-header">
        <Link className="brand" href="/" aria-label="Worldline home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>WORLDLINE</span>
        </Link>
        <ExploreNavigation active="settings" />
        <p>News preferences</p>
        <HeaderTools active="settings" />
      </header>

      <main className="settings-page">
        <section className="settings-intro" aria-labelledby="settings-title">
          <p className="eyebrow">Your briefing, your pace</p>
          <h1 id="settings-title">Choose how far back to look.</h1>
          <p>
            This becomes the default range on both country pages. Publisher availability varies,
            so a wider range can reveal more coverage without guaranteeing the same volume everywhere.
          </p>
        </section>

        <section className="settings-panel" aria-labelledby="range-title">
          <div className="settings-panel-heading">
            <div>
              <p className="eyebrow">Default time range</p>
              <h2 id="range-title">Published within</h2>
            </div>
            <span>Change this any time from the Published filter.</span>
          </div>

          <div className="period-options" role="radiogroup" aria-labelledby="range-title">
            {NEWS_PERIOD_OPTIONS.map((option) => (
              <label key={option.value} className={period === option.value ? "period-option selected" : "period-option"}>
                <input
                  type="radio"
                  name="news-period"
                  value={option.value}
                  checked={period === option.value}
                  onChange={() => { setPeriod(option.value); setSaved(true); }}
                />
                <span className="period-radio" aria-hidden="true" />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>

          <div className="settings-actions">
            <Link href="/country#stories">Return to the briefing</Link>
            <span role="status" aria-live="polite">{saved ? "Saved automatically. Your news pages will use this range." : "Choose a range to update your preference."}</span>
          </div>
        </section>

        <section className="settings-panel theme-settings-panel" aria-labelledby="theme-title">
          <div className="settings-panel-heading">
            <div>
              <p className="eyebrow">Appearance</p>
              <h2 id="theme-title">Color theme</h2>
            </div>
            <span>System is the default. A manual choice stays on this device.</span>
          </div>
          <div className="settings-theme-control">
            <ThemeControl />
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="brand footer-brand"><span className="brand-mark" aria-hidden="true"><span /></span><span>WORLDLINE</span></div>
        <p>Preferences are stored only in this browser.</p>
        <Link href="/country#top">Back to map ↑</Link>
      </footer>
    </div>
  );
}

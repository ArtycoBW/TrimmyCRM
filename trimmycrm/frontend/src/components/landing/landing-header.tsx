"use client";

import { useEffect, useState } from "react";

import { navigation } from "@/content/landing";
import { BrandMark } from "@/components/ui/brand-mark";
import { useHydrated } from "@/hooks/use-hydrated";
import { LandingHeaderActions } from "@/components/landing/landing-session";

export function LandingHeader() {
  const [open, setOpen] = useState(false);
  const hydrated = useHydrated();

  useEffect(() => {
    document.body.classList.toggle("menu-open", open);
    return () => document.body.classList.remove("menu-open");
  }, [open]);

  return (
    <header className="site-header">
      <div className="site-header__capsule">
        <a className="site-header__logo" href="#top" aria-label="TrimmyCRM — на главную">
          <BrandMark compact />
        </a>

        <button
          className="site-header__menu-button"
          type="button"
          aria-expanded={open}
          disabled={!hydrated}
          aria-controls="landing-navigation"
          aria-label={open ? "Закрыть меню" : "Открыть меню"}
          onClick={() => setOpen((value) => !value)}
        >
          <span />
          <span />
        </button>

        <nav
          className={`site-header__nav${open ? " site-header__nav--open" : ""}`}
          id="landing-navigation"
          aria-label="Основная навигация"
        >
          <div className="site-header__links">
            {navigation.map((item) => (
              <a key={item.href} href={item.href} onClick={() => setOpen(false)}>
                {item.label}
              </a>
            ))}
          </div>
          <div className="site-header__actions">
            <LandingHeaderActions />
          </div>
        </nav>
      </div>
    </header>
  );
}

"use client";

import { useEffect, useState } from "react";

import { navigation } from "@/content/landing";
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
          <span aria-hidden="true">T — CRM</span>
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
          {open ? "Закрыть" : "Меню"}
        </button>

        <nav
          className={`site-header__nav${open ? " site-header__nav--open" : ""}`}
          id="landing-navigation"
          aria-label="Основная навигация"
        >
          <p>НАВИГАЦИЯ / 2026</p>
          <div className="site-header__links">
            {navigation.map((item) => (
              <a key={item.href} href={item.href} onClick={() => setOpen(false)}>
                {item.label}
              </a>
            ))}
            <a href="#contact" onClick={() => setOpen(false)}>Контакты</a>
          </div>
          <div className="site-header__actions">
            <LandingHeaderActions />
          </div>
        </nav>
      </div>
    </header>
  );
}

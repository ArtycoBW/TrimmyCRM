"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, X } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import { LandingHeaderActions } from "@/components/landing/landing-session";
import { navigation } from "@/content/landing";
import { useHydrated } from "@/hooks/use-hydrated";

import styles from "./landing-header.module.css";

export function LandingHeader() {
  const [open, setOpen] = useState(false);
  const hydrated = useHydrated();

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <header className={styles.header}>
        <a className={styles.logo} href="#top" aria-label="TrimmyCRM, на главную">
          <span className={styles.logoSymbol}><Image src="/brand/trimmy-symbol.svg" alt="" width={44} height={44} priority /></span>
          <b><span>Trimmy</span><em>CRM</em></b>
        </a>

        <nav className={styles.desktopNav} aria-label="Основная навигация">
          {navigation.slice(0, 3).map((item) => (
            <a key={item.href} href={item.href}>{item.label}</a>
          ))}
        </nav>

        <Dialog.Trigger asChild>
          <button className={styles.menuButton} type="button" disabled={!hydrated}>
            Меню
            <span aria-hidden="true"><i /><i /></span>
          </button>
        </Dialog.Trigger>
      </header>

      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.drawer} aria-describedby={undefined}>
          <div className={styles.drawerBar}>
            <Dialog.Title className={styles.drawerTitle}>Навигация TrimmyCRM</Dialog.Title>
            <span className={styles.drawerLogo} aria-hidden="true"><b>Trimmy</b><em>CRM</em></span>
            <Dialog.Close className={styles.closeButton}>
              Закрыть <X aria-hidden="true" />
            </Dialog.Close>
          </div>

          <div className={styles.drawerBody}>
            <nav className={styles.drawerNav} aria-label="Навигация по лендингу">
              {[...navigation, { href: "#contact", label: "Контакты" }].map((item) => (
                <Dialog.Close asChild key={item.href}>
                  <a href={item.href}>
                    <span>{item.label}</span>
                    <ArrowUpRight aria-hidden="true" />
                  </a>
                </Dialog.Close>
              ))}
            </nav>

            <div className={styles.drawerAside}>
              <p>Сайт, онлайн-запись и CRM для парикмахерских и барбершопов.</p>
              <div className={styles.drawerActions}><LandingHeaderActions /></div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

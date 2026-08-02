import type { Route } from "next";
import Link from "next/link";
import { Children, cloneElement, isValidElement, type ReactNode } from "react";

import { legalConfig } from "@/components/legal/legal-config";
import { BrandMark } from "@/components/ui/brand-mark";

export function LegalDocument({
  eyebrow,
  title,
  summary,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <main className="legal-page">
      <header className="legal-header">
        <Link href="/" aria-label="TrimmyCRM — на главную"><BrandMark compact /></Link>
        <nav aria-label="Юридические документы">
          <Link href={"/terms" as Route}>Условия</Link>
          <Link href={"/privacy" as Route}>Политика</Link>
          <Link href={"/consent" as Route}>Согласие</Link>
          <Link href={"/data-processing-instructions" as Route}>Поручение</Link>
        </nav>
        <Link className="button button--ink button--small" href="/">На главную</Link>
      </header>

      <div className="legal-layout">
        <aside className="legal-aside">
          <p>{withCurrentBrand(eyebrow)}</p>
          <h1>{withCurrentBrand(title)}</h1>
          <span>Редакция от {legalConfig.effectiveDate}</span>
          <a href={`mailto:${legalConfig.email}`}>{legalConfig.email}</a>
        </aside>
        <article className="legal-document">
          <div className="legal-lead"><strong>Коротко</strong><p>{withCurrentBrand(summary)}</p></div>
          {withCurrentBrand(children)}
        </article>
      </div>

      <footer className="legal-footer">
        <BrandMark compact />
        <p>Юридические документы сервиса TrimmyCRM</p>
        <div><Link href={"/terms" as Route}>Условия сервиса</Link><Link href={"/privacy" as Route}>Персональные данные</Link><Link href={"/consent" as Route}>Согласие владельца</Link><Link href={"/client-consent" as Route}>Согласие клиента</Link><Link href={"/data-processing-instructions" as Route}>Поручение на обработку</Link></div>
      </footer>
    </main>
  );
}

export function LegalOperator() {
  return (
    <dl className="legal-requisites">
      <div><dt>Оператор и администратор сервиса</dt><dd>{legalConfig.operatorName}</dd></div>
      <div><dt>Адрес</dt><dd>{legalConfig.operatorAddress}</dd></div>
      <div><dt>Сайт</dt><dd>{legalConfig.website}</dd></div>
      <div><dt>Обращения и отзыв согласия</dt><dd><a href={`mailto:${legalConfig.email}`}>{legalConfig.email}</a></dd></div>
    </dl>
  );
}
function withCurrentBrand(value: ReactNode): ReactNode {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return Children.map(value, withCurrentBrand);
  if (isValidElement<{ children?: ReactNode }>(value)) {
    return cloneElement(value, undefined, withCurrentBrand(value.props.children));
  }
  return value;
}

"use client";

import { Download, FileSpreadsheet, FileText, LoaderCircle, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { AppSelect } from "@/components/ui/select";
import { apiRequest, downloadApiFile } from "@/lib/api/client";
import type { AnalyticsOverview, ServiceAnalytics } from "@/lib/api/types";
import { formatMoney } from "@/lib/app/dashboard";

const periods = [
  { value: "7", label: "7 дней" },
  { value: "30", label: "30 дней" },
  { value: "90", label: "90 дней" },
];

type ExportFormat = "csv" | "xlsx" | "pdf";

export function AnalyticsWorkspace() {
  const [period, setPeriod] = useState("30");
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [services, setServices] = useState<ServiceAnalytics[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  const query = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - Number(period) * 86_400_000);
    return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  }, [period]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      apiRequest<AnalyticsOverview>(`/analytics/overview?${query}`, { realm: "platform" }),
      apiRequest<ServiceAnalytics[]>(`/analytics/services?${query}`, { realm: "platform" }),
    ]).then(([metrics, serviceRows]) => {
      if (!alive) return;
      setError(null);
      setOverview(metrics);
      setServices(serviceRows);
    }).catch((reason) => {
      if (alive) setError(reason instanceof Error ? reason.message : "Не удалось загрузить аналитику");
    });
    return () => { alive = false; };
  }, [query]);

  const chartServices = useMemo(() => services.filter((item) => item.appointments > 0).slice(0, 8), [services]);
  const chartMaximum = Math.max(1, ...chartServices.map((item) => item.appointments));
  const revenueServices = useMemo(
    () => services.filter((item) => Number(item.revenue) > 0).sort((left, right) => Number(right.revenue) - Number(left.revenue)).slice(0, 8),
    [services],
  );
  const revenueMaximum = Math.max(1, ...revenueServices.map((item) => Number(item.revenue)));

  async function exportPdf() {
    if (!reportRef.current) throw new Error("Отчёт ещё не загрузился");
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);
    const canvas = await html2canvas(reportRef.current, {
      backgroundColor: "#f2ebdf",
      scale: Math.min(2, window.devicePixelRatio || 1),
      useCORS: true,
      logging: false,
    });
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 9;
    const imageWidth = pageWidth - margin * 2;
    const imageHeight = canvas.height * imageWidth / canvas.width;
    const image = canvas.toDataURL("image/jpeg", 0.92);
    let offset = margin;
    pdf.addImage(image, "JPEG", margin, offset, imageWidth, imageHeight, undefined, "FAST");
    let remaining = imageHeight - (pageHeight - margin * 2);
    while (remaining > 0) {
      pdf.addPage();
      offset -= pageHeight - margin * 2;
      pdf.addImage(image, "JPEG", margin, offset, imageWidth, imageHeight, undefined, "FAST");
      remaining -= pageHeight - margin * 2;
    }
    pdf.save(`analytics-${period}-days.pdf`);
  }

  async function handleExport(format: ExportFormat) {
    setExporting(format);
    setExportMessage(null);
    try {
      if (format === "pdf") await exportPdf();
      else await downloadApiFile(
        `/analytics/export/dashboard.${format}?${query}`,
        `analytics-${period}-days.${format}`,
      );
      setExportMessage(`Отчёт ${format.toUpperCase()} сформирован`);
    } catch (reason) {
      setExportMessage(reason instanceof Error ? reason.message : "Не удалось сформировать отчёт");
    } finally {
      setExporting(null);
    }
  }

  return (
    <section className="analytics-workspace" aria-labelledby="analytics-title">
      <header className="workspace-heading analytics-heading">
        <div>
          <p className="crm-kicker">Показатели салона</p>
          <h1 id="analytics-title">Аналитика</h1>
          <p>Выручка учитывает только завершённые визиты, а загрузка — рабочее время команды.</p>
        </div>
        <div className="analytics-heading__tools">
          <label className="analytics-period"><span>Период</span><AppSelect value={period} onValueChange={setPeriod} options={periods} /></label>
          <div className="analytics-export" aria-label="Скачать отчёт">
            <button type="button" onClick={() => void handleExport("csv")} disabled={!overview || exporting !== null}>
              {exporting === "csv" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Download aria-hidden="true" />} CSV
            </button>
            <button type="button" onClick={() => void handleExport("xlsx")} disabled={!overview || exporting !== null}>
              {exporting === "xlsx" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <FileSpreadsheet aria-hidden="true" />} Excel
            </button>
            <button type="button" onClick={() => void handleExport("pdf")} disabled={!overview || exporting !== null}>
              {exporting === "pdf" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <FileText aria-hidden="true" />} PDF
            </button>
          </div>
        </div>
      </header>
      {exportMessage && <p className="analytics-export__message" role="status">{exportMessage}</p>}
      {error && <section className="workspace-unavailable" role="alert" aria-labelledby="analytics-unavailable-title">
        <span><LockKeyhole aria-hidden="true" /></span>
        <div><p className="crm-kicker">Ограничение тарифа</p><h2 id="analytics-unavailable-title">Аналитика пока недоступна</h2><p>{error}</p></div>
        <Link href="/app/settings">Посмотреть тарифы →</Link>
      </section>}
      {!overview && !error && <div className="workspace-loading" aria-busy="true">Считаем показатели…</div>}
      {overview && (
        <div className="analytics-report" ref={reportRef}>
          <header className="analytics-report__header">
            <div><p className="crm-kicker">Отчёт за {period} дней</p><h2>Сводка по салону</h2></div>
            <span>{new Date(overview.from).toLocaleDateString("ru-RU")} — {new Date(overview.to).toLocaleDateString("ru-RU")}</span>
          </header>
          <div className="analytics-metrics">
            <article><span>Записи</span><strong>{overview.appointments}</strong></article>
            <article><span>Выручка</span><strong>{formatMoney(overview.revenue)}</strong></article>
            <article><span>Новые клиенты</span><strong>{overview.newClients}</strong></article>
            <article><span>Загрузка команды</span><strong>{overview.staffUtilizationPercent}%</strong></article>
          </div>
          <div className="analytics-report__grid">
            <section className="analytics-chart" aria-labelledby="analytics-chart-title">
              <header><p className="crm-kicker">Диаграмма</p><h2 id="analytics-chart-title">Популярность услуг</h2></header>
              {chartServices.length ? (
                <ol>
                  {chartServices.map((service) => (
                    <li key={service.serviceId}>
                      <div><strong>{service.serviceName}</strong><span>{service.appointments} записей</span></div>
                      <span className="analytics-chart__track"><i style={{ "--bar-size": `${service.appointments / chartMaximum * 100}%` } as CSSProperties} /></span>
                    </li>
                  ))}
                </ol>
              ) : <p>За выбранный период записей по услугам ещё не было.</p>}
              {revenueServices.length > 0 && <section className="analytics-chart__group" aria-labelledby="analytics-revenue-chart-title">
                <h3 id="analytics-revenue-chart-title">Выручка по услугам</h3>
                <ol>
                  {revenueServices.map((service) => (
                    <li key={`revenue-${service.serviceId}`}>
                      <div><strong>{service.serviceName}</strong><span>{formatMoney(service.revenue)}</span></div>
                      <span className="analytics-chart__track analytics-chart__track--revenue"><i style={{ "--bar-size": `${Number(service.revenue) / revenueMaximum * 100}%` } as CSSProperties} /></span>
                    </li>
                  ))}
                </ol>
              </section>}
            </section>
            <section className="analytics-services">
              <header><p className="crm-kicker">Детализация</p><h2>Выручка по услугам</h2></header>
              {services.length ? <ol>{services.map((service) => <li key={service.serviceId}><strong>{service.serviceName}</strong><span>{service.appointments} записей</span><b>{formatMoney(service.revenue)}</b></li>)}</ol> : <p>За выбранный период записей по услугам ещё не было.</p>}
            </section>
          </div>
        </div>
      )}
    </section>
  );
}

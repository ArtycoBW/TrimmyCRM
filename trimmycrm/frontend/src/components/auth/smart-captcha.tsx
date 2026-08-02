"use client";

import Script from "next/script";
import { useCallback, useEffect, useId, useRef, useState } from "react";

declare global {
  interface Window {
    smartCaptcha?: {
      render: (
        container: HTMLElement | string,
        options: { sitekey: string; hl?: "ru"; callback?: (token: string) => void },
      ) => number;
      destroy: (widgetId?: number) => void;
    };
  }
}

type SmartCaptchaProps = {
  visible: boolean;
  onToken: (token: string) => void;
};

export function SmartCaptcha({ visible, onToken }: SmartCaptchaProps) {
  const siteKey = process.env.NEXT_PUBLIC_YANDEX_SMARTCAPTCHA_SITE_KEY;
  const reactId = useId().replaceAll(":", "");
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<number | null>(null);
  const [scriptReady, setScriptReady] = useState(false);

  const renderWidget = useCallback(() => {
    if (!visible || !siteKey || !containerRef.current || !window.smartCaptcha) return;
    if (widgetId.current !== null) return;
    widgetId.current = window.smartCaptcha.render(containerRef.current, {
      sitekey: siteKey,
      hl: "ru",
      callback: onToken,
    });
  }, [onToken, siteKey, visible]);

  useEffect(() => {
    if (scriptReady) renderWidget();
    return () => {
      if (widgetId.current !== null && window.smartCaptcha) {
        window.smartCaptcha.destroy(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [renderWidget, scriptReady]);

  if (!visible) return null;

  return (
    <div className="auth-captcha" aria-live="polite">
      {siteKey ? (
        <>
          <Script
            src="https://smartcaptcha.cloud.yandex.ru/captcha.js?render=onload"
            strategy="afterInteractive"
            onLoad={() => setScriptReady(true)}
          />
          <div id={`smart-captcha-${reactId}`} ref={containerRef} className="auth-captcha__widget" />
        </>
      ) : (
        <p className="auth-alert auth-alert--error">
          Проверка безопасности не настроена. Сообщите администратору.
        </p>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

type PasswordFieldProps = {
  id: string;
  label: string;
  autoComplete: string;
  registration: UseFormRegisterReturn;
  error?: string;
  hint?: React.ReactNode;
};

export function PasswordField({
  id,
  label,
  autoComplete,
  registration,
  error,
  hint,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className={`auth-input-wrap${error ? " auth-input-wrap--error" : ""}`}>
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          {...registration}
        />
        <button
          className="password-toggle"
          type="button"
          aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? "Скрыть" : "Показать"}
        </button>
      </div>
      {error && <p className="auth-field__error" id={`${id}-error`}>{error}</p>}
      {hint && <div id={`${id}-hint`}>{hint}</div>}
    </div>
  );
}

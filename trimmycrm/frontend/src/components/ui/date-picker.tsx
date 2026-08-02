"use client";

import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarDays, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function parseDate(value?: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  const parsed = new Date(year, month - 1, day, 12);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function serializeDate(value: Date) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

export function DatePicker({
  id,
  value,
  onValueChange,
  min,
  max,
  disabled = false,
  required = false,
  clearable = false,
  placeholder = "Выберите дату",
  ariaLabel = "Выберите дату",
  className,
}: {
  id?: string;
  value?: string;
  onValueChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  clearable?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => parseDate(value), [value]);
  const minDate = useMemo(() => parseDate(min), [min]);
  const maxDate = useMemo(() => parseDate(max), [max]);
  const disabledDays = [
    ...(minDate ? [{ before: minDate }] : []),
    ...(maxDate ? [{ after: maxDate }] : []),
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          className={"ui-date-picker__trigger" + (!selected ? " is-placeholder" : "") + (className ? ` ${className}` : "")}
          type="button"
          aria-label={ariaLabel}
          data-required={required || undefined}
          disabled={disabled}
        >
          <span>{selected ? format(selected, "d MMMM yyyy", { locale: ru }) : placeholder}</span>
          <CalendarDays aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="ui-date-picker__content"
        aria-label={`Календарь: ${ariaLabel}`}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.stopPropagation();
        }}
      >
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected || minDate || new Date()}
          disabled={disabledDays}
          startMonth={minDate}
          endMonth={maxDate}
          locale={ru}
          weekStartsOn={1}
          onSelect={(next) => {
            if (!next) return;
            onValueChange(serializeDate(next));
            setOpen(false);
          }}
        />
        {clearable && value && (
          <button className="ui-date-picker__clear" type="button" onClick={() => { onValueChange(""); setOpen(false); }}>
            <X aria-hidden="true" /> Очистить дату
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

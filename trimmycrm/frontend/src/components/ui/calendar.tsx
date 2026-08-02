"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ComponentProps } from "react";
import { DayPicker } from "react-day-picker";

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={"ui-calendar" + (className ? ` ${className}` : "")}
      classNames={{
        months: "ui-calendar__months",
        month: "ui-calendar__month",
        month_caption: "ui-calendar__caption",
        caption_label: "ui-calendar__caption-label",
        nav: "ui-calendar__nav",
        button_previous: "ui-calendar__nav-button ui-calendar__nav-button--previous",
        button_next: "ui-calendar__nav-button ui-calendar__nav-button--next",
        month_grid: "ui-calendar__grid",
        weekdays: "ui-calendar__weekdays",
        weekday: "ui-calendar__weekday",
        weeks: "ui-calendar__weeks",
        week: "ui-calendar__week",
        day: "ui-calendar__day",
        day_button: "ui-calendar__day-button",
        selected: "is-selected",
        today: "is-today",
        outside: "is-outside",
        disabled: "is-disabled",
        hidden: "is-hidden",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => orientation === "left"
          ? <ChevronLeft aria-hidden="true" />
          : <ChevronRight aria-hidden="true" />,
      }}
      {...props}
    />
  );
}

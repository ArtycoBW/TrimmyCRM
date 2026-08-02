"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type AppSelectProps = Omit<ComponentProps<typeof SelectPrimitive.Root>, "children"> & {
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  options: SelectOption[];
  triggerClassName?: string;
};

/** A project-styled shadcn/Radix select used across the CRM. */
export function AppSelect({
  id,
  ariaLabel,
  placeholder = "Выберите вариант",
  options,
  triggerClassName,
  ...props
}: AppSelectProps) {
  return (
    <SelectPrimitive.Root {...props}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        className={"ui-select-trigger" + (triggerClassName ? " " + triggerClassName : "")}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="ui-select-trigger__icon" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="ui-select-content"
          position="popper"
          sideOffset={8}
          collisionPadding={12}
        >
          <SelectPrimitive.Viewport className="ui-select-viewport">
            {options.map((option) => (
              <SelectPrimitive.Item
                className="ui-select-item"
                value={option.value}
                key={option.value}
                disabled={option.disabled}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="ui-select-item__indicator">
                  <Check aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

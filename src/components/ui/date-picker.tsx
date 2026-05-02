"use client";

import * as React from "react";
import { es } from "date-fns/locale";
import { HugeiconsIcon } from "@hugeicons/react";
import { Calendar03Icon } from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type Props = {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  name?: string;
  className?: string;
  startYear?: number;
  endYear?: number;
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const DDMMYYYY_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function isoToDisplay(iso: string): string {
  if (!ISO_RE.test(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function displayToIso(display: string): string | null {
  const m = DDMMYYYY_RE.exec(display.trim());
  if (!m) return null;
  const day = m[1]!.padStart(2, "0");
  const month = m[2]!.padStart(2, "0");
  const year = m[3]!;
  const dt = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  if (
    dt.getUTCFullYear() !== Number.parseInt(year, 10) ||
    dt.getUTCMonth() + 1 !== Number.parseInt(month, 10) ||
    dt.getUTCDate() !== Number.parseInt(day, 10)
  ) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

function isoToDate(iso: string): Date | undefined {
  if (!ISO_RE.test(iso)) return undefined;
  const dt = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}

function dateToIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  disabled,
  placeholder = "DD/MM/AAAA",
  id,
  name,
  className,
  startYear = 2020,
  endYear,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(() => isoToDisplay(value));

  React.useEffect(() => {
    setText(isoToDisplay(value));
  }, [value]);

  const selected = isoToDate(value);
  const minDate = min ? isoToDate(min) : undefined;
  const maxDate = max ? isoToDate(max) : undefined;
  const computedEndYear = endYear ?? new Date().getFullYear() + 2;
  const startMonth = new Date(Date.UTC(startYear, 0, 1));
  const endMonth = new Date(Date.UTC(computedEndYear, 11, 31));

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw);
    const iso = displayToIso(raw);
    if (iso) {
      if (min && iso < min) return;
      if (max && iso > max) return;
      onChange(iso);
    } else if (raw === "") {
      onChange("");
    }
  };

  const handleTextBlur = () => {
    const iso = displayToIso(text);
    if (iso) {
      setText(isoToDisplay(iso));
    } else if (text !== "" && !value) {
      setText("");
    } else {
      setText(isoToDisplay(value));
    }
  };

  const handleSelect = (d: Date | undefined) => {
    if (!d) {
      onChange("");
      setText("");
      setOpen(false);
      return;
    }
    const iso = dateToIso(d);
    onChange(iso);
    setText(isoToDisplay(iso));
    setOpen(false);
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        onChange={handleTextChange}
        onBlur={handleTextBlur}
        placeholder={placeholder}
        disabled={disabled}
        className="font-mono"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={disabled}
              aria-label="Abrir calendario"
            >
              <HugeiconsIcon
                icon={Calendar03Icon}
                strokeWidth={2}
                className="size-4"
              />
            </Button>
          }
        />
        <PopoverContent className="w-auto p-0">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={handleSelect}
            captionLayout="dropdown"
            startMonth={startMonth}
            endMonth={endMonth}
            disabled={
              minDate || maxDate
                ? (date: Date) => {
                    if (minDate && date < minDate) return true;
                    if (maxDate && date > maxDate) return true;
                    return false;
                  }
                : undefined
            }
            locale={es}
            defaultMonth={selected ?? maxDate ?? new Date()}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { PER_PAGE_OPTIONS } from "@/components/ui/pagination-params";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Props = {
  page: number;
  perPage: number;
  total: number;
  className?: string;
};

export function Pagination({ page, perPage, total, className }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = total === 0 ? 0 : (safePage - 1) * perPage + 1;
  const end = Math.min(safePage * perPage, total);

  const goTo = (next: { page?: number; perPage?: number }) => {
    const qs = new URLSearchParams(searchParams.toString());
    if (typeof next.page === "number") {
      if (next.page <= 1) qs.delete("page");
      else qs.set("page", String(next.page));
    }
    if (typeof next.perPage === "number") {
      qs.delete("page");
      if (next.perPage === 50) qs.delete("perPage");
      else qs.set("perPage", String(next.perPage));
    }
    const url = qs.toString().length > 0 ? `${pathname}?${qs}` : pathname;
    startTransition(() => router.push(url));
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span>
          {total === 0
            ? "Sin resultados"
            : `${start.toLocaleString("es-AR")}–${end.toLocaleString("es-AR")} de ${total.toLocaleString("es-AR")}`}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span>Por página</span>
          <Select value={String(perPage)} onValueChange={(v) => goTo({ perPage: Number(v) })}>
            <SelectTrigger size="sm" className="h-7 min-w-16">
              <SelectValue>{(v) => v as string}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PER_PAGE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={safePage <= 1}
            onClick={() => goTo({ page: safePage - 1 })}
            aria-label="Página anterior"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
          </Button>
          <span className="px-2 tabular-nums">
            {safePage} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={safePage >= totalPages}
            onClick={() => goTo({ page: safePage + 1 })}
            aria-label="Página siguiente"
          >
            <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
          </Button>
        </div>
      </div>
    </div>
  );
}

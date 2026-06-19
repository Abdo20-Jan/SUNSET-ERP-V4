"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowUp01Icon, ArrowUpDownIcon } from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";

/**
 * Header de columna clickeable que codifica el orden en la URL (`sort`/`dir`).
 * Al cambiar el orden resetea `page` para no quedar en una página inexistente.
 * El `columnId` debe ser una key lógica de la allowlist del server (ver
 * `parseSortParams`/`buildOrderBy`): este botón solo escribe la key en la URL,
 * la validación dura vive en el server.
 */
export function SortableHeader({
  columnId,
  children,
  align = "left",
}: {
  columnId: string;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const active = sp.get("sort") === columnId;
  const dir = sp.get("dir");
  const nextDir = active && dir === "asc" ? "desc" : "asc";

  const onClick = () => {
    const next = new URLSearchParams(sp.toString());
    next.set("sort", columnId);
    next.set("dir", nextDir);
    next.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${next}`);
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Ordenar por columna"
      className={cn(
        "inline-flex items-center gap-1 select-none hover:text-foreground",
        align === "right" && "justify-end",
      )}
    >
      {children}
      {active && dir === "asc" ? (
        <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} className="size-3.5" />
      ) : active && dir === "desc" ? (
        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3.5" />
      ) : (
        <HugeiconsIcon
          icon={ArrowUpDownIcon}
          strokeWidth={2}
          className="size-3.5 text-muted-foreground/50"
        />
      )}
    </button>
  );
}

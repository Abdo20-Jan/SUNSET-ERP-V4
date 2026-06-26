"use client";

import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/*
 * AdaptiveRecordHeader (PR-018) — cabeçalho canônico de registro (PAGE-STD-02,
 * 06_RECORD_PATTERN; componente-base do 12_COMPONENT_CATALOG). Três linhas
 * (Código/Status · Entidade/Valor/Responsável · meta crítica) que, ao rolar,
 * encolhem para uma barra sticky de UMA linha (`Código · Entidade · Valor ·
 * Status`).
 *
 * APRESENTACIONAL: recebe nós já renderizados (StatusBadge, EntityLink, valor
 * dual-currency) para não acoplar a regras de domínio — a página monta os 7
 * campos canônicos. A redução on-scroll usa um sentinel + IntersectionObserver
 * (sem dependência nova); o estado só liga/desliga a barra compacta (sem
 * re-render por pixel).
 */
type Crumb = { label: string; href?: string };
type AdaptiveField = { label: string; value: ReactNode };

export type AdaptiveRecordHeaderProps = {
  breadcrumb?: Crumb[];
  /** Linha 1: código imutável do registro. */
  codigo: ReactNode;
  /** Linha 1: StatusBadge. */
  status?: ReactNode;
  /** Linha 1: indicadores (`!`, cadeado, documento). */
  indicators?: ReactNode;
  /** Linha 2: entidade principal (EntityLink). */
  entidad: ReactNode;
  /** Linha 2: valor principal (DualCurrency). */
  valor: ReactNode;
  /** Linha 2: responsável (nome/iniciais). */
  responsable?: ReactNode;
  /** Linha 3: campos críticos (data, vencimento, moeda/TC, última atualização). */
  meta?: AdaptiveField[];
};

function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {items.map((crumb, i) => (
        <Fragment key={crumb.href ?? crumb.label}>
          {i > 0 && <span aria-hidden>/</span>}
          {crumb.href ? (
            <Link href={crumb.href} className="hover:text-foreground">
              {crumb.label}
            </Link>
          ) : (
            <span>{crumb.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

function HeaderMeta({ meta }: { meta: AdaptiveField[] }) {
  return (
    <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
      {meta.map((f) => (
        <div key={f.label} className="flex items-baseline gap-1.5">
          <dt className="text-muted-foreground uppercase tracking-wide">{f.label}</dt>
          <dd className="font-medium text-foreground">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CompactBar({
  reduced,
  codigo,
  entidad,
  valor,
  status,
}: {
  reduced: boolean;
  codigo: ReactNode;
  entidad: ReactNode;
  valor: ReactNode;
  status?: ReactNode;
}) {
  return (
    <div
      aria-hidden={!reduced}
      className={cn(
        "sticky top-0 z-30 -mx-px flex h-11 items-center gap-3 border-b border-border bg-card/95 px-3 supports-backdrop-filter:backdrop-blur-sm",
        reduced ? "flex" : "hidden",
      )}
    >
      <span className="truncate text-[13px] font-semibold tracking-tight">{codigo}</span>
      <span className="min-w-0 truncate text-xs text-muted-foreground">{entidad}</span>
      <span className="ml-auto shrink-0 font-mono text-xs tabular-nums">{valor}</span>
      {status}
    </div>
  );
}

export function AdaptiveRecordHeader({
  breadcrumb,
  codigo,
  status,
  indicators,
  entidad,
  valor,
  responsable,
  meta,
}: AdaptiveRecordHeaderProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver((entries) => setReduced(!entries[0]?.isIntersecting), {
      rootMargin: "0px",
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="flex flex-col">
      {/* Sentinel de 1px: ao sair do topo do viewport, liga a barra compacta. */}
      <div ref={sentinelRef} aria-hidden className="h-px w-full" />

      <CompactBar
        reduced={reduced}
        codigo={codigo}
        entidad={entidad}
        valor={valor}
        status={status}
      />

      <div className="flex flex-col gap-2">
        {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} />}

        <div className="flex items-center gap-2">
          <h1 className="text-[15px] font-semibold tracking-tight">{codigo}</h1>
          {status}
          {indicators}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="min-w-0">{entidad}</span>
          <span className="font-mono tabular-nums">{valor}</span>
          {responsable && (
            <span className="flex items-baseline gap-1.5 text-xs">
              <span className="text-muted-foreground uppercase tracking-wide">Responsable</span>
              <span className="font-medium">{responsable}</span>
            </span>
          )}
        </div>

        {meta && meta.length > 0 && <HeaderMeta meta={meta} />}
      </div>
    </div>
  );
}

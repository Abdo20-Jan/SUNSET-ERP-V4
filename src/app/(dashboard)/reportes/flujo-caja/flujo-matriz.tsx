"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { fmtMoney, fmtSigno } from "../_components/money";
import { formatMesLabel } from "./flujo-filters";

export type SerializedNode = {
  cuentaId: number;
  codigo: string;
  nombre: string;
  tipo: "SINTETICA" | "ANALITICA";
  categoria: "ACTIVO" | "PASIVO" | "PATRIMONIO" | "INGRESO" | "EGRESO";
  nivel: number;
  valoresPorMes: Record<string, { monto: string; origen: string }>;
  totalPeriodo: string;
  children: SerializedNode[];
};

export type SerializedTotales = {
  totalIngresosPorMes: Record<string, string>;
  totalEgresosPorMes: Record<string, string>;
  saldoMensalPorMes: Record<string, string>;
  saldoInicial: string;
  saldoAcumuladoPorMes: Record<string, string>;
};

type Props = {
  meses: string[];
  contrapartidas: SerializedNode[];
  transferencias: SerializedNode[];
  totales: SerializedTotales;
};

const SECCION_LABELS: Record<SerializedNode["categoria"], string> = {
  ACTIVO: "Activos",
  PASIVO: "Pasivos",
  PATRIMONIO: "Patrimonio",
  INGRESO: "Ingresos operativos",
  EGRESO: "Egresos operativos",
};

const SECCION_ORDER: SerializedNode["categoria"][] = [
  "INGRESO",
  "EGRESO",
  "ACTIVO",
  "PASIVO",
  "PATRIMONIO",
];

// Cell rendering — sign nativo del cashflow.
//   Positivo = entrou no caixa (verde, "+ X").
//   Negativo = saiu do caixa (rojo, "(X)").
function MontoCell({
  monto,
  destacar = false,
}: {
  monto: string;
  destacar?: boolean;
}) {
  const num = Number(monto);
  if (!Number.isFinite(num) || Math.abs(num) < 0.01) {
    return (
      <span className="block text-right font-mono text-xs text-muted-foreground tabular-nums">
        —
      </span>
    );
  }
  const abs = fmtMoney(Math.abs(num).toFixed(2));
  const isNegative = num < 0;
  return (
    <span
      className={cn(
        "block text-right font-mono text-xs tabular-nums",
        destacar && "font-semibold",
        isNegative
          ? "text-rose-600 dark:text-rose-400"
          : "text-emerald-700 dark:text-emerald-400",
      )}
    >
      {isNegative ? `(${abs})` : `+ ${abs}`}
    </span>
  );
}

function rowClasses(node: SerializedNode, depth: number): string {
  if (node.tipo === "SINTETICA" && depth === 0) {
    return "bg-muted/70 hover:bg-muted/80 font-semibold";
  }
  if (node.tipo === "SINTETICA") {
    return "bg-muted/30 hover:bg-muted/40 font-medium";
  }
  return depth % 2 === 1
    ? "hover:bg-muted/30"
    : "bg-muted/10 hover:bg-muted/30";
}

function NodeRow({
  node,
  depth,
  meses,
  expanded,
  onToggle,
}: {
  node: SerializedNode;
  depth: number;
  meses: string[];
  expanded: Set<number>;
  onToggle: (id: number) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = hasChildren ? expanded.has(node.cuentaId) : false;
  const indent = depth * 14;
  const isRoot = depth === 0 && node.tipo === "SINTETICA";

  return (
    <>
      <TableRow className={rowClasses(node, depth)}>
        <TableCell
          className={cn("py-1.5 sticky left-0 z-10", rowClasses(node, depth))}
          style={{ paddingLeft: `${indent + 12}px` }}
        >
          <div
            className={cn(
              "flex items-center gap-1",
              isRoot && "uppercase tracking-wide",
            )}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={() => onToggle(node.cuentaId)}
                className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-background/50"
                aria-label={isOpen ? "Recolher" : "Expandir"}
              >
                <HugeiconsIcon
                  icon={isOpen ? ArrowDown01Icon : ArrowRight01Icon}
                  className="size-4"
                />
              </button>
            ) : (
              <span className="inline-block size-5 shrink-0" />
            )}
            <span
              className={cn(
                "font-mono text-xs",
                isRoot ? "text-sm font-bold" : "text-muted-foreground",
              )}
            >
              {node.codigo}
            </span>
            <span
              className={cn(
                "ml-1 truncate",
                isRoot
                  ? "text-sm font-bold"
                  : node.tipo === "ANALITICA"
                    ? "text-xs"
                    : "text-sm",
              )}
            >
              {node.nombre}
            </span>
          </div>
        </TableCell>
        {meses.map((m) => (
          <TableCell key={m} className="py-1.5">
            <MontoCell
              monto={node.valoresPorMes[m]?.monto ?? "0"}
              destacar={node.tipo === "SINTETICA"}
            />
          </TableCell>
        ))}
        <TableCell className="py-1.5 border-l">
          <MontoCell
            monto={node.totalPeriodo}
            destacar={node.tipo === "SINTETICA"}
          />
        </TableCell>
      </TableRow>
      {isOpen
        ? node.children.map((child) => (
            <NodeRow
              key={child.cuentaId}
              node={child}
              depth={depth + 1}
              meses={meses}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))
        : null}
    </>
  );
}

export function FlujoMatriz({
  meses,
  contrapartidas,
  transferencias,
  totales,
}: Props) {
  // Por padrão expande los roots de cada sección
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    const init = new Set<number>();
    for (const r of contrapartidas) init.add(r.cuentaId);
    return init;
  });

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Agrupar contrapartidas por categoría (sección económica)
  const contrapartidasPorSeccion = new Map<
    SerializedNode["categoria"],
    SerializedNode[]
  >();
  for (const n of contrapartidas) {
    const arr = contrapartidasPorSeccion.get(n.categoria) ?? [];
    arr.push(n);
    contrapartidasPorSeccion.set(n.categoria, arr);
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-b-2">
            <TableHead className="sticky left-0 z-20 bg-background min-w-[280px] text-xs font-semibold uppercase tracking-wide">
              Cuenta contrapartida
            </TableHead>
            {meses.map((m) => (
              <TableHead
                key={m}
                className="text-right text-xs font-semibold uppercase tracking-wide"
              >
                {formatMesLabel(m)}
              </TableHead>
            ))}
            <TableHead className="border-l text-right text-xs font-semibold uppercase tracking-wide">
              Total
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SECCION_ORDER.flatMap((seccion) => {
            const nodos = contrapartidasPorSeccion.get(seccion) ?? [];
            if (nodos.length === 0) return [];
            return [
              <TableRow
                key={`hdr-${seccion}`}
                className="bg-slate-100 border-y-2 border-slate-300 dark:bg-slate-900/40 dark:border-slate-700/50"
              >
                <TableCell
                  colSpan={meses.length + 2}
                  className="sticky left-0 z-10 bg-slate-100 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-700 dark:bg-slate-900/40 dark:text-slate-300"
                >
                  {SECCION_LABELS[seccion]}
                </TableCell>
              </TableRow>,
              ...nodos.map((node) => (
                <NodeRow
                  key={node.cuentaId}
                  node={node}
                  depth={0}
                  meses={meses}
                  expanded={expanded}
                  onToggle={toggle}
                />
              )),
            ];
          })}

          {contrapartidas.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={meses.length + 2}
                className="py-3 text-center text-xs text-muted-foreground"
              >
                Sin movimientos en el período.
              </TableCell>
            </TableRow>
          )}

          {/* Transferencias entre cuentas propias (si hay) */}
          {transferencias.length > 0 && (
            <>
              <TableRow className="bg-indigo-50 border-y-2 border-indigo-300 dark:bg-indigo-950/30 dark:border-indigo-700/50">
                <TableCell
                  colSpan={meses.length + 2}
                  className="sticky left-0 z-10 bg-indigo-50 py-2 text-[11px] font-bold uppercase tracking-wide text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300"
                >
                  Transferencias entre cuentas propias{" "}
                  <span className="font-normal text-muted-foreground normal-case">
                    (suman 0 — visible per banco)
                  </span>
                </TableCell>
              </TableRow>
              {transferencias.map((node) => (
                <NodeRow
                  key={`tr-${node.cuentaId}`}
                  node={node}
                  depth={0}
                  meses={meses}
                  expanded={expanded}
                  onToggle={toggle}
                />
              ))}
            </>
          )}

          {/* Totales */}
          <TableRow className="bg-emerald-100 border-t-2 border-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-700/50">
            <TableCell className="sticky left-0 z-10 bg-emerald-100 py-2 text-sm font-bold uppercase dark:bg-emerald-950/40">
              Total Ingresos
            </TableCell>
            {meses.map((m) => (
              <TableCell
                key={m}
                className="bg-emerald-100 py-2 dark:bg-emerald-950/40"
              >
                <MontoCell
                  monto={totales.totalIngresosPorMes[m] ?? "0"}
                  destacar
                />
              </TableCell>
            ))}
            <TableCell className="bg-emerald-100 py-2 border-l dark:bg-emerald-950/40">
              <MontoCell
                monto={sumByKey(totales.totalIngresosPorMes, meses)}
                destacar
              />
            </TableCell>
          </TableRow>

          <TableRow className="bg-rose-100 border-t-2 border-rose-300 dark:bg-rose-950/40 dark:border-rose-700/50">
            <TableCell className="sticky left-0 z-10 bg-rose-100 py-2 text-sm font-bold uppercase dark:bg-rose-950/40">
              Total Egresos
            </TableCell>
            {meses.map((m) => (
              <TableCell
                key={m}
                className="bg-rose-100 py-2 dark:bg-rose-950/40"
              >
                <MontoCell
                  monto={totales.totalEgresosPorMes[m] ?? "0"}
                  destacar
                />
              </TableCell>
            ))}
            <TableCell className="bg-rose-100 py-2 border-l dark:bg-rose-950/40">
              <MontoCell
                monto={sumByKey(totales.totalEgresosPorMes, meses)}
                destacar
              />
            </TableCell>
          </TableRow>

          {/* SALDO MENSAL + ACUMULADO */}
          <TableRow className="border-t-4 border-double bg-slate-900 text-slate-50 hover:bg-slate-900 dark:bg-slate-800">
            <TableCell className="sticky left-0 z-10 bg-slate-900 py-3 text-sm font-bold uppercase dark:bg-slate-800">
              Saldo del mes (Ing + Egr)
            </TableCell>
            {meses.map((m) => {
              const value = totales.saldoMensalPorMes[m] ?? "0";
              const signo = fmtSigno(value);
              return (
                <TableCell
                  key={m}
                  className="bg-slate-900 py-3 dark:bg-slate-800"
                >
                  <SaldoCell value={value} signo={signo} />
                </TableCell>
              );
            })}
            <TableCell className="bg-slate-900 py-3 border-l dark:bg-slate-800">
              <SaldoCell
                value={sumByKey(totales.saldoMensalPorMes, meses)}
                signo={fmtSigno(sumByKey(totales.saldoMensalPorMes, meses))}
              />
            </TableCell>
          </TableRow>
          <TableRow className="bg-slate-800 text-slate-50 hover:bg-slate-800 dark:bg-slate-900">
            <TableCell className="sticky left-0 z-10 bg-slate-800 py-3 text-sm font-bold uppercase dark:bg-slate-900">
              Saldo acumulado bancos+caja
              <span className="ml-2 text-xs font-normal text-slate-300">
                (saldo inicial: {fmtMoney(totales.saldoInicial)})
              </span>
            </TableCell>
            {meses.map((m) => {
              const value = totales.saldoAcumuladoPorMes[m] ?? "0";
              const signo = fmtSigno(value);
              return (
                <TableCell
                  key={m}
                  className="bg-slate-800 py-3 dark:bg-slate-900"
                >
                  <SaldoCell value={value} signo={signo} />
                </TableCell>
              );
            })}
            <TableCell className="bg-slate-800 py-3 border-l dark:bg-slate-900" />
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function SaldoCell({
  value,
  signo,
}: {
  value: string;
  signo: ReturnType<typeof fmtSigno>;
}) {
  const num = Number(value);
  const abs = fmtMoney(Math.abs(num).toFixed(2));
  if (signo === "zero") {
    return (
      <span className="block text-right font-mono text-sm font-bold text-slate-400 tabular-nums">
        —
      </span>
    );
  }
  return (
    <span
      className={cn(
        "block text-right font-mono text-sm font-bold tabular-nums",
        signo === "negative" ? "text-rose-300" : "text-emerald-300",
      )}
    >
      {signo === "negative" ? `(${abs})` : abs}
    </span>
  );
}

function sumByKey(obj: Record<string, string>, keys: string[]): string {
  let s = 0;
  for (const k of keys) s += Number(obj[k] ?? 0);
  return s.toFixed(2);
}

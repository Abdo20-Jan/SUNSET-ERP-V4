"use client";

/**
 * Árbol del Plan de Cuentas (CONT-02 · PR-028) — EVOLUCIÓN del componente
 * legado (mismo TanStack tree por `getSubRows`), enriquecido a las 7 columnas
 * canónicas: Código · Nombre · Tipo · Naturaleza · Categoría
 * (Sintética/Analítica, con candado) · Estado · Saldo. Los números salen de
 * la proyección `getPlanDeCuentasConSaldo` (balance reusado — nada se
 * recomputa acá). Búsqueda 3+ chars con auto-expansión, [Expandir hasta
 * nivel N], inactivas atenuadas con candado, y click en ANALÍTICA → Libro
 * Mayor embebido en FloatingWorkWindow (Q&A estructural 6).
 */

import { useMemo, useRef, useState } from "react";
import {
  type ColumnDef,
  type ExpandedState,
  type Row,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowRight01Icon, SquareLock02Icon } from "@hugeicons/core-free-icons";

import type { CuentaArbolRow } from "@/lib/services/plan-cuentas-arbol";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EntityLink } from "@/components/data-grid/entity-link";

import {
  BUSQUEDA_MIN_CHARS,
  expandedHastaNivel,
  expandedTodo,
  filtrarArbol,
} from "./cuentas-arbol-presentacion";
import { CuentaLibroMayorWindow, type CuentaLibroMayorTarget } from "./cuenta-libro-mayor-window";

const NIVEL_DEFAULT = 3;

type OnOpenMayor = (cuenta: CuentaLibroMayorTarget) => void;

type RowCtx = Row<CuentaArbolRow>;

function CodigoCell({ row }: { row: RowCtx }) {
  const canExpand = row.getCanExpand();
  return (
    <div
      className="flex items-center gap-1 font-mono text-xs"
      style={{ paddingLeft: `${row.depth * 20}px` }}
    >
      {canExpand ? (
        <button
          type="button"
          onClick={row.getToggleExpandedHandler()}
          className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted"
          aria-label={row.getIsExpanded() ? "Recolher" : "Expandir"}
        >
          <HugeiconsIcon
            icon={row.getIsExpanded() ? ArrowDown01Icon : ArrowRight01Icon}
            className="size-4"
          />
        </button>
      ) : (
        <span className="inline-block size-5 shrink-0" />
      )}
      <span className={cn(!row.original.activa && "opacity-60")}>{row.original.codigo}</span>
    </div>
  );
}

function NombreCell({ row, onOpenMayor }: { row: RowCtx; onOpenMayor: OnOpenMayor }) {
  const cuenta = row.original;
  const inactivaLock = !cuenta.activa && (
    <HugeiconsIcon
      icon={SquareLock02Icon}
      strokeWidth={2}
      className="size-3 shrink-0 text-muted-foreground"
      aria-label="Cuenta inactiva — no acepta asientos"
    />
  );

  // Q&A 6: click en ANALÍTICA abre el Libro Mayor embebido (FWW). Las
  // sintéticas no clican (agregadoras — no tienen movimientos propios).
  if (cuenta.tipo === "ANALITICA") {
    return (
      <span className={cn("flex items-center gap-1.5", !cuenta.activa && "opacity-60")}>
        <EntityLink
          label={cuenta.nombre}
          onOpen={() =>
            onOpenMayor({ id: cuenta.id, codigo: cuenta.codigo, nombre: cuenta.nombre })
          }
          tabLabel={`Mayor ${cuenta.codigo}`}
        />
        {inactivaLock}
      </span>
    );
  }

  return (
    <span className={cn("flex items-center gap-1.5 font-semibold", !cuenta.activa && "opacity-60")}>
      <span>{cuenta.nombre}</span>
      {inactivaLock}
    </span>
  );
}

function TipoCell({ row }: { row: RowCtx }) {
  return <Badge variant="secondary">{row.original.categoria}</Badge>;
}

function NaturalezaCell({ row }: { row: RowCtx }) {
  return <Badge variant="outline">{row.original.naturaleza}</Badge>;
}

function CategoriaCell({ row }: { row: RowCtx }) {
  const cuenta = row.original;
  return (
    <span className="flex items-center gap-1">
      <Badge variant="outline">{cuenta.tipo}</Badge>
      {cuenta.tipo === "SINTETICA" && (
        <HugeiconsIcon
          icon={SquareLock02Icon}
          strokeWidth={2}
          className="size-3 shrink-0 text-muted-foreground"
          aria-label="Sintética — no acepta asientos"
        />
      )}
    </span>
  );
}

function EstadoCell({ row }: { row: RowCtx }) {
  return (
    <Badge variant={row.original.activa ? "default" : "destructive"}>
      {row.original.activa ? "ACTIVA" : "INACTIVA"}
    </Badge>
  );
}

function SaldoCell({ row }: { row: RowCtx }) {
  const cuenta = row.original;
  const esCero = Number.parseFloat(cuenta.saldo) === 0;
  return (
    <span
      className={cn(
        "block text-right font-mono text-sm tabular-nums",
        cuenta.tipo === "SINTETICA" && "font-semibold",
        esCero && "text-muted-foreground",
      )}
    >
      {fmtMoney(cuenta.saldo)}
    </span>
  );
}

function buildColumns(onOpenMayor: OnOpenMayor): ColumnDef<CuentaArbolRow>[] {
  return [
    {
      id: "codigo",
      header: "Código",
      cell: ({ row }) => <CodigoCell row={row} />,
    },
    {
      id: "nombre",
      header: "Nombre",
      cell: ({ row }) => <NombreCell row={row} onOpenMayor={onOpenMayor} />,
    },
    {
      id: "tipo",
      header: "Tipo",
      cell: ({ row }) => <TipoCell row={row} />,
    },
    {
      id: "naturaleza",
      header: "Naturaleza",
      cell: ({ row }) => <NaturalezaCell row={row} />,
    },
    {
      id: "categoria",
      header: "Categoría",
      cell: ({ row }) => <CategoriaCell row={row} />,
    },
    {
      id: "estado",
      header: "Estado",
      cell: ({ row }) => <EstadoCell row={row} />,
    },
    {
      id: "saldo",
      header: () => <span className="block text-right">Saldo</span>,
      cell: ({ row }) => <SaldoCell row={row} />,
    },
  ];
}

export function CuentasTreeTable({ data }: { data: CuentaArbolRow[] }) {
  const [termino, setTermino] = useState("");
  const [expanded, setExpanded] = useState<ExpandedState>(() =>
    expandedHastaNivel(data, NIVEL_DEFAULT),
  );
  const [mayorTarget, setMayorTarget] = useState<CuentaLibroMayorTarget | null>(null);
  // Estado de expansión previo a la búsqueda — se restaura al limpiar.
  const expandedAntesDeBusqueda = useRef<ExpandedState | null>(null);

  const buscando = termino.trim().length >= BUSQUEDA_MIN_CHARS;
  const rows = useMemo(() => filtrarArbol(data, termino), [data, termino]);

  const columns = useMemo(() => buildColumns(setMayorTarget), []);

  const onTerminoChange = (value: string) => {
    const antesBuscaba = termino.trim().length >= BUSQUEDA_MIN_CHARS;
    const ahoraBusca = value.trim().length >= BUSQUEDA_MIN_CHARS;
    if (!antesBuscaba && ahoraBusca) {
      // Entrando en modo búsqueda: guardar el estado y auto-expandir matches.
      expandedAntesDeBusqueda.current = expanded;
      setExpanded(expandedTodo(data));
    } else if (antesBuscaba && !ahoraBusca) {
      setExpanded(expandedAntesDeBusqueda.current ?? expandedHastaNivel(data, NIVEL_DEFAULT));
      expandedAntesDeBusqueda.current = null;
    } else if (ahoraBusca) {
      setExpanded(expandedTodo(data));
    }
    setTermino(value);
  };

  const onNivelChange = (value: string | null) => {
    if (value === null) return;
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return;
    expandedAntesDeBusqueda.current = null;
    setExpanded(expandedHastaNivel(data, n));
  };

  const table = useReactTable({
    data: rows,
    columns,
    state: { expanded },
    onExpandedChange: setExpanded,
    getRowId: (row) => row.codigo,
    getSubRows: (row) => row.children,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3 px-1">
        <div className="flex min-w-72 flex-1 flex-col gap-1.5">
          <Label htmlFor="cuentas-busqueda" className="text-xs text-muted-foreground">
            Buscar por código o nombre (3+ caracteres)
          </Label>
          <Input
            id="cuentas-busqueda"
            value={termino}
            onChange={(e) => onTerminoChange(e.target.value)}
            placeholder="Ej: 1.1.3 o Clientes"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Expandir hasta nivel</Label>
          <Select onValueChange={onNivelChange} disabled={buscando}>
            <SelectTrigger className="min-w-36">
              <SelectValue>{(value) => (value ? `Nivel ${value}` : "Elegir…")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  Nivel {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="py-12 text-center text-sm text-muted-foreground"
              >
                Ninguna cuenta coincide con la búsqueda.
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <CuentaLibroMayorWindow
        cuenta={mayorTarget}
        open={mayorTarget !== null}
        onOpenChange={(open) => {
          if (!open) setMayorTarget(null);
        }}
      />
    </div>
  );
}

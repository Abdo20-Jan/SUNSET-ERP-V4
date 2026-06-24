"use client";

/**
 * EnterpriseDataGrid (PR-003 — Worklist Infra).
 *
 * Componente NOVO e reutilizável que monta o `@tanstack/react-table`
 * internamente (a partir de `data` + `columns` + config) e orquestra o padrão
 * Worklist da baseline (PAGE-STD-01): toolbar + busca rápida + chips de filtro +
 * visões salvas (in-memory) + tabela densa com **cabeçalho fixo**, **colunas
 * congeladas** (left-pin), **ordenação**, **visibilidade de colunas**, **seleção
 * de linha** + rodapé de seleção sticky, **expansão** (drill-down inline) e
 * **paginação**. Superfície de **export desabilitada** (auditoria/permissão →
 * PR-005). Consome os tokens/utilitários do PR-001 (`density="dense"`/`zebra`
 * por default).
 *
 * NÃO substitui o `ui/data-table.tsx` (que segue servindo outras páginas) — é
 * aditivo, e a migração de cada worklist é incremental.
 */

import * as React from "react";
import {
  type Column,
  type ColumnDef,
  type ColumnPinningState,
  type ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
} from "@hugeicons/core-free-icons";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  columnDefId,
  type DataGridDensity,
  matchesActiveFilters,
  matchesQuickSearch,
  type QuickFilter,
  type QuickSearchConfig,
  type SavedView,
} from "./data-grid-helpers";
import { FilterBar } from "./filter-bar";
import { SavedViewsBar } from "./saved-views-bar";
import { SelectionSummaryFooter } from "./selection-summary-footer";
import { WorklistToolbar } from "./worklist-toolbar";

const PAGE_SIZE_OPTIONS = [28, 50, 100];

export type EnterpriseDataGridProps<T> = {
  data: readonly T[];
  columns: ColumnDef<T, unknown>[];
  getRowId: (row: T) => string;
  // Toolbar
  title?: React.ReactNode;
  primaryAction?: React.ReactNode;
  quickSearch?: QuickSearchConfig<T>;
  filters?: QuickFilter[];
  savedViews?: SavedView<T>[];
  // Seleção / massa
  enableRowSelection?: boolean;
  selectionSummary?: (rows: T[]) => React.ReactNode;
  bulkActions?: (rows: T[]) => React.ReactNode;
  // Drill-down inline
  renderExpanded?: (row: T) => React.ReactNode;
  // Superfície de export (desabilitada/futuro PR-005)
  exportSurface?: boolean;
  // Densidade / estados
  density?: DataGridDensity;
  zebra?: boolean;
  isLoading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  emptyFilteredMessage?: string;
  // Paginação
  pageSize?: number;
};

export function EnterpriseDataGrid<T>({
  data,
  columns,
  getRowId,
  title,
  primaryAction,
  quickSearch,
  filters = [],
  savedViews = [],
  enableRowSelection = false,
  selectionSummary,
  bulkActions,
  renderExpanded,
  exportSurface = true,
  density = "dense",
  zebra = true,
  isLoading = false,
  error = null,
  emptyMessage = "Sin registros.",
  emptyFilteredMessage = "No hay registros para los filtros seleccionados.",
  pageSize = 50,
}: EnterpriseDataGridProps<T>) {
  const [search, setSearch] = React.useState("");
  const [activeFilters, setActiveFilters] = React.useState<Record<string, string>>({});
  const [activeViewId, setActiveViewId] = React.useState<string>(savedViews[0]?.id ?? "");
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [expanded, setExpanded] = React.useState<ExpandedState>({});
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  });

  // Paginação controlada: o `autoResetPageIndex` interno do TanStack não dispara o
  // setState externo, então resetamos a página ao mudar busca/filtro/saved-view —
  // senão a página atual (ex.: 3) pode ficar fora do range e renderizar vazia.
  React.useEffect(() => {
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
  }, [search, activeFilters, activeViewId]);

  const activeView = React.useMemo(
    () => savedViews.find((v) => v.id === activeViewId),
    [savedViews, activeViewId],
  );

  const filteredData = React.useMemo(() => {
    const searchKeys = quickSearch?.keys ?? [];
    return (data as T[]).filter((row) => {
      if (activeView?.predicate && !activeView.predicate(row)) return false;
      if (searchKeys.length > 0 && !matchesQuickSearch(row, searchKeys, search)) return false;
      if (!matchesActiveFilters(row, activeFilters)) return false;
      return true;
    });
  }, [data, activeView, quickSearch, search, activeFilters]);

  // Injeta colunas estruturais (seleção + expander) e propaga `meta.width`→`size`.
  const tableColumns = React.useMemo<ColumnDef<T, unknown>[]>(() => {
    const structural: ColumnDef<T, unknown>[] = [];
    if (enableRowSelection) {
      structural.push({
        id: "select",
        size: 36,
        enableSorting: false,
        enableHiding: false,
        meta: { pinned: "left", width: 36 },
        header: ({ table }) => (
          <Checkbox
            aria-label="Seleccionar todo"
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label="Seleccionar fila"
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
          />
        ),
      });
    }
    if (renderExpanded) {
      structural.push({
        id: "expander",
        size: 32,
        enableSorting: false,
        enableHiding: false,
        meta: { pinned: "left", width: 32 },
        header: () => null,
        cell: ({ row }) =>
          row.getCanExpand() ? (
            <button
              type="button"
              aria-label={row.getIsExpanded() ? "Contraer fila" : "Expandir fila"}
              onClick={row.getToggleExpandedHandler()}
              className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                strokeWidth={2}
                className={cn("size-3.5 transition-transform", row.getIsExpanded() && "rotate-90")}
              />
            </button>
          ) : null,
      });
    }
    const prepared = columns.map((c) => {
      const width = c.meta?.width;
      return width != null && c.size == null ? { ...c, size: width } : c;
    });
    return [...structural, ...prepared];
  }, [columns, enableRowSelection, renderExpanded]);

  const columnPinning = React.useMemo<ColumnPinningState>(() => {
    const left: string[] = [];
    for (const col of tableColumns) {
      if (col.meta?.pinned === "left") {
        const id = columnDefId(col);
        if (id) left.push(id);
      }
    }
    return { left, right: [] };
  }, [tableColumns]);

  const table = useReactTable({
    data: filteredData,
    columns: tableColumns,
    getRowId: (row) => getRowId(row),
    state: { sorting, columnVisibility, rowSelection, expanded, pagination, columnPinning },
    enableRowSelection,
    enableColumnPinning: true,
    getRowCanExpand: renderExpanded ? () => true : undefined,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onExpandedChange: setExpanded,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const lastPinnedId = columnPinning.left?.at(-1);
  const visibleLeafCount = table.getVisibleLeafColumns().length;
  const totalCount = filteredData.length;
  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const isFiltered =
    search.trim().length > 0 ||
    Object.values(activeFilters).some((v) => v.length > 0) ||
    !!activeView?.predicate;

  const pinnedStyle = (column: Column<T, unknown>): React.CSSProperties | undefined => {
    if (column.getIsPinned() === "left") {
      const w = column.getSize();
      return { position: "sticky", left: column.getStart("left"), width: w, minWidth: w };
    }
    const w = column.columnDef.meta?.width;
    return w != null ? { width: w, minWidth: w } : undefined;
  };

  const alignText = (column: Column<T, unknown>): string => {
    const a = column.columnDef.meta?.align;
    return a === "right" ? "text-right" : a === "center" ? "text-center" : "";
  };
  const alignJustify = (column: Column<T, unknown>): string => {
    const a = column.columnDef.meta?.align;
    return a === "right" ? "justify-end" : a === "center" ? "justify-center" : "";
  };

  return (
    <div className="flex flex-col">
      <WorklistToolbar
        table={table}
        title={title}
        primaryAction={primaryAction}
        showSearch={!!quickSearch}
        searchPlaceholder={quickSearch?.placeholder}
        searchValue={search}
        onSearchChange={setSearch}
        exportSurface={exportSurface}
      />
      <SavedViewsBar views={savedViews} activeId={activeViewId} onSelect={setActiveViewId} />
      <FilterBar
        filters={filters}
        active={activeFilters}
        onChange={(columnId, value) => setActiveFilters((prev) => ({ ...prev, [columnId]: value }))}
        onClear={() => setActiveFilters({})}
      />

      {error ? (
        <div className="px-4 py-12 text-center text-sm text-destructive">{error}</div>
      ) : isLoading ? (
        <div className="px-4 py-12 text-center text-sm text-muted-foreground">Cargando…</div>
      ) : (
        <Table className={cn(density === "dense" && "table-dense", zebra && "table-zebra")}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const column = header.column;
                  const isPinned = column.getIsPinned() === "left";
                  const canSort = column.getCanSort();
                  const sorted = column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      style={pinnedStyle(column)}
                      className={cn(
                        alignText(column),
                        isPinned && "bg-muted",
                        isPinned && column.id === lastPinnedId && "border-r border-border",
                      )}
                    >
                      {header.isPlaceholder ? null : (
                        <div className={cn("flex items-center gap-1", alignJustify(column))}>
                          {canSort ? (
                            <button
                              type="button"
                              onClick={column.getToggleSortingHandler()}
                              className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                            >
                              {flexRender(column.columnDef.header, header.getContext())}
                              <HugeiconsIcon
                                icon={
                                  sorted === "asc"
                                    ? ArrowUp01Icon
                                    : sorted === "desc"
                                      ? ArrowDown01Icon
                                      : ArrowUpDownIcon
                                }
                                strokeWidth={2}
                                className={cn(
                                  "size-3",
                                  sorted ? "text-foreground" : "text-muted-foreground/50",
                                )}
                              />
                            </button>
                          ) : (
                            flexRender(column.columnDef.header, header.getContext())
                          )}
                        </div>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={visibleLeafCount}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  {isFiltered ? emptyFilteredMessage : emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <React.Fragment key={row.id}>
                  <TableRow
                    className="group"
                    data-state={row.getIsSelected() ? "selected" : undefined}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const column = cell.column;
                      const isPinned = column.getIsPinned() === "left";
                      return (
                        <TableCell
                          key={cell.id}
                          style={pinnedStyle(column)}
                          className={cn(
                            alignText(column),
                            isPinned &&
                              "bg-background group-hover:bg-accent/40 group-data-[state=selected]:bg-accent/60",
                            isPinned && column.id === lastPinnedId && "border-r border-border",
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  {renderExpanded && row.getIsExpanded() ? (
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableCell colSpan={visibleLeafCount} className="p-0">
                        <div className="px-4 py-2">{renderExpanded(row.original)}</div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </React.Fragment>
              ))
            )}
          </TableBody>
        </Table>
      )}

      {!error && !isLoading ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
          <span>
            {totalCount} registro{totalCount === 1 ? "" : "s"}
            {isFiltered ? " (filtrado)" : ""}
          </span>
          <div className="flex items-center gap-1.5">
            <span>Filas por página</span>
            <Select
              value={String(pagination.pageSize)}
              onValueChange={(v) =>
                setPagination((prev) => ({ ...prev, pageIndex: 0, pageSize: Number(v) }))
              }
            >
              <SelectTrigger size="sm" className="w-auto min-w-16">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span>
              Página {table.getState().pagination.pageIndex + 1} de{" "}
              {Math.max(table.getPageCount(), 1)}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Página anterior"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Página siguiente"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
            </Button>
          </div>
        </div>
      ) : null}

      <SelectionSummaryFooter
        count={selectedRows.length}
        summary={selectionSummary?.(selectedRows)}
        bulkActions={bulkActions?.(selectedRows)}
        onClear={() => table.resetRowSelection()}
      />
    </div>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon } from "@hugeicons/core-free-icons";

import { eliminarProductoAction, type ProductoGridRow } from "@/lib/actions/productos";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { EnterpriseDataGrid } from "@/components/data-grid/enterprise-data-grid";

import { ProductoFormDialog, type ProductoFormState } from "./producto-form-dialog";
import { EliminarProductoDialog } from "./producto-delete-dialog";
import { buildProductosColumns, ProductoExpandedRow } from "./productos-columns";

/*
 * PR-003: pilot do EnterpriseDataGrid no maestro de productos. A `page.tsx`
 * carrega o catálogo completo (sem paginação server-side) e o grid resolve
 * busca/filtro/ordenação/saved-views/paginação no cliente. O custo
 * (`costoPromedio`) NÃO viaja na lista: o form de edição o pede on-demand
 * por produto.
 */
type Props = {
  productos: ProductoGridRow[];
};

export function ProductosTable({ productos }: Props) {
  const router = useRouter();
  const [formState, setFormState] = useState<ProductoFormState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProductoGridRow | null>(null);
  const [isDeleting, startDelete] = useTransition();

  const marcaOptions = useMemo(() => {
    const s = new Set(
      productos.map((p) => p.marca).filter((m): m is string => !!m && m.length > 0),
    );
    return Array.from(s)
      .sort()
      .map((m) => ({ value: m, label: m }));
  }, [productos]);

  const columns = buildProductosColumns({
    onEdit: (row) => setFormState({ mode: "edit", row }),
    onDelete: (row) => setPendingDelete(row),
  });

  const onConfirmDelete = () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    startDelete(async () => {
      const result = await eliminarProductoAction(id);
      if (result.ok) {
        toast.success(
          result.softDeleted
            ? "Producto marcado como inactivo (tiene movimientos asociados)."
            : "Producto eliminado.",
        );
        setPendingDelete(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col">
      <EnterpriseDataGrid
        data={productos}
        columns={columns}
        getRowId={(p) => p.id}
        quickSearch={{ placeholder: "Buscar por código o nombre…", keys: ["codigo", "nombre"] }}
        filters={[{ columnId: "marca", label: "Marca", options: marcaOptions }]}
        savedViews={[
          { id: "todos", label: "Todos" },
          { id: "activos", label: "Activos", predicate: (p) => p.activo },
          { id: "inactivos", label: "Inactivos", predicate: (p) => !p.activo },
          {
            id: "stock-bajo",
            label: "Stock bajo",
            predicate: (p) => p.stockActual < p.stockMinimo,
          },
        ]}
        enableRowSelection
        selectionSummary={(rows) => {
          const stock = rows.reduce((acc, p) => acc + p.stockActual, 0);
          return `Stock total: ${stock.toLocaleString("es-AR")}`;
        }}
        bulkActions={() => (
          <DropdownMenuItem disabled>
            Exportar selección
            <span className="ml-auto pl-3 text-[10px] tracking-wide text-muted-foreground uppercase">
              Pronto
            </span>
          </DropdownMenuItem>
        )}
        renderExpanded={(p) => <ProductoExpandedRow producto={p} />}
        emptyMessage="Aún no hay productos registrados."
        emptyFilteredMessage="No hay productos para los filtros seleccionados."
        primaryAction={
          <Button onClick={() => setFormState({ mode: "create" })}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            Nuevo producto
          </Button>
        }
      />

      <ProductoFormDialog state={formState} onClose={() => setFormState(null)} />

      <EliminarProductoDialog
        producto={pendingDelete}
        isDeleting={isDeleting}
        onConfirm={onConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

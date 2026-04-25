import { listarProductos } from "@/lib/actions/productos";
import { Card } from "@/components/ui/card";

import { ProductosTable } from "./productos-table";

export default async function ProductosPage() {
  const productos = await listarProductos();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Productos</h1>
        <p className="text-sm text-muted-foreground">
          {productos.length} producto{productos.length === 1 ? "" : "s"} en el
          catálogo.
        </p>
      </div>

      <Card className="py-0">
        <ProductosTable productos={productos} />
      </Card>
    </div>
  );
}

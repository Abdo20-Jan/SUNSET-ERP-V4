import {
  listarCuentasContablesParaProveedor,
  listarProveedores,
} from "@/lib/actions/proveedores";
import { Card } from "@/components/ui/card";

import { ProveedoresTable } from "./proveedores-table";

export default async function ProveedoresPage() {
  const [proveedores, cuentas] = await Promise.all([
    listarProveedores(),
    listarCuentasContablesParaProveedor(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Proveedores</h1>
        <p className="text-sm text-muted-foreground">
          {proveedores.length} proveedor
          {proveedores.length === 1 ? "" : "es"} registrado
          {proveedores.length === 1 ? "" : "s"}.
        </p>
      </div>

      <Card className="py-0">
        <ProveedoresTable proveedores={proveedores} cuentas={cuentas} />
      </Card>
    </div>
  );
}

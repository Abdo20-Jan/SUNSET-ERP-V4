import {
  listarClientes,
  listarCuentasContablesParaCliente,
} from "@/lib/actions/clientes";
import { Card } from "@/components/ui/card";

import { ClientesTable } from "./clientes-table";

export default async function ClientesPage() {
  const [clientes, cuentas] = await Promise.all([
    listarClientes(),
    listarCuentasContablesParaCliente(),
  ]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">Clientes</h1>
        <p className="text-sm text-muted-foreground">
          {clientes.length} cliente{clientes.length === 1 ? "" : "s"} registrado
          {clientes.length === 1 ? "" : "s"}.
        </p>
      </div>

      <Card className="py-0">
        <ClientesTable clientes={clientes} cuentas={cuentas} />
      </Card>
    </div>
  );
}

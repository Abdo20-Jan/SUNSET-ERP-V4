import { listarDepositos } from "@/lib/actions/depositos";
import { Card } from "@/components/ui/card";

import { DepositosTable } from "./depositos-table";

export default async function DepositosPage() {
  const depositos = await listarDepositos();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Depósitos</h1>
        <p className="text-sm text-muted-foreground">
          {depositos.length} depósito{depositos.length === 1 ? "" : "s"}{" "}
          registrado{depositos.length === 1 ? "" : "s"}.
        </p>
      </div>

      <Card className="py-0">
        <DepositosTable depositos={depositos} />
      </Card>
    </div>
  );
}

import { listarCuentasBancariasParaMovimiento } from "@/lib/actions/movimientos-tesoreria";

import { TransferenciaForm } from "./transferencia-form";

export default async function NuevaTransferenciaPage() {
  const cuentasBancarias = await listarCuentasBancariasParaMovimiento();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Nueva transferencia entre cuentas
        </h1>
        <p className="text-sm text-muted-foreground">
          Mueva dinero entre dos cuentas bancarias. El sistema generará
          automáticamente el asiento de partida doble. Si hay diferencia de
          valorización en ARS entre origen y destino, se registra en la cuenta
          de Diferencia de Cambio correspondiente.
        </p>
      </div>
      <TransferenciaForm cuentasBancarias={cuentasBancarias} />
    </div>
  );
}

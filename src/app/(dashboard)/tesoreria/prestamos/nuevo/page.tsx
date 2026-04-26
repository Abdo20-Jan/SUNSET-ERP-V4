import { listarCuentasBancariasParaMovimiento } from "@/lib/actions/movimientos-tesoreria";
import {
  listarCuentasContablesParaPrestamo,
  listarProveedoresParaPrestamo,
} from "@/lib/actions/prestamos";
import { PrestamoClasificacion } from "@/generated/prisma/client";

import { PrestamoForm } from "./prestamo-form";

export default async function NuevoPrestamoPage() {
  const [
    cuentasBancarias,
    cuentasCortoPlazo,
    cuentasLargoPlazo,
    proveedoresExterior,
  ] = await Promise.all([
    listarCuentasBancariasParaMovimiento(),
    listarCuentasContablesParaPrestamo(PrestamoClasificacion.CORTO_PLAZO),
    listarCuentasContablesParaPrestamo(PrestamoClasificacion.LARGO_PLAZO),
    listarProveedoresParaPrestamo(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Nuevo préstamo</h1>
        <p className="text-sm text-muted-foreground">
          Registre un préstamo del exterior. Se generará automáticamente el
          asiento contable de recepción (Debe Banco · Haber Pasivo).
        </p>
      </div>
      <PrestamoForm
        cuentasBancarias={cuentasBancarias}
        cuentasCortoPlazo={cuentasCortoPlazo}
        cuentasLargoPlazo={cuentasLargoPlazo}
        proveedoresExterior={proveedoresExterior}
      />
    </div>
  );
}

import {
  listarCuentasAnticipoProveedor,
  listarProveedoresParaAnticipo,
} from "@/lib/actions/anticipos-proveedor";
import { listarCuentasBancariasParaMovimiento } from "@/lib/actions/movimientos-tesoreria";
import { getDefaultFecha } from "@/lib/server/fecha-default";

import { AnticipoForm } from "./anticipo-form";

export const dynamic = "force-dynamic";

export default async function NuevoAnticipoPage() {
  const [proveedores, cuentasBancarias, cuentasAnticipo, defaultFecha] = await Promise.all([
    listarProveedoresParaAnticipo(),
    listarCuentasBancariasParaMovimiento(),
    listarCuentasAnticipoProveedor(),
    getDefaultFecha(),
  ]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">Nuevo anticipo a proveedor</h1>
        <p className="text-sm text-muted-foreground">
          Registre un adelanto a un proveedor local en ARS. La cuenta de anticipo elegida codifica
          la clasificación (bien de cambio / servicio). Se generará el asiento contable de la salida
          de dinero (Debe Anticipo · Haber Banco).
        </p>
      </div>
      <AnticipoForm
        proveedores={proveedores}
        cuentasBancarias={cuentasBancarias}
        cuentasAnticipo={cuentasAnticipo}
        defaultFecha={defaultFecha}
      />
    </div>
  );
}

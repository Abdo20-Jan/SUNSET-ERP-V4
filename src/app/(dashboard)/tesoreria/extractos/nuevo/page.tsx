import Link from "next/link";

import { db } from "@/lib/db";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ExtractoUploadForm, type CuentaBancariaOption } from "./upload-form";

export default async function NuevoExtractoPage() {
  const cuentasRaw = await db.cuentaBancaria.findMany({
    orderBy: [{ banco: "asc" }, { moneda: "asc" }],
    select: {
      id: true,
      banco: true,
      moneda: true,
      numero: true,
    },
  });

  const cuentas: CuentaBancariaOption[] = cuentasRaw.map((c) => ({
    id: c.id,
    banco: c.banco,
    moneda: c.moneda,
    numero: c.numero,
  }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">
          Importar extracto bancario
        </h1>
        <p className="text-sm text-muted-foreground">
          Subí el PDF del extracto. El sistema lo lee con IA y propone los
          asientos línea por línea para tu aprobación.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos del extracto</CardTitle>
        </CardHeader>
        <CardContent>
          {cuentas.length === 0 ? (
            <div className="flex flex-col items-start gap-3 py-6">
              <p className="text-sm text-muted-foreground">
                No hay cuentas bancarias cargadas. Creá una primero.
              </p>
              <Link
                href="/tesoreria/cuentas"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Ir a cuentas bancarias
              </Link>
            </div>
          ) : (
            <ExtractoUploadForm cuentas={cuentas} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

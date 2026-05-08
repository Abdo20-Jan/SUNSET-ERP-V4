import { Card } from "@/components/ui/card";

import { listarJurisdiccionesIIBB } from "@/lib/actions/jurisdicciones-iibb";

import { JurisdiccionesIIBBTable } from "./jurisdicciones-iibb-table";

export const dynamic = "force-dynamic";

export default async function JurisdiccionesIIBBPage() {
  const rows = await listarJurisdiccionesIIBB();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">Jurisdicciones IIBB</h1>
        <p className="text-sm text-muted-foreground">
          Alícuotas de Percepción IIBB por jurisdicción argentina y flag de agente de percepción.
          Las 24 jurisdicciones son fijas (vienen del seed). Editar la alícuota cuando cambian las
          normas anuales o la designación como agente de percepción.
        </p>
      </div>

      <Card className="py-0">
        <JurisdiccionesIIBBTable rows={rows} />
      </Card>
    </div>
  );
}

import {
  AlertCircleIcon,
  CargoShipIcon,
  Coins01Icon,
  MoneyBag02Icon,
} from "@hugeicons/core-free-icons";

import { convertirMonto, fmtInt, fmtMoney } from "@/lib/format";
import { KpiCard } from "../../dashboard/_components/kpi-card";
import type { CockpitIndicadores as CockpitIndicadoresData } from "@/lib/services/comex-cockpit";
import type { Moneda } from "@/generated/prisma/client";

/**
 * Los 4 indicadores del cockpit (CX-01 §9-3). Valor primario en la moneda de
 * presentación (default USD); el equivalente en la otra moneda se muestra al
 * pasar el mouse (atributo `title` nativo — hover honesto sin estado cliente).
 * Los valores monetarios `null` (sin VER_COSTO_LANDED) se rinden "—": el costo
 * NUNCA llegó del server.
 */

function presentar(
  usd: string | null,
  moneda: Moneda,
  tc: string | null,
): { value: string; hover: string } {
  if (usd == null) return { value: "—", hover: "Requiere permiso de valores financieros" };
  const otra: Moneda = moneda === "USD" ? "ARS" : "USD";
  const pres = fmtMoney(convertirMonto(usd, "USD", moneda, tc));
  const presOtra = fmtMoney(convertirMonto(usd, "USD", otra, tc));
  return { value: `${pres} ${moneda}`, hover: `≈ ${presOtra} ${otra}` };
}

export function CockpitIndicadores({
  indicadores,
  moneda,
  tc,
}: {
  indicadores: CockpitIndicadoresData;
  moneda: Moneda;
  tc: string | null;
}) {
  const transito = presentar(indicadores.contenedoresTransitoFobUsd, moneda, tc);
  const fobAbierto = presentar(indicadores.fobCfrAbiertoUsd, moneda, tc);
  const cashOut = presentar(indicadores.cashOut30dUsd, moneda, tc);

  return (
    <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      <div title={`FOB en tránsito: ${transito.hover}`}>
        <KpiCard
          label="Contenedores en tránsito"
          value={fmtInt(indicadores.contenedoresEnTransito)}
          icon={CargoShipIcon}
          accent="info"
          hint={
            indicadores.contenedoresTransitoFobUsd ? `FOB ${transito.value}` : "FOB sin permiso"
          }
        />
      </div>
      <div title={fobAbierto.hover}>
        <KpiCard
          label="FOB / CFR abierto"
          value={fobAbierto.value}
          icon={Coins01Icon}
          accent="neutral"
          hint="Procesos no cerrados"
        />
      </div>
      <div title={cashOut.hover}>
        <KpiCard
          label="Cash-out proyectado 30d"
          value={cashOut.value}
          icon={MoneyBag02Icon}
          accent="warning"
          hint="Pagos exteriores ≤ 30 días"
        />
      </div>
      <KpiCard
        label="Alertas críticos"
        value={fmtInt(indicadores.alertasCriticos)}
        icon={AlertCircleIcon}
        accent={indicadores.alertasCriticos > 0 ? "negative" : "positive"}
        hint="Bloqueo o ETA vencida"
      />
    </section>
  );
}

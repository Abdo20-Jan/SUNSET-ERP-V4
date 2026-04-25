import {
  BankIcon,
  BookOpen01Icon,
  CargoShipIcon,
  ChartLineData01Icon,
  Coins01Icon,
  CreditCardIcon,
  TruckDeliveryIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";

import { auth } from "@/lib/auth";
import { fmtInt, fmtMoney } from "@/lib/format";
import {
  getAlertasDashboard,
  getEmbarquesRecientes,
  getKpisPrincipales,
  getKpisSecundarios,
  getPrestamosActivos,
  getSaldosBancarios,
  getUltimosAsientos,
} from "@/lib/services/dashboard";

import { AlertasCard } from "./_components/alertas-card";
import { EmbarquesRecientesCard } from "./_components/embarques-recientes-card";
import { KpiCard } from "./_components/kpi-card";
import { PrestamosActivosCard } from "./_components/prestamos-activos-card";
import { SaldosBancosCard } from "./_components/saldos-bancos-card";
import { SecondaryStat } from "./_components/secondary-stat";
import { UltimosAsientosCard } from "./_components/ultimos-asientos-card";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [
    session,
    kpis,
    secundarios,
    saldos,
    asientos,
    embarques,
    prestamos,
    alertas,
  ] = await Promise.all([
    auth(),
    getKpisPrincipales(),
    getKpisSecundarios(),
    getSaldosBancarios(),
    getUltimosAsientos(),
    getEmbarquesRecientes(),
    getPrestamosActivos(),
    getAlertasDashboard(),
  ]);

  const resultadoIsPositive = kpis.resultadoEjercicio.gte(0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Bienvenido, {session?.user.nombre}. Indicadores calculados desde la
          contabilidad (asientos contabilizados).
        </p>
      </div>

      <AlertasCard alertas={alertas} />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Saldo Bancos + Caja"
          value={fmtMoney(kpis.saldoBancosCaja.toString())}
          icon={Coins01Icon}
          accent={kpis.saldoBancosCaja.gte(0) ? "positive" : "negative"}
          hint="Cuentas 1.1.1.* y 1.1.2.*"
        />
        <KpiCard
          label="Total Pasivo"
          value={fmtMoney(kpis.totalPasivo.toString())}
          icon={CreditCardIcon}
          hint="Categoría PASIVO"
        />
        <KpiCard
          label="Resultado del Ejercicio"
          value={fmtMoney(kpis.resultadoEjercicio.toString())}
          icon={ChartLineData01Icon}
          accent={resultadoIsPositive ? "positive" : "negative"}
          hint="Ingresos − Egresos (histórico)"
        />
        <KpiCard
          label="Asientos Contabilizados"
          value={fmtInt(kpis.asientosContabilizados)}
          icon={BookOpen01Icon}
          hint="Total acumulado"
        />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <SaldosBancosCard saldos={saldos} />
          <PrestamosActivosCard prestamos={prestamos} />
        </div>
        <div className="flex flex-col gap-4">
          <UltimosAsientosCard asientos={asientos} />
          <EmbarquesRecientesCard embarques={embarques} />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SecondaryStat
          label="Embarques activos"
          value={secundarios.embarquesActivos}
          icon={CargoShipIcon}
        />
        <SecondaryStat
          label="Clientes activos"
          value={secundarios.clientesActivos}
          icon={UserGroupIcon}
        />
        <SecondaryStat
          label="Proveedores activos"
          value={secundarios.proveedoresActivos}
          icon={TruckDeliveryIcon}
        />
        <SecondaryStat
          label="Cuentas bancarias activas"
          value={secundarios.cuentasBancariasActivas}
          icon={BankIcon}
        />
      </section>
    </div>
  );
}

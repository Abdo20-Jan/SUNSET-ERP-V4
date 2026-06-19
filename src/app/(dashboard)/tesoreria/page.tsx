import { Suspense } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDataTransferHorizontalIcon,
  BankIcon,
  ChartLineData01Icon,
  Coins01Icon,
  CreditCardIcon,
  DocumentValidationIcon,
  ExchangeIcon,
  FileImportIcon,
  Invoice01Icon,
  ReceiptDollarIcon,
  Calendar03Icon,
} from "@hugeicons/core-free-icons";

import { auth } from "@/lib/auth";
import { convertirMonto, fmtMoney } from "@/lib/format";
import { getCotizacionParaFecha } from "@/lib/services/cotizacion";
import { getResumenTesoreria } from "@/lib/services/tesoreria-overview";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";

import { MonedaToggle, type Moneda } from "../reportes/_components/moneda-toggle";
import { KpiCard } from "../dashboard/_components/kpi-card";

const SECTIONS = [
  {
    href: "/tesoreria/cuentas",
    icon: CreditCardIcon,
    title: "Cuentas bancarias",
    description: "Alta, listado y saldos calculados",
  },
  {
    href: "/tesoreria/movimientos/nuevo",
    icon: ArrowDataTransferHorizontalIcon,
    title: "Nuevo movimiento",
    description: "Registrar cobro o pago (genera asiento automático)",
  },
  {
    href: "/tesoreria/transferencias/nuevo",
    icon: ExchangeIcon,
    title: "Nueva transferencia",
    description: "Mover dinero entre cuentas (con o sin cambio)",
  },
  {
    href: "/tesoreria/movimientos",
    icon: Invoice01Icon,
    title: "Movimientos",
    description: "Listado de cobros, pagos y transferencias con detalle del asiento",
  },
  {
    href: "/tesoreria/extracto",
    icon: DocumentValidationIcon,
    title: "Extracto bancario",
    description: "Movimientos de una cuenta con saldo corrido — equivale al extracto del banco",
  },
  {
    href: "/tesoreria/prestamos",
    icon: BankIcon,
    title: "Préstamos",
    description: "Préstamos del exterior: alta, saldo pendiente y amortizaciones",
  },
  {
    href: "/tesoreria/anticipos",
    icon: Coins01Icon,
    title: "Anticipos a proveedor",
    description:
      "Adelantos a proveedores locales (bienes/servicios), saldo y aplicación a facturas",
  },
  {
    href: "/tesoreria/cuentas-a-pagar",
    icon: ReceiptDollarIcon,
    title: "Cuentas a pagar",
    description: "Saldos pendientes a proveedores, despachante, Aduana e impuestos",
  },
  {
    href: "/tesoreria/cuentas-a-cobrar",
    icon: ReceiptDollarIcon,
    title: "Cuentas a cobrar",
    description: "Saldos deudores de clientes por ventas, con aging de vencimiento",
  },
  {
    href: "/tesoreria/saldos-proveedores",
    icon: Calendar03Icon,
    title: "Saldos por proveedor",
    description: "Saldo individual + facturas vencidas, próximas a vencer y al día",
  },
  {
    href: "/tesoreria/pagos-historial",
    icon: ChartLineData01Icon,
    title: "Histórico de pagos",
    description:
      "Listado de pagos con factura referenciada, banco origen, método y diferencia cambiaria",
  },
  {
    href: "/tesoreria/extractos",
    icon: FileImportIcon,
    title: "Importar extracto",
    description: "Subí el PDF del banco y aprobá las sugerencias de asiento generadas por IA",
  },
] as const;

export const dynamic = "force-dynamic";

type Pres = { moneda: Moneda; tc: string | null };

function KpiSkeleton() {
  return (
    <Card>
      <CardHeader className="gap-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-3 w-24" />
      </CardHeader>
    </Card>
  );
}

async function TesoreriaKpis({ moneda, tc }: Pres) {
  const r = await getResumenTesoreria();

  // Saldo Bancos + Caja: cada parte (ARS/USD nativo) se convierte native-aware
  // al TC de cierre y se suman → reconcilia con la tabla del dashboard.
  const saldoBancos =
    Number(convertirMonto(r.saldoBancosCaja.ars, "ARS", moneda, tc)) +
    Number(convertirMonto(r.saldoBancosCaja.usd, "USD", moneda, tc));

  // Préstamos: idem — la parte ARS nativa y la USD nativa (invariante a TC)
  // se convierten cada una a la moneda de presentación y se suman.
  const saldoPrestamos =
    Number(convertirMonto(r.prestamos.ars, "ARS", moneda, tc)) +
    Number(convertirMonto(r.prestamos.usd, "USD", moneda, tc));

  return (
    <>
      <KpiCard
        label="Saldo Bancos + Caja"
        value={fmtMoney(saldoBancos.toFixed(2))}
        icon={Coins01Icon}
        accent={saldoBancos >= 0 ? "positive" : "negative"}
        hint="Caja y Bancos · igual a la tabla"
      />
      <KpiCard
        label="Cuentas a cobrar"
        value={fmtMoney(convertirMonto(r.cuentasACobrar, "ARS", moneda, tc))}
        icon={ReceiptDollarIcon}
        accent="info"
        hint="Saldos deudores de clientes"
      />
      <KpiCard
        label="Cuentas a pagar"
        value={fmtMoney(convertirMonto(r.cuentasAPagar, "ARS", moneda, tc))}
        icon={ReceiptDollarIcon}
        accent="warning"
        hint="Proveedores, Aduana e impuestos"
      />
      <KpiCard
        label="Préstamos"
        value={fmtMoney(saldoPrestamos.toFixed(2))}
        icon={BankIcon}
        accent="neutral"
        hint="Saldo pendiente del exterior"
      />
    </>
  );
}

export default async function TesoreriaPage({
  searchParams,
}: {
  searchParams: Promise<{ moneda?: string }>;
}) {
  const [params, session, cotizacion] = await Promise.all([
    searchParams,
    auth(),
    getCotizacionParaFecha(new Date()),
  ]);

  const monedaPreferida: Moneda = session?.user.monedaPreferida === "ARS" ? "ARS" : "USD";
  const moneda: Moneda =
    params.moneda === "ARS" ? "ARS" : params.moneda === "USD" ? "USD" : monedaPreferida;

  // Saldos en moneda nativa mixta (ARS y USD): el TC se pasa SIEMPRE que haya
  // cotización (no gated en USD) — para presentar en ARS, las posiciones USD
  // igual necesitan ×TC. `convertirMonto` decide por moneda nativa↔destino.
  const tc = cotizacion ? cotizacion.valor.toString() : null;
  const tcInfo = cotizacion
    ? {
        valor: cotizacion.valor.toString(),
        fecha: cotizacion.fecha.toISOString().slice(0, 10),
        fuente: cotizacion.fuente,
      }
    : null;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Tesorería"
        description="Gestión de cuentas bancarias y movimientos financieros."
        actions={<MonedaToggle current={moneda} tcInfo={tcInfo} />}
      />

      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Suspense
          fallback={
            <>
              <KpiSkeleton />
              <KpiSkeleton />
              <KpiSkeleton />
              <KpiSkeleton />
            </>
          }
        >
          <TesoreriaKpis moneda={moneda} tc={tc} />
        </Suspense>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="group">
            <Card className="transition-colors group-hover:border-primary/40">
              <CardContent className="flex items-start gap-3">
                <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <HugeiconsIcon icon={s.icon} strokeWidth={2} />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{s.title}</span>
                  <span className="text-xs text-muted-foreground">{s.description}</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BookOpen01Icon,
  Invoice01Icon,
  BalanceScaleIcon,
  ChartLineData01Icon,
  CreditCardIcon,
} from "@hugeicons/core-free-icons";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const REPORTES = [
  {
    href: "/reportes/libro-diario",
    title: "Libro Diario",
    description:
      "Todos los asientos contabilizados del período, con sus líneas Debe/Haber.",
    icon: BookOpen01Icon,
  },
  {
    href: "/reportes/libro-mayor",
    title: "Libro Mayor",
    description:
      "Movimientos por cuenta analítica con saldo acumulado progresivo.",
    icon: Invoice01Icon,
  },
  {
    href: "/reportes/balance-general",
    title: "Balance General",
    description:
      "Activo, Pasivo y Patrimonio Neto agrupados por categoría — valida la ecuación contable.",
    icon: BalanceScaleIcon,
  },
  {
    href: "/reportes/estado-resultados",
    title: "Estado de Resultados",
    description:
      "Ingresos y Egresos del período, resultado neto destacado (ganancia/pérdida).",
    icon: ChartLineData01Icon,
  },
  {
    href: "/reportes/flujo-caja",
    title: "Flujo de Caja Proyectado",
    description:
      "Matriz mensual de 6 meses: realizado + proyectado de embarques y compras pendientes.",
    icon: CreditCardIcon,
  },
] as const;

export default function ReportesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Reportes</h1>
        <p className="text-sm text-muted-foreground">
          Reportes financieros del ERP. Fuente única: asientos contabilizados.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {REPORTES.map((r) => (
          <Link key={r.href} href={r.href} className="group">
            <Card className="h-full transition-all group-hover:ring-foreground/30">
              <CardHeader>
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                    <HugeiconsIcon icon={r.icon} className="size-5" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <CardTitle>{r.title}</CardTitle>
                    <CardDescription>{r.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

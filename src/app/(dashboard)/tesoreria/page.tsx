import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDataTransferHorizontalIcon,
  BankIcon,
  CreditCardIcon,
  ExchangeIcon,
  Invoice01Icon,
} from "@hugeicons/core-free-icons";

import { Card, CardContent } from "@/components/ui/card";

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
    description: "Listado y extracto de cobros, pagos y transferencias",
  },
  {
    href: "/tesoreria/prestamos",
    icon: BankIcon,
    title: "Préstamos",
    description:
      "Préstamos del exterior: alta, saldo pendiente y amortizaciones",
  },
] as const;

export default function TesoreriaPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Tesorería</h1>
        <p className="text-sm text-muted-foreground">
          Gestión de cuentas bancarias y movimientos financieros.
        </p>
      </div>

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
                  <span className="text-xs text-muted-foreground">
                    {s.description}
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

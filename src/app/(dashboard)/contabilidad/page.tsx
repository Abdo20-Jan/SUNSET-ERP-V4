import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Invoice01Icon,
  Calendar03Icon,
  BookOpen01Icon,
  BalanceScaleIcon,
} from "@hugeicons/core-free-icons";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const SECTIONS = [
  {
    href: "/contabilidad/cuentas",
    title: "Plan de Cuentas",
    description: "Árbol jerárquico de las 124 cuentas contables.",
    icon: Invoice01Icon,
  },
  {
    href: "/contabilidad/periodos",
    title: "Períodos Contables",
    description: "Gestioná el estado (ABIERTO/CERRADO) de los 36 períodos.",
    icon: Calendar03Icon,
  },
  {
    href: "/contabilidad/asientos",
    title: "Asientos",
    description: "Listá, contabilizá y anulá asientos. Creación manual y auditoría.",
    icon: BookOpen01Icon,
  },
  {
    href: "/contabilidad/reportes/balance",
    title: "Balance de Sumas y Saldos",
    description: "Tree table con saldo inicial, movimientos y drill-down por período.",
    icon: BalanceScaleIcon,
  },
] as const;

export default function ContabilidadPage() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">Contabilidad</h1>
        <p className="text-sm text-muted-foreground">
          Seleccioná una sección.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link key={section.href} href={section.href} className="block">
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <HugeiconsIcon icon={section.icon} className="size-5" />
                  </div>
                  <CardTitle>{section.title}</CardTitle>
                </div>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

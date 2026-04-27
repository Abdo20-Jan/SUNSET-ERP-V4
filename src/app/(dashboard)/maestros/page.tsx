import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ChartLineData01Icon,
  TireIcon,
  TruckDeliveryIcon,
  UserGroupIcon,
  WarehouseIcon,
} from "@hugeicons/core-free-icons";

import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";

export default async function MaestrosPage() {
  const [
    clientesCount,
    proveedoresCount,
    productosCount,
    depositosCount,
    cotizacionesCount,
  ] = await Promise.all([
    db.cliente.count(),
    db.proveedor.count(),
    db.producto.count(),
    db.deposito.count(),
    db.cotizacion.count(),
  ]);

  const sections = [
    {
      href: "/maestros/clientes",
      icon: UserGroupIcon,
      title: "Clientes",
      description: "Cadastro de clientes y vinculación contable",
      count: clientesCount,
    },
    {
      href: "/maestros/proveedores",
      icon: TruckDeliveryIcon,
      title: "Proveedores",
      description: "Cadastro de proveedores locales e del exterior",
      count: proveedoresCount,
    },
    {
      href: "/maestros/productos",
      icon: TireIcon,
      title: "Productos",
      description: "Catálogo de neumáticos, precios y stock",
      count: productosCount,
    },
    {
      href: "/maestros/depositos",
      icon: WarehouseIcon,
      title: "Depósitos",
      description: "Ubicaciones físicas de inventario",
      count: depositosCount,
    },
    {
      href: "/maestros/cotizaciones",
      icon: ChartLineData01Icon,
      title: "Cotizaciones USD",
      description: "Tipo de cambio del día (1 USD = X ARS) para reportes",
      count: cotizacionesCount,
    },
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Maestros</h1>
        <p className="text-sm text-muted-foreground">
          Cadastros base que alimentan los módulos de Tesorería, COMEX y Ventas.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {sections.map((s) => (
          <Link key={s.href} href={s.href} className="group">
            <Card className="h-full transition-colors group-hover:border-primary/40">
              <CardContent className="flex items-start gap-3">
                <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <HugeiconsIcon icon={s.icon} strokeWidth={2} />
                </div>
                <div className="flex flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">{s.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.description}
                  </span>
                  <span className="mt-1 font-mono text-xs text-muted-foreground">
                    {s.count} registro{s.count === 1 ? "" : "s"}
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

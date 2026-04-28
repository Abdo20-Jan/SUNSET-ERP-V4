import { db } from "@/lib/db";
import { Card } from "@/components/ui/card";

import { CuentasTreeTable, type CuentaNode } from "./cuentas-tree-table";

export default async function CuentasPage() {
  const cuentas = await db.cuentaContable.findMany({
    orderBy: { codigo: "asc" },
  });

  const byCodigo = new Map<string, CuentaNode>();
  for (const c of cuentas) {
    byCodigo.set(c.codigo, { ...c, children: [] });
  }

  const roots: CuentaNode[] = [];
  for (const c of cuentas) {
    const node = byCodigo.get(c.codigo)!;
    if (c.padreCodigo) {
      const parent = byCodigo.get(c.padreCodigo);
      if (parent) parent.children!.push(node);
      else roots.push(node);
    } else {
      roots.push(node);
    }
  }

  const stripEmptyChildren = (node: CuentaNode) => {
    if (!node.children) return;
    if (node.children.length === 0) {
      delete node.children;
      return;
    }
    node.children.forEach(stripEmptyChildren);
  };
  roots.forEach(stripEmptyChildren);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-[15px] font-semibold tracking-tight">
          Plan de Cuentas
        </h1>
        <p className="text-sm text-muted-foreground">
          {cuentas.length} cuentas contables
        </p>
      </div>
      <Card className="py-0">
        <CuentasTreeTable data={roots} />
      </Card>
    </div>
  );
}

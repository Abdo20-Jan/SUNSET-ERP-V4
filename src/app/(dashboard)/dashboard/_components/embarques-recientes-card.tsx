import Link from "next/link";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import type { EmbarqueReciente } from "@/lib/services/dashboard";

import { EmbarqueEstadoBadge } from "./embarque-estado-badge";

export function EmbarquesRecientesCard({
  embarques,
}: {
  embarques: EmbarqueReciente[];
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Embarques Recientes</CardTitle>
        <CardDescription>
          Últimos 5 embarques cargados en COMEX.
        </CardDescription>
        <CardAction>
          <Link
            href="/comex/embarques"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Ver todos →
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {embarques.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">
            No hay embarques registrados.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Código</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="pr-6">Fecha</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {embarques.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="pl-6">
                    <Link
                      href={`/comex/embarques/${e.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {e.codigo}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate" title={e.proveedor.nombre}>
                    {e.proveedor.nombre}
                  </TableCell>
                  <TableCell>
                    <EmbarqueEstadoBadge estado={e.estado} />
                  </TableCell>
                  <TableCell className="pr-6 text-muted-foreground">
                    {fmtDate(e.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

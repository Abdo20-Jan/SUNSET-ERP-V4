"use client";

import { Fragment, useState } from "react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import type { CuentaBancariaOption } from "@/lib/actions/movimientos-tesoreria";
import type { FacturaSaldoUsd, ProveedorExteriorSaldo } from "@/lib/services/cuentas-a-pagar";

import {
  PagoExteriorDialog,
  type PagoExteriorFacturaInfo,
} from "./_components/pago-exterior-dialog";

function fmtUsd(s: string | number) {
  const n = typeof s === "string" ? Number(s) : s;
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtFecha(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function toFacturaInfo(
  factura: FacturaSaldoUsd,
  proveedorNombre: string,
  embarqueCodigo: string,
): PagoExteriorFacturaInfo {
  return {
    facturaOrigen: factura.origen === "compra" ? "compra" : "embarqueCosto",
    facturaId: factura.origen === "compra" ? factura.id : Number(factura.id),
    facturaNumero: factura.numero,
    embarqueCodigo,
    proveedorNombre,
    saldoUsd: factura.saldoUsd,
    tcFactura: factura.tipoCambioOriginal,
  };
}

export function ProveedoresExteriorTable({
  proveedores,
  cuentasBancariasArs,
  defaultFecha,
}: {
  proveedores: ProveedorExteriorSaldo[];
  cuentasBancariasArs: CuentaBancariaOption[];
  defaultFecha: string;
}) {
  const [openProv, setOpenProv] = useState<Set<string>>(new Set());
  const [openEmb, setOpenEmb] = useState<Set<string>>(new Set());
  const [pagoFactura, setPagoFactura] = useState<PagoExteriorFacturaInfo | null>(null);

  if (proveedores.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Sin saldos en proveedores del exterior.
      </Card>
    );
  }

  function toggleProv(id: string) {
    setOpenProv((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleEmb(id: string) {
    setOpenEmb((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <Card className="overflow-x-auto py-0">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-3 py-2 w-8" />
              <th className="px-3 py-2">Proveedor / Embarque / Factura</th>
              <th className="px-3 py-2 text-right">Saldo USD</th>
              <th className="px-3 py-2 text-right">Acción</th>
            </tr>
          </thead>
          <tbody>
            {proveedores.map((p) => {
              const provOpen = openProv.has(p.proveedorId);
              return (
                <Fragment key={p.proveedorId}>
                  <tr className="border-t bg-background">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => toggleProv(p.proveedorId)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={provOpen ? "Cerrar" : "Expandir"}
                      >
                        {provOpen ? "▾" : "▸"}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-medium">
                      <Link
                        href={`/maestros/proveedores/${p.proveedorId}`}
                        className="hover:underline"
                      >
                        {p.proveedorNombre}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">{p.pais}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-medium tabular-nums">
                      {fmtUsd(p.saldoUsd)}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                      {p.cuit ?? "—"}
                    </td>
                  </tr>
                  {provOpen &&
                    p.embarques.map((e) => {
                      const embKey = `${p.proveedorId}::${e.embarqueId}`;
                      const embOpen = openEmb.has(embKey);
                      return (
                        <Fragment key={embKey}>
                          <tr className="bg-muted/30">
                            <td className="px-3 py-1.5" />
                            <td className="px-3 py-1.5 pl-8">
                              <button
                                type="button"
                                onClick={() => toggleEmb(embKey)}
                                className="mr-2 text-muted-foreground hover:text-foreground"
                                aria-label={embOpen ? "Cerrar" : "Expandir"}
                              >
                                {embOpen ? "▾" : "▸"}
                              </button>
                              <span className="text-xs text-muted-foreground">Embarque</span>{" "}
                              <Link
                                href={`/comex/embarques/${e.embarqueId}`}
                                className="font-mono text-primary hover:underline"
                              >
                                {e.embarqueCodigo}
                              </Link>
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                              {fmtUsd(e.saldoUsd)}
                            </td>
                            <td className="px-3 py-1.5" />
                          </tr>
                          {embOpen &&
                            e.facturas.map((f) => (
                              <tr key={`${embKey}::${f.origen}::${f.id}`} className="bg-muted/10">
                                <td />
                                <td className="px-3 py-1 pl-16 text-xs">
                                  <span className="text-muted-foreground">Factura</span>{" "}
                                  <span className="font-mono">{f.numero}</span>
                                  <span className="ml-2 text-muted-foreground">
                                    · TC orig {f.tipoCambioOriginal} · venc{" "}
                                    {fmtFecha(f.fechaVencimiento)}
                                  </span>
                                </td>
                                <td className="px-3 py-1 text-right font-mono text-xs tabular-nums">
                                  {fmtUsd(f.saldoUsd)}
                                </td>
                                <td className="px-3 py-1 text-right">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPagoFactura(
                                        toFacturaInfo(f, p.proveedorNombre, e.embarqueCodigo),
                                      )
                                    }
                                    className="h-6 rounded-[2px] border border-input bg-background px-2 text-xs font-medium hover:bg-accent"
                                  >
                                    Pagar
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                  {provOpen && p.facturasSueltas.length > 0 && (
                    <>
                      <tr className="bg-muted/30">
                        <td className="px-3 py-1.5" />
                        <td className="px-3 py-1.5 pl-8 text-xs text-muted-foreground" colSpan={3}>
                          Facturas sin embarque vinculado
                        </td>
                      </tr>
                      {p.facturasSueltas.map((f) => (
                        <tr key={`suelta::${p.proveedorId}::${f.id}`} className="bg-muted/10">
                          <td />
                          <td className="px-3 py-1 pl-16 text-xs">
                            <span className="text-muted-foreground">Factura</span>{" "}
                            <span className="font-mono">{f.numero}</span>
                            <span className="ml-2 text-muted-foreground">
                              · TC orig {f.tipoCambioOriginal} · venc {fmtFecha(f.fechaVencimiento)}
                            </span>
                          </td>
                          <td className="px-3 py-1 text-right font-mono text-xs tabular-nums">
                            {fmtUsd(f.saldoUsd)}
                          </td>
                          <td className="px-3 py-1 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setPagoFactura(toFacturaInfo(f, p.proveedorNombre, "—"))
                              }
                              className="h-6 rounded-[2px] border border-input bg-background px-2 text-xs font-medium hover:bg-accent"
                            >
                              Pagar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>

      <PagoExteriorDialog
        open={pagoFactura !== null}
        onOpenChange={(open) => {
          if (!open) setPagoFactura(null);
        }}
        factura={pagoFactura}
        cuentasBancariasArs={cuentasBancariasArs}
        defaultFecha={defaultFecha}
      />
    </>
  );
}

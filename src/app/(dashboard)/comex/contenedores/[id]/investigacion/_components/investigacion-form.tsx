"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { upload } from "@vercel/blob/client";

import {
  abrirInvestigacionAction,
  arquivarInvestigacionAction,
  concluirInvestigacionAction,
  diagnosticarCausaAction,
  registrarConferenciaAction,
} from "@/lib/actions/divergencia";
import type { ContenedorInvestigacionDTO } from "@/lib/services/divergencia-investigacion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// PR 3.5 — UI de la investigación de divergencia (D9). Flujo completo en una
// pantalla: abrir → conferencia física (peso/lacres + evidencias vía Vercel
// Blob client upload) → diagnóstico de causa → concluir (genera asiento) |
// archivar. El upload sube directo al Blob (handleUploadUrl) y guardamos las
// URLs vía registrarConferenciaAction.

const CAUSAS = [
  { value: "FABRICA_ORIGEM", label: "Falta de origen (fábrica)" },
  { value: "TRANSPORTE", label: "Transporte" },
  { value: "DEPOSITARIO", label: "Depositario" },
  { value: "SINISTRO_SEGURADO", label: "Siniestro asegurado" },
  { value: "NAO_IDENTIFICADA", label: "No identificada" },
] as const;

const RESPONSABLES = [
  { value: "FORNECEDOR", label: "Proveedor" },
  { value: "TRANSPORTADOR", label: "Transportador" },
  { value: "SEGURADORA", label: "Aseguradora" },
  { value: "NENHUM", label: "Ninguno" },
] as const;

const UPLOAD_URL = "/api/comex/divergencia/upload";

interface Props {
  contenedor: ContenedorInvestigacionDTO;
  defaultFecha: string;
}

export function InvestigacionForm({ contenedor, defaultFecha }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inv = contenedor.investigacion;

  // ---- caso 1: contenedor no desconsolidado ----
  if (!contenedor.desconsolidacionId) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          El contenedor todavía no fue desconsolidado — no hay divergencia que investigar.
        </CardContent>
      </Card>
    );
  }

  // ---- caso 2: sin investigación abierta ----
  if (!inv) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 py-6">
          {contenedor.tieneDivergencia ? (
            <>
              <p className="text-sm">
                Se detectó una diferencia entre el físico conferido y lo declarado. Abrí la
                investigación para registrar la conferencia y diagnosticar la causa.
              </p>
              <div>
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await abrirInvestigacionAction({
                        contenedorId: contenedor.contenedorId,
                      });
                      if (!r.ok) {
                        toast.error(r.error);
                        return;
                      }
                      toast.success("Investigación abierta.");
                      router.refresh();
                    })
                  }
                >
                  Abrir investigación
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              El contenedor no presenta diferencias entre físico y declarado.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // ---- caso 3: investigación abierta ----
  const editable = inv.estado === "EM_ANALISE";

  return (
    <div className="flex flex-col gap-3">
      <ItemsDivergentes inv={inv} />

      {!editable ? (
        <Card>
          <CardContent className="py-4 text-sm">
            Investigación <strong>{inv.estado === "CONCLUIDA" ? "concluida" : "archivada"}</strong>.
            Solo lectura.
          </CardContent>
        </Card>
      ) : (
        <EditableSecciones
          contenedor={contenedor}
          inv={inv}
          defaultFecha={defaultFecha}
          pending={pending}
          startTransition={startTransition}
          router={router}
        />
      )}
    </div>
  );
}

function ItemsDivergentes({
  inv,
}: {
  inv: NonNullable<ContenedorInvestigacionDTO["investigacion"]>;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <h3 className="mb-2 text-sm font-medium">Ítems divergentes</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1 pr-2">Producto</th>
              <th className="py-1 pr-2 text-right">Declarada</th>
              <th className="py-1 pr-2 text-right">Física</th>
              <th className="py-1 pr-2 text-right">Diferencia</th>
              <th className="py-1 text-right">Valor USD</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((it) => (
              <tr key={it.itemContenedorId} className="border-b last:border-0">
                <td className="py-1 pr-2">{it.productoLabel}</td>
                <td className="py-1 pr-2 text-right">{it.cantidadDeclarada}</td>
                <td className="py-1 pr-2 text-right">{it.cantidadFisica}</td>
                <td
                  className={`py-1 pr-2 text-right ${it.diferenciaUnidades < 0 ? "text-amber-600" : "text-emerald-600"}`}
                >
                  {it.diferenciaUnidades > 0 ? `+${it.diferenciaUnidades}` : it.diferenciaUnidades}
                </td>
                <td className="py-1 text-right">{it.valorImpactadoUSD}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function EditableSecciones({
  contenedor,
  inv,
  defaultFecha,
  pending,
  startTransition,
  router,
}: {
  contenedor: ContenedorInvestigacionDTO;
  inv: NonNullable<ContenedorInvestigacionDTO["investigacion"]>;
  defaultFecha: string;
  pending: boolean;
  startTransition: (cb: () => void) => void;
  router: ReturnType<typeof useRouter>;
}) {
  // Conferencia
  const [peso, setPeso] = useState(inv.pesoContenedorKg ?? "");
  const [lacreOrigemOk, setLacreOrigemOk] = useState(inv.lacreOrigemOk ?? false);
  const [lacreOrigemObs, setLacreOrigemObs] = useState(inv.lacreOrigemObs ?? "");
  const [lacrePemaOk, setLacrePemaOk] = useState(inv.lacrePemaOk ?? false);
  const [lacreCustomsOk, setLacreCustomsOk] = useState(inv.lacreCustomsOk ?? false);
  const [fotos, setFotos] = useState<string[]>(inv.fotosUrls);
  const [documentos, setDocumentos] = useState<string[]>(inv.documentosUrls);
  const [gravacao, setGravacao] = useState<string | null>(inv.gravacaoDescargaUrl);
  const [uploading, setUploading] = useState(false);

  // Diagnóstico
  const [causa, setCausa] = useState<string>(inv.causaIdentificada ?? "");
  const [responsavelTipo, setResponsavelTipo] = useState<string>(inv.responsavelTipo ?? "");
  const [responsavelId, setResponsavelId] = useState(inv.responsavelId ?? "");
  const [polizaSeguro, setPolizaSeguro] = useState(inv.polizaSeguro ?? "");

  // Conclusión
  const [fecha, setFecha] = useState(defaultFecha);
  const [cuentaPorCobrarId, setCuentaPorCobrarId] = useState("");
  const [concluirOpen, setConcluirOpen] = useState(false);

  async function subir(
    files: FileList | null,
    setter: (urls: string[]) => void,
    single = false,
  ): Promise<void> {
    if (!files?.length) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: UPLOAD_URL,
        });
        urls.push(blob.url);
      }
      if (single) {
        setGravacao(urls[0] ?? null);
      } else {
        setter(urls);
      }
      toast.success("Evidencia subida.");
    } catch {
      toast.error("Error al subir el archivo.");
    } finally {
      setUploading(false);
    }
  }

  function guardarConferencia() {
    startTransition(async () => {
      const r = await registrarConferenciaAction({
        investigacionId: inv.id,
        contenedorId: contenedor.contenedorId,
        pesoContenedorKg: peso.trim() || undefined,
        lacreOrigemOk,
        lacreOrigemObs: lacreOrigemObs.trim() || undefined,
        lacrePemaOk,
        lacreCustomsOk,
        gravacaoDescargaUrl: gravacao ?? undefined,
        fotosUrls: fotos,
        documentosUrls: documentos,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Conferencia guardada.");
      router.refresh();
    });
  }

  function guardarDiagnostico() {
    if (!causa || !responsavelTipo) {
      toast.error("Indicá causa y responsable.");
      return;
    }
    startTransition(async () => {
      const r = await diagnosticarCausaAction({
        investigacionId: inv.id,
        contenedorId: contenedor.contenedorId,
        causa: causa as (typeof CAUSAS)[number]["value"],
        responsavelTipo: responsavelTipo as (typeof RESPONSABLES)[number]["value"],
        responsavelId: responsavelId.trim() || undefined,
        polizaSeguro: polizaSeguro.trim() || undefined,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Diagnóstico guardado.");
      router.refresh();
    });
  }

  function concluir() {
    startTransition(async () => {
      const r = await concluirInvestigacionAction({
        investigacionId: inv.id,
        contenedorId: contenedor.contenedorId,
        embarqueId: contenedor.embarqueId,
        fecha,
        cuentaPorCobrarId: cuentaPorCobrarId.trim() ? Number(cuentaPorCobrarId) : undefined,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setConcluirOpen(false);
      toast.success(
        r.asientoId
          ? "Investigación concluida + asiento de ajuste generado."
          : "Investigación concluida (sin impacto valorizado).",
      );
      router.push(`/comex/embarques/${contenedor.embarqueId}`);
      router.refresh();
    });
  }

  function arquivar() {
    startTransition(async () => {
      const r = await arquivarInvestigacionAction({
        investigacionId: inv.id,
        contenedorId: contenedor.contenedorId,
        embarqueId: contenedor.embarqueId,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Investigación archivada.");
      router.push(`/comex/embarques/${contenedor.embarqueId}`);
      router.refresh();
    });
  }

  return (
    <>
      {/* Conferencia física */}
      <Card>
        <CardContent className="flex flex-col gap-3 py-4">
          <h3 className="text-sm font-medium">Conferencia física</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Peso del contenedor (kg)
              <Input
                type="number"
                step="0.001"
                min="0"
                value={peso}
                onChange={(e) => setPeso(e.target.value)}
                placeholder="0.000"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={lacreOrigemOk}
                onChange={(e) => setLacreOrigemOk(e.target.checked)}
              />
              Lacre origen OK
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={lacrePemaOk}
                onChange={(e) => setLacrePemaOk(e.target.checked)}
              />
              Lacre PEMA OK
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={lacreCustomsOk}
                onChange={(e) => setLacreCustomsOk(e.target.checked)}
              />
              Lacre Aduana OK
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Observación de lacres
            <Input value={lacreOrigemObs} onChange={(e) => setLacreOrigemObs(e.target.value)} />
          </label>

          {/* Evidencias (Vercel Blob client upload) */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              Fotos
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={uploading || pending}
                onChange={(e) => subir(e.target.files, (u) => setFotos((p) => [...p, ...u]))}
              />
              <span className="text-xs text-muted-foreground">{fotos.length} subida(s)</span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Documentos (PDF)
              <input
                type="file"
                accept="application/pdf"
                multiple
                disabled={uploading || pending}
                onChange={(e) => subir(e.target.files, (u) => setDocumentos((p) => [...p, ...u]))}
              />
              <span className="text-xs text-muted-foreground">{documentos.length} subido(s)</span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Grabación de descarga
              <input
                type="file"
                accept="video/*"
                disabled={uploading || pending}
                onChange={(e) => subir(e.target.files, () => {}, true)}
              />
              <span className="text-xs text-muted-foreground">{gravacao ? "subida" : "—"}</span>
            </label>
          </div>

          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={pending || uploading}
              onClick={guardarConferencia}
            >
              Guardar conferencia
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Diagnóstico de causa */}
      <Card>
        <CardContent className="flex flex-col gap-3 py-4">
          <h3 className="text-sm font-medium">Diagnóstico de causa</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Causa
              <select
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
                value={causa}
                onChange={(e) => setCausa(e.target.value)}
              >
                <option value="">— Seleccionar —</option>
                {CAUSAS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Responsable
              <select
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
                value={responsavelTipo}
                onChange={(e) => setResponsavelTipo(e.target.value)}
              >
                <option value="">— Seleccionar —</option>
                {RESPONSABLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Responsable (ID/ref, opcional)
              <Input value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Póliza de seguro (si siniestro)
              <Input value={polizaSeguro} onChange={(e) => setPolizaSeguro(e.target.value)} />
            </label>
          </div>
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={guardarDiagnostico}
            >
              Guardar diagnóstico
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Conclusión / archivo */}
      <Card>
        <CardContent className="flex flex-col gap-3 py-4">
          <h3 className="text-sm font-medium">Cerrar investigación</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Fecha del ajuste
              <DatePicker value={fecha} onChange={(v) => setFecha(v ?? defaultFecha)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Cuenta por cobrar (ID, si hay responsable de la falta)
              <Input
                type="number"
                min="1"
                value={cuentaPorCobrarId}
                onChange={(e) => setCuentaPorCobrarId(e.target.value)}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Dialog open={concluirOpen} onOpenChange={setConcluirOpen}>
              <DialogTrigger
                render={
                  <Button type="button" disabled={pending}>
                    Concluir (generar ajuste)
                  </Button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Concluir investigación</DialogTitle>
                  <DialogDescription>
                    Se generará el asiento de ajuste contable según la causa diagnosticada y el
                    contenedor volverá a DESCONSOLIDADO. Esta acción no se puede deshacer desde acá.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConcluirOpen(false)}
                    disabled={pending}
                  >
                    Cancelar
                  </Button>
                  <Button type="button" onClick={concluir} disabled={pending}>
                    Confirmar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button type="button" variant="outline" disabled={pending} onClick={arquivar}>
              Archivar (sin ajuste)
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

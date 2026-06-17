import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  abrirInvestigacion,
  arquivarInvestigacion,
  concluirInvestigacion,
  diagnosticarCausa,
  registrarConferenciaFisica,
} from "@/lib/services/divergencia-investigacion";
import { createTestDb, type TestDb } from "./db";

// PR 3.3 — service de investigación de divergencia formal (D9). Opera 1:1
// con una Desconsolidacion: abre la investigación a partir del físico ≠
// declarado (counters de ItemContenedor), registra la conferencia física,
// diagnostica la causa-raíz y, al concluir, genera el asiento de ajuste vía
// el helper de PR 3.1 (`crearAsientoDivergencia`). Todo enrutado a la BD
// efímera pasando `db.prisma` como `tx`.

const FECHA = new Date("2025-06-15T12:00:00.000Z");

// 1 USD = 1000 ARS; costo FC unitario 10 USD; declarado 100 un.
// → cada unidad de diferencia vale 10 USD = 10 000 ARS.
const TIPO_CAMBIO = "1000.000000";
const COSTO_FC_UNITARIO = "10.0000";
const CANTIDAD_DECLARADA = 100;

const TABLAS = [
  "DivergenciaItem",
  "DivergenciaInvestigacion",
  "Desconsolidacion",
  "ItemContenedor",
  "Contenedor",
  "ItemEmbarque",
  "Embarque",
  "Producto",
  "Proveedor",
  "Deposito",
  "Asiento",
  "LineaAsiento",
  "CuentaContable",
  "PeriodoContable",
] as const;

interface Seed {
  desconsolidacionId: string;
  contenedorId: string;
  itemContenedorId: number;
}

describe("divergencia-investigacion (PR 3.3, D9)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.reset(TABLAS);
    await db.prisma.periodoContable.create({
      data: {
        codigo: "2025-06",
        nombre: "Junio 2025",
        fechaInicio: new Date("2025-06-01T00:00:00.000Z"),
        fechaFin: new Date("2025-06-30T00:00:00.000Z"),
        estado: "ABIERTO",
      },
    });
  });

  /**
   * Semea proveedor → producto → embarque (USD) → contenedor en DF →
   * ItemContenedor (declarado 100, costo FC 10 USD) → Desconsolidacion.
   * `cantidadFisica` se setea por test (lo que simula la conferencia).
   */
  async function seed(): Promise<Seed> {
    const proveedor = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const producto = await db.prisma.producto.create({
      data: { codigo: "SKU-1", nombre: "Neumático 295/80" },
    });
    const depositoFiscal = await db.prisma.deposito.create({
      data: { nombre: "DF Buenos Aires", tipo: "ZONA_PRIMARIA", subtipo: "DEPOSITO_FISCAL" },
    });
    const embarque = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-3.3",
        proveedorId: proveedor.id,
        moneda: "USD",
        tipoCambio: TIPO_CAMBIO,
      },
    });
    await db.prisma.itemEmbarque.create({
      data: {
        embarqueId: embarque.id,
        productoId: producto.id,
        cantidad: CANTIDAD_DECLARADA,
        precioUnitarioFob: "10.00",
      },
    });
    const contenedor = await db.prisma.contenedor.create({
      data: {
        embarqueId: embarque.id,
        numeroContenedor: "MSCU0000001",
        estado: "EN_DEPOSITO_FISCAL",
        depositoFiscalId: depositoFiscal.id,
      },
    });
    const item = await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        productoId: producto.id,
        cantidadDeclarada: CANTIDAD_DECLARADA,
        costoFCUnitario: COSTO_FC_UNITARIO,
      },
    });
    const desconsolidacion = await db.prisma.desconsolidacion.create({
      data: {
        contenedorId: contenedor.id,
        depositoFiscalId: depositoFiscal.id,
        cantidadDeclaradaTotal: CANTIDAD_DECLARADA,
      },
    });
    return {
      desconsolidacionId: desconsolidacion.id,
      contenedorId: contenedor.id,
      itemContenedorId: item.id,
    };
  }

  /**
   * Variante con DOS SKUs en el mismo contenedor (declarado 100 c/u, costo FC
   * 10 USD). Permite probar el "no netear" entre SKUs: uno con falta, otro con
   * sobra. `abrirInvestigacion` sólo lee ItemContenedor → no necesita ItemEmbarque.
   */
  async function seedDosItems(): Promise<{
    desconsolidacionId: string;
    contenedorId: string;
    itemA: number;
    itemB: number;
  }> {
    const proveedor = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const prodA = await db.prisma.producto.create({
      data: { codigo: "SKU-A", nombre: "Neumático A" },
    });
    const prodB = await db.prisma.producto.create({
      data: { codigo: "SKU-B", nombre: "Neumático B" },
    });
    const depositoFiscal = await db.prisma.deposito.create({
      data: { nombre: "DF Buenos Aires", tipo: "ZONA_PRIMARIA", subtipo: "DEPOSITO_FISCAL" },
    });
    const embarque = await db.prisma.embarque.create({
      data: { codigo: "EMB-3.3-2", proveedorId: proveedor.id, moneda: "USD", tipoCambio: TIPO_CAMBIO },
    });
    const contenedor = await db.prisma.contenedor.create({
      data: {
        embarqueId: embarque.id,
        numeroContenedor: "MSCU0000002",
        estado: "EN_DEPOSITO_FISCAL",
        depositoFiscalId: depositoFiscal.id,
      },
    });
    const itemA = await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        productoId: prodA.id,
        cantidadDeclarada: CANTIDAD_DECLARADA,
        costoFCUnitario: COSTO_FC_UNITARIO,
      },
    });
    const itemB = await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        productoId: prodB.id,
        cantidadDeclarada: CANTIDAD_DECLARADA,
        costoFCUnitario: COSTO_FC_UNITARIO,
      },
    });
    const desconsolidacion = await db.prisma.desconsolidacion.create({
      data: {
        contenedorId: contenedor.id,
        depositoFiscalId: depositoFiscal.id,
        cantidadDeclaradaTotal: CANTIDAD_DECLARADA * 2,
      },
    });
    return {
      desconsolidacionId: desconsolidacion.id,
      contenedorId: contenedor.id,
      itemA: itemA.id,
      itemB: itemB.id,
    };
  }

  /** Setea la cantidad física conferida (lo que detecta la divergencia). */
  async function setFisica(itemContenedorId: number, cantidadFisica: number) {
    await db.prisma.itemContenedor.update({
      where: { id: itemContenedorId },
      data: { cantidadFisica },
    });
  }

  /** Crea una cuenta a cobrar (crédito contra el responsable). */
  async function cuentaPorCobrar(): Promise<number> {
    const c = await db.prisma.cuentaContable.create({
      data: {
        codigo: "1.1.2.99",
        nombre: "DEUDORES POR DIFERENCIAS COMEX",
        tipo: "ANALITICA",
        categoria: "ACTIVO",
        nivel: 4,
      },
    });
    return c.id;
  }

  async function lineasDe(asientoId: string) {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId },
      include: { cuenta: { select: { codigo: true } } },
      orderBy: { id: "asc" },
    });
    return lineas.map((l) => ({
      codigo: l.cuenta.codigo,
      debe: l.debe.toFixed(2),
      haber: l.haber.toFixed(2),
    }));
  }

  // ---- abrir ------------------------------------------------------------

  describe("abrirInvestigacion", () => {
    it("calcula diff y valorImpactadoUSD por SKU y deja el contenedor AGUARDANDO_INVESTIGACAO", async () => {
      const s = await seed();
      await setFisica(s.itemContenedorId, 90); // falta de 10

      const inv = await abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma);

      expect(inv.estado).toBe("EM_ANALISE");
      const items = await db.prisma.divergenciaItem.findMany({
        where: { divergenciaInvestigacionId: inv.id },
      });
      expect(items).toHaveLength(1);
      expect(items[0]?.cantidadDeclarada).toBe(100);
      expect(items[0]?.cantidadFisica).toBe(90);
      expect(items[0]?.diferenciaUnidades).toBe(-10);
      expect(items[0]?.valorImpactadoUSD.toFixed(4)).toBe("-100.0000");

      const cont = await db.prisma.contenedor.findUniqueOrThrow({ where: { id: s.contenedorId } });
      expect(cont.estado).toBe("AGUARDANDO_INVESTIGACAO");
    });

    it("rechaza cuando no hay divergencia (físico == declarado)", async () => {
      const s = await seed();
      await setFisica(s.itemContenedorId, 100);
      await expect(
        abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma),
      ).rejects.toMatchObject({ code: "SIN_DIVERGENCIA" });
    });

    it("rechaza desconsolidación inexistente", async () => {
      await expect(
        abrirInvestigacion({ desconsolidacionId: "no-existe" }, db.prisma),
      ).rejects.toMatchObject({ code: "DESCONSOLIDACION_INEXISTENTE" });
    });

    it("rechaza abrir dos investigaciones para la misma desconsolidación", async () => {
      const s = await seed();
      await setFisica(s.itemContenedorId, 90);
      await abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma);
      await expect(
        abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma),
      ).rejects.toMatchObject({ code: "INVESTIGACION_DUPLICADA" });
    });

    it("rechaza si falta el costo FC unitario", async () => {
      const s = await seed();
      await db.prisma.itemContenedor.update({
        where: { id: s.itemContenedorId },
        data: { cantidadFisica: 90, costoFCUnitario: null },
      });
      await expect(
        abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma),
      ).rejects.toMatchObject({ code: "COSTO_NO_DISPONIBLE" });
    });
  });

  // ---- conferencia física ----------------------------------------------

  describe("registrarConferenciaFisica", () => {
    it("persiste peso, lacres y evidencias", async () => {
      const s = await seed();
      await setFisica(s.itemContenedorId, 90);
      const inv = await abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma);

      const actualizada = await registrarConferenciaFisica(
        inv.id,
        {
          pesoContenedorKg: "1980.500",
          pesoEsperadoKg: "2200.000",
          lacreOrigemOk: true,
          lacreOrigemObs: "lacre violado en origen",
          lacrePemaOk: false,
          fotosUrls: ["https://blob/f1.jpg"],
          documentosUrls: ["https://blob/acta.pdf"],
        },
        db.prisma,
      );

      expect(actualizada.pesoContenedorKg?.toFixed(3)).toBe("1980.500");
      expect(actualizada.lacrePemaOk).toBe(false);
      expect(actualizada.fotosUrls).toEqual(["https://blob/f1.jpg"]);
    });

    it("rechaza conferencia en investigación ya concluida", async () => {
      const s = await seed();
      await setFisica(s.itemContenedorId, 90);
      const inv = await abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma);
      await diagnosticarCausa(
        inv.id,
        { causa: "NAO_IDENTIFICADA", responsavelTipo: "NENHUM" },
        db.prisma,
      );
      await concluirInvestigacion(inv.id, { fecha: FECHA }, db.prisma);
      await expect(
        registrarConferenciaFisica(inv.id, { pesoContenedorKg: "1.000" }, db.prisma),
      ).rejects.toMatchObject({ code: "ESTADO_INVALIDO" });
    });
  });

  // ---- diagnóstico de causa --------------------------------------------

  describe("diagnosticarCausa", () => {
    it("acepta una causa coherente con su responsable", async () => {
      const s = await seed();
      await setFisica(s.itemContenedorId, 90);
      const inv = await abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma);
      const out = await diagnosticarCausa(
        inv.id,
        { causa: "FABRICA_ORIGEM", responsavelTipo: "FORNECEDOR", responsavelId: "prov-1" },
        db.prisma,
      );
      expect(out.causaIdentificada).toBe("FABRICA_ORIGEM");
      expect(out.responsavelTipo).toBe("FORNECEDOR");
    });

    it("rechaza responsable incoherente con la causa", async () => {
      const s = await seed();
      await setFisica(s.itemContenedorId, 90);
      const inv = await abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma);
      await expect(
        diagnosticarCausa(
          inv.id,
          { causa: "TRANSPORTE", responsavelTipo: "SEGURADORA" },
          db.prisma,
        ),
      ).rejects.toMatchObject({ code: "CAUSA_INCOHERENTE" });
    });

    it("exige póliza cuando la causa es SINISTRO_SEGURADO", async () => {
      const s = await seed();
      await setFisica(s.itemContenedorId, 90);
      const inv = await abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma);
      await expect(
        diagnosticarCausa(
          inv.id,
          { causa: "SINISTRO_SEGURADO", responsavelTipo: "SEGURADORA" },
          db.prisma,
        ),
      ).rejects.toMatchObject({ code: "CAUSA_INCOHERENTE" });
    });
  });

  // ---- conclusión: asiento por causa-raíz ------------------------------

  describe("concluirInvestigacion — asiento por causa-raíz", () => {
    it("SOBRA → DEBE 1.1.7.04 / HABER 4.2.2.01 (físico > declarado)", async () => {
      const s = await seed();
      await setFisica(s.itemContenedorId, 105); // sobra de 5 → 50 USD → 50 000 ARS
      const inv = await abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma);
      await diagnosticarCausa(
        inv.id,
        { causa: "NAO_IDENTIFICADA", responsavelTipo: "NENHUM" },
        db.prisma,
      );
      const { asiento } = await concluirInvestigacion(inv.id, { fecha: FECHA }, db.prisma);
      expect(await lineasDe(asiento!.id)).toEqual([
        { codigo: "1.1.7.04", debe: "50000.00", haber: "0.00" },
        { codigo: "4.2.2.01", debe: "0.00", haber: "50000.00" },
      ]);
    });

    it("FALTA NAO_IDENTIFICADA → DEBE 5.1.1.02 / HABER 1.1.7.04", async () => {
      const s = await seed();
      await setFisica(s.itemContenedorId, 90); // falta 10 → 100 USD → 100 000 ARS
      const inv = await abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma);
      await diagnosticarCausa(
        inv.id,
        { causa: "NAO_IDENTIFICADA", responsavelTipo: "NENHUM" },
        db.prisma,
      );
      const { asiento } = await concluirInvestigacion(inv.id, { fecha: FECHA }, db.prisma);
      expect(await lineasDe(asiento!.id)).toEqual([
        { codigo: "5.1.1.02", debe: "100000.00", haber: "0.00" },
        { codigo: "1.1.7.04", debe: "0.00", haber: "100000.00" },
      ]);
    });

    it("FALTA FABRICA_ORIGEM → DEBE cuenta a cobrar / HABER 1.1.7.04", async () => {
      const s = await seed();
      await setFisica(s.itemContenedorId, 90);
      const inv = await abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma);
      await diagnosticarCausa(
        inv.id,
        { causa: "FABRICA_ORIGEM", responsavelTipo: "FORNECEDOR", responsavelId: "prov-1" },
        db.prisma,
      );
      const cobrarId = await cuentaPorCobrar();
      const { asiento } = await concluirInvestigacion(
        inv.id,
        { fecha: FECHA, cuentaPorCobrarId: cobrarId },
        db.prisma,
      );
      expect(await lineasDe(asiento!.id)).toEqual([
        { codigo: "1.1.2.99", debe: "100000.00", haber: "0.00" },
        { codigo: "1.1.7.04", debe: "0.00", haber: "100000.00" },
      ]);
    });

    it("FALTA SINISTRO_SEGURADO con póliza → DEBE cuenta a cobrar / HABER 1.1.7.04", async () => {
      const s = await seed();
      await setFisica(s.itemContenedorId, 90);
      const inv = await abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma);
      await diagnosticarCausa(
        inv.id,
        {
          causa: "SINISTRO_SEGURADO",
          responsavelTipo: "SEGURADORA",
          polizaSeguro: "POL-123",
        },
        db.prisma,
      );
      const cobrarId = await cuentaPorCobrar();
      const { asiento } = await concluirInvestigacion(
        inv.id,
        { fecha: FECHA, cuentaPorCobrarId: cobrarId },
        db.prisma,
      );
      const lineas = await lineasDe(asiento!.id);
      expect(lineas[0]).toEqual({ codigo: "1.1.2.99", debe: "100000.00", haber: "0.00" });
    });

    it("FALTA con responsable sin cuentaPorCobrarId → CUENTA_REQUERIDA", async () => {
      const s = await seed();
      await setFisica(s.itemContenedorId, 90);
      const inv = await abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma);
      await diagnosticarCausa(
        inv.id,
        { causa: "TRANSPORTE", responsavelTipo: "TRANSPORTADOR" },
        db.prisma,
      );
      await expect(
        concluirInvestigacion(inv.id, { fecha: FECHA }, db.prisma),
      ).rejects.toMatchObject({ code: "CUENTA_REQUERIDA" });
    });

    it("concluir sin diagnóstico → CAUSA_NO_DIAGNOSTICADA", async () => {
      const s = await seed();
      await setFisica(s.itemContenedorId, 90);
      const inv = await abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma);
      await expect(
        concluirInvestigacion(inv.id, { fecha: FECHA }, db.prisma),
      ).rejects.toMatchObject({ code: "CAUSA_NO_DIAGNOSTICADA" });
    });

    it("cierra la investigación (CONCLUIDA + asiento + contenedor DESCONSOLIDADO)", async () => {
      const s = await seed();
      await setFisica(s.itemContenedorId, 90);
      const inv = await abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma);
      await diagnosticarCausa(
        inv.id,
        { causa: "NAO_IDENTIFICADA", responsavelTipo: "NENHUM" },
        db.prisma,
      );
      const { investigacion } = await concluirInvestigacion(
        inv.id,
        { fecha: FECHA, usuarioId: 7 },
        db.prisma,
      );
      expect(investigacion.estado).toBe("CONCLUIDA");
      expect(investigacion.asientoAjusteId).toBeTruthy();
      expect(investigacion.closedAt).toBeInstanceOf(Date);
      expect(investigacion.closedBy).toBe(7);
      const cont = await db.prisma.contenedor.findUniqueOrThrow({ where: { id: s.contenedorId } });
      expect(cont.estado).toBe("DESCONSOLIDADO");
    });

    it("rechaza concluir una investigación ya concluida", async () => {
      const s = await seed();
      await setFisica(s.itemContenedorId, 90);
      const inv = await abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma);
      await diagnosticarCausa(
        inv.id,
        { causa: "NAO_IDENTIFICADA", responsavelTipo: "NENHUM" },
        db.prisma,
      );
      await concluirInvestigacion(inv.id, { fecha: FECHA }, db.prisma);
      await expect(
        concluirInvestigacion(inv.id, { fecha: FECHA }, db.prisma),
      ).rejects.toMatchObject({ code: "ESTADO_INVALIDO" });
    });

    it("multi-SKU: falta de un SKU + sobra de otro → asiento BRUTO de 4 líneas (no netea)", async () => {
      const s = await seedDosItems();
      await setFisica(s.itemA, 90); // falta 10 → 100 USD → 100 000 ARS
      await setFisica(s.itemB, 105); // sobra 5 → 50 USD → 50 000 ARS
      const inv = await abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma);
      await diagnosticarCausa(
        inv.id,
        { causa: "NAO_IDENTIFICADA", responsavelTipo: "NENHUM" },
        db.prisma,
      );
      const { asiento } = await concluirInvestigacion(inv.id, { fecha: FECHA }, db.prisma);
      // BRUTO por dirección: ingreso 50 000 y merma 100 000 NO se compensan a
      // un neto de 50 000. Stock 1.1.7.04 aparece 2× (sobra DEBE / falta HABER).
      expect(await lineasDe(asiento!.id)).toEqual([
        { codigo: "1.1.7.04", debe: "50000.00", haber: "0.00" },
        { codigo: "4.2.2.01", debe: "0.00", haber: "50000.00" },
        { codigo: "5.1.1.02", debe: "100000.00", haber: "0.00" },
        { codigo: "1.1.7.04", debe: "0.00", haber: "100000.00" },
      ]);
    });

    it("falta == sobra (neto 0) igual genera asiento (no se anulan entre SKUs)", async () => {
      const s = await seedDosItems();
      await setFisica(s.itemA, 90); // falta 10 → 100 000 ARS
      await setFisica(s.itemB, 110); // sobra 10 → 100 000 ARS (neto 0)
      const inv = await abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma);
      await diagnosticarCausa(
        inv.id,
        { causa: "NAO_IDENTIFICADA", responsavelTipo: "NENHUM" },
        db.prisma,
      );
      const { investigacion, asiento } = await concluirInvestigacion(
        inv.id,
        { fecha: FECHA },
        db.prisma,
      );
      expect(asiento).not.toBeNull();
      expect(investigacion.asientoAjusteId).toBeTruthy();
      expect(await lineasDe(asiento!.id)).toEqual([
        { codigo: "1.1.7.04", debe: "100000.00", haber: "0.00" },
        { codigo: "4.2.2.01", debe: "0.00", haber: "100000.00" },
        { codigo: "5.1.1.02", debe: "100000.00", haber: "0.00" },
        { codigo: "1.1.7.04", debe: "0.00", haber: "100000.00" },
      ]);
    });
  });

  // ---- archivar ---------------------------------------------------------

  describe("arquivarInvestigacion", () => {
    it("archiva sin asiento y libera el contenedor a DESCONSOLIDADO", async () => {
      const s = await seed();
      await setFisica(s.itemContenedorId, 90);
      const inv = await abrirInvestigacion({ desconsolidacionId: s.desconsolidacionId }, db.prisma);
      const out = await arquivarInvestigacion(
        inv.id,
        { motivo: "diferencia regularizada manualmente" },
        db.prisma,
      );
      expect(out.estado).toBe("ARQUIVADA");
      expect(out.asientoAjusteId).toBeNull();
      const cont = await db.prisma.contenedor.findUniqueOrThrow({ where: { id: s.contenedorId } });
      expect(cont.estado).toBe("DESCONSOLIDADO");
    });
  });
});

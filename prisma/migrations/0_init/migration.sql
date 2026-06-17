-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "CuentaTipo" AS ENUM ('SINTETICA', 'ANALITICA');

-- CreateEnum
CREATE TYPE "CuentaCategoria" AS ENUM ('ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'EGRESO');

-- CreateEnum
CREATE TYPE "Naturaleza" AS ENUM ('DEUDOR', 'ACREEDOR');

-- CreateEnum
CREATE TYPE "MonedaCuenta" AS ENUM ('ARS', 'USD', 'BI', 'ME');

-- CreateEnum
CREATE TYPE "PeriodoEstado" AS ENUM ('ABIERTO', 'CERRADO');

-- CreateEnum
CREATE TYPE "AsientoEstado" AS ENUM ('BORRADOR', 'CONTABILIZADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "AsientoOrigen" AS ENUM ('MANUAL', 'TESORERIA', 'COMEX', 'AJUSTE', 'GASTO');

-- CreateEnum
CREATE TYPE "TipoCuentaBancaria" AS ENUM ('CUENTA_CORRIENTE', 'CAJA_AHORRO', 'CAJA_CHICA');

-- CreateEnum
CREATE TYPE "Moneda" AS ENUM ('ARS', 'USD');

-- CreateEnum
CREATE TYPE "MovimientoTesoreriaTipo" AS ENUM ('PAGO', 'COBRO', 'TRANSFERENCIA');

-- CreateEnum
CREATE TYPE "PrestamoClasificacion" AS ENUM ('CORTO_PLAZO', 'LARGO_PLAZO');

-- CreateEnum
CREATE TYPE "EmbarqueEstado" AS ENUM ('BORRADOR', 'EN_TRANSITO', 'EN_PUERTO', 'EN_ZONA_PRIMARIA', 'EN_ADUANA', 'DESPACHADO', 'EN_DEPOSITO', 'CERRADO');

-- CreateEnum
CREATE TYPE "MomentoCosto" AS ENUM ('ZONA_PRIMARIA', 'DESPACHO');

-- CreateEnum
CREATE TYPE "DespachoEstado" AS ENUM ('BORRADOR', 'CONTABILIZADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "TipoCostoEmbarque" AS ENUM ('FLETE_INTERNACIONAL', 'FLETE_NACIONAL', 'SEGURO_MARITIMO', 'GASTOS_PORTUARIOS', 'HONORARIOS_DESPACHANTE', 'OPERADOR_LOGISTICO', 'ALMACENAJE', 'DEVOLUCION_CONTENEDOR', 'AGENTE_DE_CARGAS', 'GASTOS_LOCALES', 'GASTOS_EXTRAS');

-- CreateEnum
CREATE TYPE "Incoterm" AS ENUM ('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP');

-- CreateEnum
CREATE TYPE "PedidoEstado" AS ENUM ('BORRADOR', 'ENVIADO', 'CONFIRMADO', 'PARCIAL', 'COMPLETADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "CondicionPago" AS ENUM ('CONTADO', 'TRANSFERENCIA', 'CHEQUE', 'TARJETA', 'CUENTA_CORRIENTE', 'OTRO');

-- CreateEnum
CREATE TYPE "CompraEstado" AS ENUM ('BORRADOR', 'EMITIDA', 'RECIBIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "GastoEstado" AS ENUM ('BORRADOR', 'CONTABILIZADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "DeduccionGanancias" AS ENUM ('NETO', 'TOTAL', 'NO_DEDUCIBLE');

-- CreateEnum
CREATE TYPE "VentaEstado" AS ENUM ('BORRADOR', 'EMITIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "EntregaEstado" AS ENUM ('BORRADOR', 'CONFIRMADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "TransferenciaEstado" AS ENUM ('CONFIRMADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "MovimientoStockTipo" AS ENUM ('INGRESO', 'EGRESO', 'AJUSTE', 'TRANSFERENCIA');

-- CreateEnum
CREATE TYPE "TipoDeposito" AS ENUM ('NACIONAL', 'ZONA_PRIMARIA');

-- CreateEnum
CREATE TYPE "DepositoSubtipo" AS ENUM ('PUERTO', 'DEPOSITO_FISCAL', 'NACIONAL_DEDICADO_BONDED');

-- CreateEnum
CREATE TYPE "ContenedorEstado" AS ENUM ('BORRADOR', 'EN_TRANSITO', 'ARRIBADO_PUERTO', 'EN_ZONA_PRIMARIA', 'TRASLADO_DEPOSITO_FISCAL', 'EN_DEPOSITO_FISCAL', 'AGUARDANDO_INVESTIGACAO', 'DESCONSOLIDADO', 'PARCIALMENTE_DESPACHADO', 'TOTALMENTE_DESPACHADO', 'NACIONALIZADO_DIRECTO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "UnidadEstadoAduanero" AS ENUM ('EN_TRANSITO', 'ZPA', 'DEPOSITO_FISCAL', 'BONDED', 'EN_DESPACHO', 'NACIONALIZADA', 'BLOQUEADA', 'DIVERGENTE', 'ANULADA');

-- CreateEnum
CREATE TYPE "DivergenciaEstado" AS ENUM ('EM_ANALISE', 'CONCLUIDA', 'ARQUIVADA');

-- CreateEnum
CREATE TYPE "DivergenciaCausa" AS ENUM ('FABRICA_ORIGEM', 'TRANSPORTE', 'DEPOSITARIO', 'SINISTRO_SEGURADO', 'NAO_IDENTIFICADA');

-- CreateEnum
CREATE TYPE "DivergenciaResp" AS ENUM ('FORNECEDOR', 'TRANSPORTADOR', 'SEGURADORA', 'NENHUM');

-- CreateEnum
CREATE TYPE "VepEstado" AS ENUM ('GENERADO', 'PAGADO', 'VENCIDO');

-- CreateEnum
CREATE TYPE "CondicionIva" AS ENUM ('RI', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL', 'EXTERIOR');

-- CreateEnum
CREATE TYPE "TipoCanal" AS ENUM ('MAYORISTA', 'MINORISTA', 'REVENDEDOR_GOMERIA', 'TRANSPORTISTA', 'GRANDE_CUENTA', 'EXTERIOR', 'CONSUMIDOR_FINAL');

-- CreateEnum
CREATE TYPE "TipoProveedor" AS ENUM ('MERCADERIA_LOCAL', 'DESPACHANTE', 'LOGISTICA', 'ALMACENAJE', 'SERVICIOS_PROFESIONALES', 'ALQUILERES', 'IT_SOFTWARE', 'GASTOS_PORTUARIOS', 'MARKETING', 'OTRO', 'MERCADERIA_EXTERIOR', 'SERVICIOS_EXTERIOR');

-- CreateEnum
CREATE TYPE "ConceptoRG830" AS ENUM ('BIENES_DE_CAMBIO', 'HONORARIOS', 'ALQUILERES', 'SERVICIOS_GENERALES', 'LOCACIONES_SERVICIOS');

-- CreateEnum
CREATE TYPE "CondicionGanancias" AS ENUM ('INSCRIPTO', 'NO_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO');

-- CreateEnum
CREATE TYPE "TipoRetencion" AS ENUM ('GANANCIAS');

-- CreateEnum
CREATE TYPE "RetencionEstado" AS ENUM ('PENDIENTE_ARCA', 'PAGADA_ARCA', 'ANULADA');

-- CreateEnum
CREATE TYPE "AuditAccion" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "EmbarqueCostoEstado" AS ENUM ('BORRADOR', 'EMITIDA', 'ANULADA', 'LEGACY_BUNDLED');

-- CreateEnum
CREATE TYPE "ChequeRecibidoEstado" AS ENUM ('EN_CARTERA', 'DEPOSITADO', 'ACREDITADO', 'RECHAZADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "ImportacionExtractoStatus" AS ENUM ('PENDIENTE', 'PARCIAL', 'COMPLETADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "LineaExtractoStatus" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'IGNORADA');

-- CreateEnum
CREATE TYPE "LeadFuente" AS ENUM ('ORGANICO', 'REFERIDO', 'EVENTO', 'ANUNCIO', 'LINKEDIN', 'MERCADOLIBRE', 'FERIA', 'OTRO');

-- CreateEnum
CREATE TYPE "LeadEstado" AS ENUM ('NUEVO', 'CONTACTADO', 'CALIFICADO', 'DESCALIFICADO', 'CONVERTIDO');

-- CreateEnum
CREATE TYPE "OportunidadEstado" AS ENUM ('ABIERTA', 'GANADA', 'PERDIDA', 'EN_PAUSA');

-- CreateEnum
CREATE TYPE "ActividadTipo" AS ENUM ('LLAMADA', 'EMAIL', 'REUNION', 'NOTA', 'TAREA', 'WHATSAPP');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "monedaPreferida" "Moneda" DEFAULT 'USD',
    "modoRetroactivo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuentaContable" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "CuentaTipo" NOT NULL,
    "categoria" "CuentaCategoria" NOT NULL,
    "nivel" INTEGER NOT NULL,
    "padreCodigo" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "naturaleza" "Naturaleza",
    "moneda" "MonedaCuenta",
    "rubroEECC" TEXT,

    CONSTRAINT "CuentaContable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodoContable" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "fechaInicio" TIMESTAMP(3) NOT NULL,
    "fechaFin" TIMESTAMP(3) NOT NULL,
    "estado" "PeriodoEstado" NOT NULL DEFAULT 'ABIERTO',

    CONSTRAINT "PeriodoContable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asiento" (
    "id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "estado" "AsientoEstado" NOT NULL DEFAULT 'BORRADOR',
    "totalDebe" DECIMAL(18,2) NOT NULL,
    "totalHaber" DECIMAL(18,2) NOT NULL,
    "origen" "AsientoOrigen" NOT NULL,
    "moneda" "Moneda" NOT NULL DEFAULT 'ARS',
    "tipoCambio" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "periodoId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineaAsiento" (
    "id" SERIAL NOT NULL,
    "asientoId" TEXT NOT NULL,
    "cuentaId" INTEGER NOT NULL,
    "debe" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "haber" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "descripcion" TEXT,
    "monedaOrigen" "Moneda",
    "montoOrigen" DECIMAL(18,2),
    "tipoCambioOrigen" DECIMAL(18,6),

    CONSTRAINT "LineaAsiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AplicacionPagoEmbarqueCosto" (
    "id" SERIAL NOT NULL,
    "lineaAsientoId" INTEGER NOT NULL,
    "embarqueCostoId" INTEGER NOT NULL,
    "montoArs" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AplicacionPagoEmbarqueCosto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AplicacionPagoCompra" (
    "id" SERIAL NOT NULL,
    "lineaAsientoId" INTEGER NOT NULL,
    "compraId" TEXT NOT NULL,
    "montoArs" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AplicacionPagoCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AplicacionPagoGasto" (
    "id" SERIAL NOT NULL,
    "lineaAsientoId" INTEGER NOT NULL,
    "gastoId" TEXT NOT NULL,
    "montoArs" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AplicacionPagoGasto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuentaBancaria" (
    "id" TEXT NOT NULL,
    "banco" TEXT NOT NULL,
    "tipo" "TipoCuentaBancaria" NOT NULL,
    "moneda" "Moneda" NOT NULL,
    "numero" TEXT,
    "cbu" TEXT,
    "alias" TEXT,
    "cuentaContableId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CuentaBancaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoTesoreria" (
    "id" TEXT NOT NULL,
    "tipo" "MovimientoTesoreriaTipo" NOT NULL,
    "cuentaBancariaId" TEXT NOT NULL,
    "monto" DECIMAL(18,2) NOT NULL,
    "moneda" "Moneda" NOT NULL,
    "tipoCambio" DECIMAL(18,6) NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "fechaDestino" TIMESTAMP(3),
    "cuentaContableId" INTEGER NOT NULL,
    "asientoId" TEXT,
    "descripcion" TEXT,
    "comprobante" TEXT,
    "referenciaBanco" TEXT,
    "referenciaBancoDestino" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MovimientoTesoreria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrestamoExterno" (
    "id" TEXT NOT NULL,
    "prestamista" TEXT NOT NULL,
    "cuentaBancariaId" TEXT NOT NULL,
    "moneda" "Moneda" NOT NULL,
    "principal" DECIMAL(18,2) NOT NULL,
    "tipoCambio" DECIMAL(18,6) NOT NULL,
    "clasificacion" "PrestamoClasificacion" NOT NULL,
    "cuentaContableId" INTEGER NOT NULL,
    "asientoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrestamoExterno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Embarque" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "estado" "EmbarqueEstado" NOT NULL DEFAULT 'BORRADOR',
    "moneda" "Moneda" NOT NULL,
    "tipoCambio" DECIMAL(18,6) NOT NULL,
    "incoterm" "Incoterm",
    "lugarIncoterm" TEXT,
    "valorFleteOrigen" DECIMAL(18,2),
    "valorSeguroOrigen" DECIMAL(18,2),
    "pedidoCompraId" INTEGER,
    "nombreBuque" TEXT,
    "lineaMaritima" TEXT,
    "fechaEmpaque" TIMESTAMP(3),
    "lugarTransbordo" TEXT,
    "fechaTransbordo" TIMESTAMP(3),
    "fechaSalida" TIMESTAMP(3),
    "fechaLlegada" TIMESTAMP(3),
    "diasPagoDespuesLlegada" INTEGER,
    "fobTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cifTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "die" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tasaEstadistica" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "arancelSim" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "iva" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ivaAdicional" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ganancias" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "iibb" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "costoTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "asientoId" TEXT,
    "fechaCierre" TIMESTAMP(3),
    "asientoZonaPrimariaId" TEXT,
    "fechaZonaPrimaria" TIMESTAMP(3),
    "depositoDestinoId" TEXT,
    "depositoZonaPrimariaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Embarque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbarqueCosto" (
    "id" SERIAL NOT NULL,
    "embarqueId" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "moneda" "Moneda" NOT NULL,
    "tipoCambio" DECIMAL(18,6) NOT NULL,
    "facturaNumero" TEXT,
    "fechaFactura" TIMESTAMP(3),
    "fechaVencimiento" TIMESTAMP(3),
    "condicionPago" "CondicionPago" NOT NULL DEFAULT 'CUENTA_CORRIENTE',
    "momento" "MomentoCosto" NOT NULL DEFAULT 'DESPACHO',
    "iva" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "iibb" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otros" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notas" TEXT,
    "estado" "EmbarqueCostoEstado" NOT NULL DEFAULT 'BORRADOR',
    "asientoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "despachoId" TEXT,

    CONSTRAINT "EmbarqueCosto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbarqueCostoLinea" (
    "id" SERIAL NOT NULL,
    "embarqueCostoId" INTEGER NOT NULL,
    "tipo" "TipoCostoEmbarque" NOT NULL,
    "cuentaContableGastoId" INTEGER NOT NULL,
    "descripcion" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "EmbarqueCostoLinea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemEmbarque" (
    "id" SERIAL NOT NULL,
    "embarqueId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnitarioFob" DECIMAL(18,2) NOT NULL,
    "costoUnitario" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "ItemEmbarque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Despacho" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "embarqueId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "estado" "DespachoEstado" NOT NULL DEFAULT 'BORRADOR',
    "numeroOM" TEXT,
    "tipoCambio" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "die" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tasaEstadistica" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "arancelSim" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "iva" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ivaAdicional" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "iibb" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ganancias" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "asientoId" TEXT,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Despacho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemDespacho" (
    "id" SERIAL NOT NULL,
    "despachoId" TEXT NOT NULL,
    "itemEmbarqueId" INTEGER NOT NULL,
    "contenedorId" TEXT,
    "itemContenedorId" INTEGER,
    "cantidad" INTEGER NOT NULL,
    "costoUnitario" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "ItemDespacho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contenedor" (
    "id" TEXT NOT NULL,
    "embarqueId" TEXT NOT NULL,
    "numeroContenedor" TEXT NOT NULL,
    "tipo" TEXT,
    "numeroBL" TEXT,
    "numeroHBL" TEXT,
    "precintoOrigen" TEXT,
    "precintoPEMA" TEXT,
    "precintoCustoms" TEXT,
    "estado" "ContenedorEstado" NOT NULL DEFAULT 'BORRADOR',
    "fechaSalidaOrigen" TIMESTAMP(3),
    "fechaLlegadaPuerto" TIMESTAMP(3),
    "fechaIngresoZpa" TIMESTAMP(3),
    "fechaTrasladoDF" TIMESTAMP(3),
    "fechaDesconsolidacion" TIMESTAMP(3),
    "depositoZonaPrimariaId" TEXT,
    "depositoFiscalId" TEXT,
    "depositoDestinoId" TEXT,
    "pesoBrutoKg" DECIMAL(10,3),
    "pesoNetoKg" DECIMAL(10,3),
    "volumenM3" DECIMAL(10,3),
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contenedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemContenedor" (
    "id" SERIAL NOT NULL,
    "contenedorId" TEXT NOT NULL,
    "itemEmbarqueId" INTEGER,
    "productoId" TEXT NOT NULL,
    "cantidadDeclarada" INTEGER NOT NULL,
    "cantidadFisica" INTEGER,
    "cantidadDisponible" INTEGER NOT NULL DEFAULT 0,
    "cantidadEnDespacho" INTEGER NOT NULL DEFAULT 0,
    "cantidadDespachada" INTEGER NOT NULL DEFAULT 0,
    "costoFCUnitario" DECIMAL(18,4),
    "pesoUnitarioKg" DECIMAL(10,3),
    "ncm" TEXT,
    "paisOrigen" TEXT,
    "loteFabricacion" TEXT,
    "observaciones" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemContenedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Desconsolidacion" (
    "id" TEXT NOT NULL,
    "contenedorId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" INTEGER,
    "depositoFiscalId" TEXT,
    "cantidadDeclaradaTotal" INTEGER NOT NULL DEFAULT 0,
    "cantidadFisicaTotal" INTEGER NOT NULL DEFAULT 0,
    "documentosUrls" TEXT[],
    "fotosUrls" TEXT[],
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Desconsolidacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnidadInventario" (
    "id" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "embarqueId" TEXT NOT NULL,
    "contenedorId" TEXT NOT NULL,
    "itemContenedorId" INTEGER NOT NULL,
    "despachoId" TEXT,
    "itemDespachoId" INTEGER,
    "depositoActualId" TEXT NOT NULL,
    "statusAduanero" "UnidadEstadoAduanero" NOT NULL DEFAULT 'EN_TRANSITO',
    "costoFCUnitario" DECIMAL(18,4) NOT NULL,
    "costoLandedUnitarioFinal" DECIMAL(18,4),
    "loteFabricacion" TEXT,
    "dot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "itemEmbarqueId" INTEGER,

    CONSTRAINT "UnidadInventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "key" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "DespachoBorrador" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "embarqueId" TEXT,
    "estadoActual" TEXT NOT NULL DEFAULT 'EN_EDICION',
    "payloadDiff" JSONB NOT NULL,
    "countsTrabados" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DespachoBorrador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DivergenciaInvestigacion" (
    "id" TEXT NOT NULL,
    "desconsolidacionId" TEXT NOT NULL,
    "estado" "DivergenciaEstado" NOT NULL DEFAULT 'EM_ANALISE',
    "pesoContenedorKg" DECIMAL(10,3),
    "pesoEsperadoKg" DECIMAL(10,3),
    "lacreOrigemOk" BOOLEAN,
    "lacreOrigemObs" TEXT,
    "lacrePemaOk" BOOLEAN,
    "lacreCustomsOk" BOOLEAN,
    "gravacaoDescargaUrl" TEXT,
    "fotosUrls" TEXT[],
    "documentosUrls" TEXT[],
    "causaIdentificada" "DivergenciaCausa",
    "responsavelTipo" "DivergenciaResp",
    "responsavelId" TEXT,
    "polizaSeguro" TEXT,
    "asientoAjusteId" TEXT,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedBy" INTEGER,

    CONSTRAINT "DivergenciaInvestigacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DivergenciaItem" (
    "id" SERIAL NOT NULL,
    "divergenciaInvestigacionId" TEXT NOT NULL,
    "itemContenedorId" INTEGER NOT NULL,
    "cantidadDeclarada" INTEGER NOT NULL,
    "cantidadFisica" INTEGER NOT NULL,
    "diferenciaUnidades" INTEGER NOT NULL,
    "valorImpactadoUSD" DECIMAL(18,4) NOT NULL,
    "observacaoItem" TEXT,

    CONSTRAINT "DivergenciaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Compra" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "fechaVencimiento" TIMESTAMP(3),
    "condicionPago" "CondicionPago" NOT NULL DEFAULT 'CUENTA_CORRIENTE',
    "moneda" "Moneda" NOT NULL,
    "tipoCambio" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "iva" DECIMAL(18,2) NOT NULL,
    "iibb" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otros" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL,
    "estado" "CompraEstado" NOT NULL DEFAULT 'BORRADOR',
    "asientoId" TEXT,
    "pedidoCompraId" INTEGER,
    "depositoId" TEXT,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCompra" (
    "id" SERIAL NOT NULL,
    "compraId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" DECIMAL(18,2) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "iva" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "categoriaCuentaId" INTEGER,

    CONSTRAINT "ItemCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gasto" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "fechaVencimiento" TIMESTAMP(3),
    "condicionPago" "CondicionPago" NOT NULL DEFAULT 'CUENTA_CORRIENTE',
    "moneda" "Moneda" NOT NULL DEFAULT 'ARS',
    "tipoCambio" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "facturaNumero" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "iva" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "iibb" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otros" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deducibleGanancias" "DeduccionGanancias" NOT NULL DEFAULT 'NETO',
    "total" DECIMAL(18,2) NOT NULL,
    "estado" "GastoEstado" NOT NULL DEFAULT 'BORRADOR',
    "asientoId" TEXT,
    "ventaId" TEXT,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gasto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineaGasto" (
    "id" SERIAL NOT NULL,
    "gastoId" TEXT NOT NULL,
    "cuentaContableGastoId" INTEGER NOT NULL,
    "descripcion" TEXT NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "LineaGasto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cuit" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'minorista',
    "tipoCanal" "TipoCanal" NOT NULL DEFAULT 'MINORISTA',
    "condicionIva" "CondicionIva" NOT NULL DEFAULT 'RI',
    "agenteRetencionIva" BOOLEAN NOT NULL DEFAULT false,
    "agenteRetencionGanancias" BOOLEAN NOT NULL DEFAULT false,
    "agenteIibb" BOOLEAN NOT NULL DEFAULT false,
    "direccion" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'activo',
    "cuentaContableId" INTEGER,
    "diasPagoDefault" INTEGER,
    "condicionPagoDefault" "CondicionPago" NOT NULL DEFAULT 'CONTADO',
    "provinciaId" INTEGER,
    "localidadId" INTEGER,
    "codigoPostalId" INTEGER,
    "alicuotaPercepcionIIBB" DECIMAL(8,4),
    "exentoPercepcionIIBB" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proveedor" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cuit" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'otro',
    "tipoProveedor" "TipoProveedor" NOT NULL DEFAULT 'MERCADERIA_LOCAL',
    "conceptoRG830" "ConceptoRG830",
    "sujetoRetencionGanancias" BOOLEAN NOT NULL DEFAULT false,
    "condicionGanancias" "CondicionGanancias" NOT NULL DEFAULT 'INSCRIPTO',
    "alicuotaRetencionGananciasOverride" DECIMAL(8,4),
    "certificadoExclusionGanancias" TEXT,
    "vigenciaCertExclusionGanancias" TIMESTAMP(3),
    "pais" TEXT NOT NULL DEFAULT 'AR',
    "monedaOperacion" "Moneda" NOT NULL DEFAULT 'ARS',
    "direccion" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'activo',
    "cuentaContableId" INTEGER,
    "cuentaGastoContableId" INTEGER,
    "diasPagoDefault" INTEGER,
    "condicionPagoDefault" "CondicionPago" NOT NULL DEFAULT 'CONTADO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Producto" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "marca" TEXT,
    "modelo" TEXT,
    "medida" TEXT,
    "ncm" TEXT,
    "unidad" TEXT NOT NULL DEFAULT 'UN',
    "diePorcentaje" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "precioVenta" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "costoPromedio" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "stockActual" INTEGER NOT NULL DEFAULT 0,
    "stockMinimo" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "categoria" TEXT,
    "pesoNetoKg" DECIMAL(10,3),
    "unidadesContenedor40hc" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deposito" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "tipo" "TipoDeposito" NOT NULL DEFAULT 'NACIONAL',
    "subtipo" "DepositoSubtipo",
    "jurisdiccion" TEXT,
    "esDeTerceros" BOOLEAN NOT NULL DEFAULT false,
    "depositarioRazonSocial" TEXT,
    "depositarioCuit" TEXT,

    CONSTRAINT "Deposito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoStock" (
    "id" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "depositoId" TEXT NOT NULL,
    "tipo" "MovimientoStockTipo" NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "costoUnitario" DECIMAL(18,2) NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itemEmbarqueId" INTEGER,
    "itemDespachoId" INTEGER,
    "itemEntregaId" INTEGER,
    "transferenciaId" TEXT,
    "contenedorId" TEXT,
    "itemContenedorId" INTEGER,
    "desconsolidacionId" TEXT,
    "unidadInventarioId" TEXT,
    "itemCompraId" INTEGER,

    CONSTRAINT "MovimientoStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venta" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "fechaVencimiento" TIMESTAMP(3),
    "condicionPago" "CondicionPago" NOT NULL DEFAULT 'CUENTA_CORRIENTE',
    "moneda" "Moneda" NOT NULL,
    "tipoCambio" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "iva" DECIMAL(18,2) NOT NULL,
    "iibb" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "percepcionIIBB" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "percepcionIIBBAlicuota" DECIMAL(8,4),
    "percepcionIIBBJurisdiccionId" INTEGER,
    "otros" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "flete" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL,
    "estado" "VentaEstado" NOT NULL DEFAULT 'BORRADOR',
    "asientoId" TEXT,
    "pedidoVentaId" INTEGER,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChequeRecibido" (
    "id" SERIAL NOT NULL,
    "ventaId" TEXT,
    "numero" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'FISICO',
    "cmc7" TEXT,
    "echeqId" TEXT,
    "banco" TEXT,
    "emisor" TEXT,
    "cuitEmisor" TEXT,
    "importe" DECIMAL(18,2) NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "fechaPago" TIMESTAMP(3) NOT NULL,
    "estado" "ChequeRecibidoEstado" NOT NULL DEFAULT 'EN_CARTERA',
    "asientoCobroId" TEXT,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChequeRecibido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemVenta" (
    "id" SERIAL NOT NULL,
    "ventaId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" DECIMAL(18,4) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "iva" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "costoUnitarioCmv" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "depositoId" TEXT,

    CONSTRAINT "ItemVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockPorDeposito" (
    "id" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "depositoId" TEXT NOT NULL,
    "cantidadFisica" INTEGER NOT NULL DEFAULT 0,
    "cantidadReservada" INTEGER NOT NULL DEFAULT 0,
    "costoPromedio" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ultimoMovimiento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockPorDeposito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntregaVenta" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "ventaId" TEXT NOT NULL,
    "depositoId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "estado" "EntregaEstado" NOT NULL DEFAULT 'BORRADOR',
    "asientoId" TEXT,
    "observacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntregaVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemEntrega" (
    "id" SERIAL NOT NULL,
    "entregaId" TEXT NOT NULL,
    "itemVentaId" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "costoUnitario" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "ItemEntrega_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transferencia" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "depositoOrigenId" TEXT NOT NULL,
    "depositoDestinoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "estado" "TransferenciaEstado" NOT NULL DEFAULT 'CONFIRMADA',
    "observacion" TEXT,
    "despachoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transferencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VepDespacho" (
    "id" SERIAL NOT NULL,
    "despachoId" TEXT NOT NULL,
    "numero" TEXT,
    "fechaPago" TIMESTAMP(3),
    "montoTotal" DECIMAL(18,2) NOT NULL,
    "estado" "VepEstado" NOT NULL DEFAULT 'GENERADO',
    "movimientoTesoreriaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VepDespacho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoCompra" (
    "id" SERIAL NOT NULL,
    "numero" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "fechaPrevista" TIMESTAMP(3),
    "moneda" "Moneda" NOT NULL,
    "tipoCambio" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "estado" "PedidoEstado" NOT NULL DEFAULT 'BORRADOR',
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PedidoCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemPedidoCompra" (
    "id" SERIAL NOT NULL,
    "pedidoCompraId" INTEGER NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "ItemPedidoCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoVenta" (
    "id" SERIAL NOT NULL,
    "numero" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "fechaPrevista" TIMESTAMP(3),
    "moneda" "Moneda" NOT NULL,
    "tipoCambio" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "estado" "PedidoEstado" NOT NULL DEFAULT 'BORRADOR',
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PedidoVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemPedidoVenta" (
    "id" SERIAL NOT NULL,
    "pedidoVentaId" INTEGER NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "ItemPedidoVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JurisdiccionIIBB" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "alicuotaPercepcion" DECIMAL(8,4) NOT NULL,
    "esAgentePercepcion" BOOLEAN NOT NULL DEFAULT false,
    "provinciaId" INTEGER,

    CONSTRAINT "JurisdiccionIIBB_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provincia" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigoAfip" TEXT,

    CONSTRAINT "Provincia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Localidad" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "provinciaId" INTEGER NOT NULL,

    CONSTRAINT "Localidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodigoPostal" (
    "id" SERIAL NOT NULL,
    "cp" TEXT NOT NULL,
    "localidadId" INTEGER NOT NULL,

    CONSTRAINT "CodigoPostal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndiceIPC" (
    "id" SERIAL NOT NULL,
    "periodo" TEXT NOT NULL,
    "valor" DECIMAL(15,4) NOT NULL,
    "fuente" TEXT NOT NULL,

    CONSTRAINT "IndiceIPC_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "tabla" TEXT NOT NULL,
    "registroId" TEXT NOT NULL,
    "accion" "AuditAccion" NOT NULL,
    "datosAnteriores" JSONB,
    "datosNuevos" JSONB,
    "usuarioId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParametroRetencion" (
    "id" SERIAL NOT NULL,
    "tipo" "TipoRetencion" NOT NULL DEFAULT 'GANANCIAS',
    "regimen" TEXT NOT NULL DEFAULT 'RG_830',
    "concepto" "ConceptoRG830" NOT NULL,
    "condicion" "CondicionGanancias" NOT NULL,
    "minimoNoSujeto" DECIMAL(18,2) NOT NULL,
    "montoFijo" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "alicuota" DECIMAL(8,4) NOT NULL,
    "vigenciaDesde" TIMESTAMP(3) NOT NULL,
    "vigenciaHasta" TIMESTAMP(3),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParametroRetencion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetencionPracticada" (
    "id" TEXT NOT NULL,
    "tipo" "TipoRetencion" NOT NULL DEFAULT 'GANANCIAS',
    "regimen" TEXT NOT NULL DEFAULT 'RG_830',
    "concepto" "ConceptoRG830" NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "movimientoTesoreriaId" TEXT NOT NULL,
    "base" DECIMAL(18,2) NOT NULL,
    "baseAcumuladaMesPrevio" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "minimoNoSujeto" DECIMAL(18,2) NOT NULL,
    "alicuota" DECIMAL(8,4) NOT NULL,
    "montoFijo" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "importeRetenido" DECIMAL(18,2) NOT NULL,
    "condicionGanancias" "CondicionGanancias" NOT NULL,
    "fechaRetencion" TIMESTAMP(3) NOT NULL,
    "fechaVencimientoArca" TIMESTAMP(3) NOT NULL,
    "estado" "RetencionEstado" NOT NULL DEFAULT 'PENDIENTE_ARCA',
    "certificadoNumero" TEXT NOT NULL,
    "parametrosSnapshot" JSONB,
    "detalleCalculo" TEXT,
    "motivoAnulacion" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetencionPracticada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GastoFijo" (
    "id" SERIAL NOT NULL,
    "descripcion" TEXT NOT NULL,
    "proveedorId" TEXT NOT NULL,
    "cuentaGastoContableId" INTEGER,
    "moneda" "Moneda" NOT NULL DEFAULT 'ARS',
    "montoNeto" DECIMAL(18,2) NOT NULL,
    "ivaPorcentaje" DECIMAL(5,2) NOT NULL DEFAULT 21,
    "iibbPorcentaje" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "diaVencimiento" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GastoFijo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GastoFijoRegistro" (
    "id" SERIAL NOT NULL,
    "gastoFijoId" INTEGER NOT NULL,
    "periodoYear" INTEGER NOT NULL,
    "periodoMonth" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "tipoCambio" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "montoNeto" DECIMAL(18,2) NOT NULL,
    "iva" DECIMAL(18,2) NOT NULL,
    "iibb" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "asientoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GastoFijoRegistro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportacionExtracto" (
    "id" TEXT NOT NULL,
    "cuentaBancariaId" TEXT NOT NULL,
    "periodoYear" INTEGER NOT NULL,
    "periodoMonth" INTEGER NOT NULL,
    "saldoInicial" DECIMAL(18,2) NOT NULL,
    "saldoFinal" DECIMAL(18,2) NOT NULL,
    "archivoNombre" TEXT,
    "status" "ImportacionExtractoStatus" NOT NULL DEFAULT 'PENDIENTE',
    "totalLineas" INTEGER NOT NULL DEFAULT 0,
    "lineasAprobadas" INTEGER NOT NULL DEFAULT 0,
    "modeloIA" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportacionExtracto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineaExtractoSugerencia" (
    "id" TEXT NOT NULL,
    "importacionId" TEXT NOT NULL,
    "ordenLinea" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "comprobante" TEXT,
    "referenciaBanco" TEXT,
    "monto" DECIMAL(18,2) NOT NULL,
    "saldoExtracto" DECIMAL(18,2),
    "cuentaSugeridaId" INTEGER,
    "proveedorSugeridoId" TEXT,
    "clienteSugeridoId" TEXT,
    "descripcionAsiento" TEXT,
    "confianza" TEXT,
    "razonSugerencia" TEXT,
    "status" "LineaExtractoStatus" NOT NULL DEFAULT 'PENDIENTE',
    "movimientoId" TEXT,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineaExtractoSugerencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cotizacion" (
    "id" SERIAL NOT NULL,
    "fecha" DATE NOT NULL,
    "valor" DECIMAL(18,6) NOT NULL,
    "fuente" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cotizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "empresa" TEXT,
    "cuit" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "fuente" "LeadFuente" NOT NULL DEFAULT 'ORGANICO',
    "estado" "LeadEstado" NOT NULL DEFAULT 'NUEVO',
    "score" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT NOT NULL,
    "notas" TEXT,
    "clienteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contacto" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cargo" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "esPrincipal" BOOLEAN NOT NULL DEFAULT false,
    "leadId" TEXT,
    "clienteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contacto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "esGanada" BOOLEAN NOT NULL DEFAULT false,
    "esPerdida" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Oportunidad" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "monto" DECIMAL(18,2) NOT NULL,
    "moneda" "Moneda" NOT NULL DEFAULT 'USD',
    "stageId" TEXT NOT NULL,
    "probabilidad" INTEGER NOT NULL DEFAULT 50,
    "cierreEstimado" TIMESTAMP(3),
    "estado" "OportunidadEstado" NOT NULL DEFAULT 'ABIERTA',
    "leadId" TEXT,
    "clienteId" TEXT,
    "ownerId" TEXT NOT NULL,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Oportunidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Actividad" (
    "id" TEXT NOT NULL,
    "tipo" "ActividadTipo" NOT NULL,
    "contenido" TEXT NOT NULL,
    "fechaProgramada" TIMESTAMP(3),
    "completada" BOOLEAN NOT NULL DEFAULT false,
    "fechaCompletada" TIMESTAMP(3),
    "ownerId" TEXT NOT NULL,
    "leadId" TEXT,
    "clienteId" TEXT,
    "oportunidadId" TEXT,
    "sentimiento" DECIMAL(3,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Actividad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "asunto" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoringRule" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "campo" TEXT NOT NULL,
    "operador" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "puntos" INTEGER NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoringRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmCache" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmCache_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SimulacionImportacion" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT,
    "proveedorId" TEXT,
    "moneda" "Moneda" NOT NULL,
    "tipoCambio" DECIMAL(18,6) NOT NULL,
    "incoterm" "Incoterm",
    "lugarIncoterm" TEXT,
    "valorFleteOrigen" DECIMAL(18,2),
    "valorSeguroOrigen" DECIMAL(18,2),
    "die" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tasaEstadistica" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "arancelSim" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "iva" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ivaAdicional" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ganancias" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "iibb" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulacionImportacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemSimulacionImportacion" (
    "id" SERIAL NOT NULL,
    "simulacionId" TEXT NOT NULL,
    "productoId" TEXT,
    "descripcionLibre" TEXT,
    "cantidad" INTEGER NOT NULL,
    "precioUnitarioFob" DECIMAL(18,2) NOT NULL,
    "precioVentaUnitario" DECIMAL(18,2),

    CONSTRAINT "ItemSimulacionImportacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostoSimulacionImportacion" (
    "id" SERIAL NOT NULL,
    "simulacionId" TEXT NOT NULL,
    "tipo" "TipoCostoEmbarque" NOT NULL,
    "descripcion" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "moneda" "Moneda" NOT NULL,
    "tipoCambio" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "CostoSimulacionImportacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "CuentaContable_codigo_key" ON "CuentaContable"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "PeriodoContable_codigo_key" ON "PeriodoContable"("codigo");

-- CreateIndex
CREATE INDEX "Asiento_fecha_idx" ON "Asiento"("fecha");

-- CreateIndex
CREATE INDEX "Asiento_estado_idx" ON "Asiento"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "Asiento_periodoId_numero_key" ON "Asiento"("periodoId", "numero");

-- CreateIndex
CREATE INDEX "LineaAsiento_cuentaId_idx" ON "LineaAsiento"("cuentaId");

-- CreateIndex
CREATE INDEX "AplicacionPagoEmbarqueCosto_embarqueCostoId_idx" ON "AplicacionPagoEmbarqueCosto"("embarqueCostoId");

-- CreateIndex
CREATE INDEX "AplicacionPagoEmbarqueCosto_lineaAsientoId_idx" ON "AplicacionPagoEmbarqueCosto"("lineaAsientoId");

-- CreateIndex
CREATE UNIQUE INDEX "AplicacionPagoEmbarqueCosto_lineaAsientoId_embarqueCostoId_key" ON "AplicacionPagoEmbarqueCosto"("lineaAsientoId", "embarqueCostoId");

-- CreateIndex
CREATE INDEX "AplicacionPagoCompra_compraId_idx" ON "AplicacionPagoCompra"("compraId");

-- CreateIndex
CREATE INDEX "AplicacionPagoCompra_lineaAsientoId_idx" ON "AplicacionPagoCompra"("lineaAsientoId");

-- CreateIndex
CREATE UNIQUE INDEX "AplicacionPagoCompra_lineaAsientoId_compraId_key" ON "AplicacionPagoCompra"("lineaAsientoId", "compraId");

-- CreateIndex
CREATE INDEX "AplicacionPagoGasto_gastoId_idx" ON "AplicacionPagoGasto"("gastoId");

-- CreateIndex
CREATE INDEX "AplicacionPagoGasto_lineaAsientoId_idx" ON "AplicacionPagoGasto"("lineaAsientoId");

-- CreateIndex
CREATE UNIQUE INDEX "AplicacionPagoGasto_lineaAsientoId_gastoId_key" ON "AplicacionPagoGasto"("lineaAsientoId", "gastoId");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoTesoreria_asientoId_key" ON "MovimientoTesoreria"("asientoId");

-- CreateIndex
CREATE INDEX "MovimientoTesoreria_fecha_idx" ON "MovimientoTesoreria"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "PrestamoExterno_asientoId_key" ON "PrestamoExterno"("asientoId");

-- CreateIndex
CREATE UNIQUE INDEX "Embarque_codigo_key" ON "Embarque"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Embarque_asientoId_key" ON "Embarque"("asientoId");

-- CreateIndex
CREATE UNIQUE INDEX "Embarque_asientoZonaPrimariaId_key" ON "Embarque"("asientoZonaPrimariaId");

-- CreateIndex
CREATE UNIQUE INDEX "EmbarqueCosto_asientoId_key" ON "EmbarqueCosto"("asientoId");

-- CreateIndex
CREATE INDEX "EmbarqueCosto_embarqueId_idx" ON "EmbarqueCosto"("embarqueId");

-- CreateIndex
CREATE INDEX "EmbarqueCosto_proveedorId_idx" ON "EmbarqueCosto"("proveedorId");

-- CreateIndex
CREATE INDEX "EmbarqueCosto_fechaVencimiento_idx" ON "EmbarqueCosto"("fechaVencimiento");

-- CreateIndex
CREATE INDEX "EmbarqueCosto_despachoId_idx" ON "EmbarqueCosto"("despachoId");

-- CreateIndex
CREATE INDEX "EmbarqueCosto_estado_idx" ON "EmbarqueCosto"("estado");

-- CreateIndex
CREATE INDEX "EmbarqueCostoLinea_embarqueCostoId_idx" ON "EmbarqueCostoLinea"("embarqueCostoId");

-- CreateIndex
CREATE UNIQUE INDEX "Despacho_codigo_key" ON "Despacho"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Despacho_asientoId_key" ON "Despacho"("asientoId");

-- CreateIndex
CREATE INDEX "Despacho_embarqueId_idx" ON "Despacho"("embarqueId");

-- CreateIndex
CREATE INDEX "Despacho_estado_idx" ON "Despacho"("estado");

-- CreateIndex
CREATE INDEX "ItemDespacho_itemEmbarqueId_idx" ON "ItemDespacho"("itemEmbarqueId");

-- CreateIndex
CREATE INDEX "ItemDespacho_contenedorId_idx" ON "ItemDespacho"("contenedorId");

-- CreateIndex
CREATE INDEX "ItemDespacho_itemContenedorId_idx" ON "ItemDespacho"("itemContenedorId");

-- CreateIndex
CREATE INDEX "Contenedor_embarqueId_idx" ON "Contenedor"("embarqueId");

-- CreateIndex
CREATE INDEX "Contenedor_estado_idx" ON "Contenedor"("estado");

-- CreateIndex
CREATE INDEX "Contenedor_numeroContenedor_idx" ON "Contenedor"("numeroContenedor");

-- CreateIndex
CREATE INDEX "ItemContenedor_contenedorId_idx" ON "ItemContenedor"("contenedorId");

-- CreateIndex
CREATE INDEX "ItemContenedor_productoId_idx" ON "ItemContenedor"("productoId");

-- CreateIndex
CREATE UNIQUE INDEX "Desconsolidacion_contenedorId_key" ON "Desconsolidacion"("contenedorId");

-- CreateIndex
CREATE INDEX "Desconsolidacion_contenedorId_idx" ON "Desconsolidacion"("contenedorId");

-- CreateIndex
CREATE INDEX "UnidadInventario_productoId_statusAduanero_depositoActualId_idx" ON "UnidadInventario"("productoId", "statusAduanero", "depositoActualId");

-- CreateIndex
CREATE INDEX "UnidadInventario_contenedorId_idx" ON "UnidadInventario"("contenedorId");

-- CreateIndex
CREATE INDEX "UnidadInventario_itemContenedorId_idx" ON "UnidadInventario"("itemContenedorId");

-- CreateIndex
CREATE INDEX "UnidadInventario_despachoId_idx" ON "UnidadInventario"("despachoId");

-- CreateIndex
CREATE INDEX "UnidadInventario_itemDespachoId_idx" ON "UnidadInventario"("itemDespachoId");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateIndex
CREATE INDEX "DespachoBorrador_userId_expiresAt_idx" ON "DespachoBorrador"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "DespachoBorrador_estadoActual_expiresAt_idx" ON "DespachoBorrador"("estadoActual", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DivergenciaInvestigacion_desconsolidacionId_key" ON "DivergenciaInvestigacion"("desconsolidacionId");

-- CreateIndex
CREATE UNIQUE INDEX "DivergenciaInvestigacion_asientoAjusteId_key" ON "DivergenciaInvestigacion"("asientoAjusteId");

-- CreateIndex
CREATE INDEX "DivergenciaInvestigacion_estado_idx" ON "DivergenciaInvestigacion"("estado");

-- CreateIndex
CREATE INDEX "DivergenciaItem_divergenciaInvestigacionId_idx" ON "DivergenciaItem"("divergenciaInvestigacionId");

-- CreateIndex
CREATE INDEX "DivergenciaItem_itemContenedorId_idx" ON "DivergenciaItem"("itemContenedorId");

-- CreateIndex
CREATE UNIQUE INDEX "Compra_numero_key" ON "Compra"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "Compra_asientoId_key" ON "Compra"("asientoId");

-- CreateIndex
CREATE INDEX "Compra_fechaVencimiento_idx" ON "Compra"("fechaVencimiento");

-- CreateIndex
CREATE INDEX "Compra_proveedorId_idx" ON "Compra"("proveedorId");

-- CreateIndex
CREATE INDEX "Compra_depositoId_idx" ON "Compra"("depositoId");

-- CreateIndex
CREATE INDEX "ItemCompra_categoriaCuentaId_idx" ON "ItemCompra"("categoriaCuentaId");

-- CreateIndex
CREATE UNIQUE INDEX "Gasto_numero_key" ON "Gasto"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "Gasto_asientoId_key" ON "Gasto"("asientoId");

-- CreateIndex
CREATE UNIQUE INDEX "Gasto_ventaId_key" ON "Gasto"("ventaId");

-- CreateIndex
CREATE INDEX "Gasto_proveedorId_idx" ON "Gasto"("proveedorId");

-- CreateIndex
CREATE INDEX "Gasto_fecha_idx" ON "Gasto"("fecha");

-- CreateIndex
CREATE INDEX "Gasto_fechaVencimiento_idx" ON "Gasto"("fechaVencimiento");

-- CreateIndex
CREATE INDEX "Gasto_estado_idx" ON "Gasto"("estado");

-- CreateIndex
CREATE INDEX "LineaGasto_gastoId_idx" ON "LineaGasto"("gastoId");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_cuit_key" ON "Cliente"("cuit");

-- CreateIndex
CREATE INDEX "Cliente_provinciaId_idx" ON "Cliente"("provinciaId");

-- CreateIndex
CREATE INDEX "Cliente_localidadId_idx" ON "Cliente"("localidadId");

-- CreateIndex
CREATE UNIQUE INDEX "Proveedor_cuit_key" ON "Proveedor"("cuit");

-- CreateIndex
CREATE UNIQUE INDEX "Producto_codigo_key" ON "Producto"("codigo");

-- CreateIndex
CREATE INDEX "MovimientoStock_productoId_idx" ON "MovimientoStock"("productoId");

-- CreateIndex
CREATE INDEX "MovimientoStock_itemEmbarqueId_idx" ON "MovimientoStock"("itemEmbarqueId");

-- CreateIndex
CREATE INDEX "MovimientoStock_itemDespachoId_idx" ON "MovimientoStock"("itemDespachoId");

-- CreateIndex
CREATE INDEX "MovimientoStock_itemEntregaId_idx" ON "MovimientoStock"("itemEntregaId");

-- CreateIndex
CREATE INDEX "MovimientoStock_transferenciaId_idx" ON "MovimientoStock"("transferenciaId");

-- CreateIndex
CREATE INDEX "MovimientoStock_contenedorId_idx" ON "MovimientoStock"("contenedorId");

-- CreateIndex
CREATE INDEX "MovimientoStock_itemContenedorId_idx" ON "MovimientoStock"("itemContenedorId");

-- CreateIndex
CREATE INDEX "MovimientoStock_desconsolidacionId_idx" ON "MovimientoStock"("desconsolidacionId");

-- CreateIndex
CREATE INDEX "MovimientoStock_unidadInventarioId_idx" ON "MovimientoStock"("unidadInventarioId");

-- CreateIndex
CREATE INDEX "MovimientoStock_itemCompraId_idx" ON "MovimientoStock"("itemCompraId");

-- CreateIndex
CREATE UNIQUE INDEX "Venta_numero_key" ON "Venta"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "Venta_asientoId_key" ON "Venta"("asientoId");

-- CreateIndex
CREATE INDEX "Venta_fechaVencimiento_idx" ON "Venta"("fechaVencimiento");

-- CreateIndex
CREATE INDEX "Venta_clienteId_idx" ON "Venta"("clienteId");

-- CreateIndex
CREATE INDEX "Venta_percepcionIIBBJurisdiccionId_idx" ON "Venta"("percepcionIIBBJurisdiccionId");

-- CreateIndex
CREATE UNIQUE INDEX "ChequeRecibido_asientoCobroId_key" ON "ChequeRecibido"("asientoCobroId");

-- CreateIndex
CREATE INDEX "ChequeRecibido_ventaId_idx" ON "ChequeRecibido"("ventaId");

-- CreateIndex
CREATE INDEX "ChequeRecibido_estado_idx" ON "ChequeRecibido"("estado");

-- CreateIndex
CREATE INDEX "ChequeRecibido_fechaPago_idx" ON "ChequeRecibido"("fechaPago");

-- CreateIndex
CREATE INDEX "ItemVenta_depositoId_idx" ON "ItemVenta"("depositoId");

-- CreateIndex
CREATE INDEX "StockPorDeposito_depositoId_idx" ON "StockPorDeposito"("depositoId");

-- CreateIndex
CREATE UNIQUE INDEX "StockPorDeposito_productoId_depositoId_key" ON "StockPorDeposito"("productoId", "depositoId");

-- CreateIndex
CREATE UNIQUE INDEX "EntregaVenta_numero_key" ON "EntregaVenta"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "EntregaVenta_asientoId_key" ON "EntregaVenta"("asientoId");

-- CreateIndex
CREATE INDEX "EntregaVenta_ventaId_idx" ON "EntregaVenta"("ventaId");

-- CreateIndex
CREATE INDEX "EntregaVenta_estado_idx" ON "EntregaVenta"("estado");

-- CreateIndex
CREATE INDEX "ItemEntrega_itemVentaId_idx" ON "ItemEntrega"("itemVentaId");

-- CreateIndex
CREATE UNIQUE INDEX "Transferencia_numero_key" ON "Transferencia"("numero");

-- CreateIndex
CREATE INDEX "Transferencia_productoId_idx" ON "Transferencia"("productoId");

-- CreateIndex
CREATE INDEX "Transferencia_fecha_idx" ON "Transferencia"("fecha");

-- CreateIndex
CREATE INDEX "Transferencia_despachoId_idx" ON "Transferencia"("despachoId");

-- CreateIndex
CREATE UNIQUE INDEX "VepDespacho_despachoId_key" ON "VepDespacho"("despachoId");

-- CreateIndex
CREATE UNIQUE INDEX "VepDespacho_movimientoTesoreriaId_key" ON "VepDespacho"("movimientoTesoreriaId");

-- CreateIndex
CREATE INDEX "VepDespacho_estado_idx" ON "VepDespacho"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "PedidoCompra_numero_key" ON "PedidoCompra"("numero");

-- CreateIndex
CREATE INDEX "PedidoCompra_proveedorId_idx" ON "PedidoCompra"("proveedorId");

-- CreateIndex
CREATE INDEX "PedidoCompra_estado_idx" ON "PedidoCompra"("estado");

-- CreateIndex
CREATE INDEX "ItemPedidoCompra_pedidoCompraId_idx" ON "ItemPedidoCompra"("pedidoCompraId");

-- CreateIndex
CREATE UNIQUE INDEX "PedidoVenta_numero_key" ON "PedidoVenta"("numero");

-- CreateIndex
CREATE INDEX "PedidoVenta_clienteId_idx" ON "PedidoVenta"("clienteId");

-- CreateIndex
CREATE INDEX "PedidoVenta_estado_idx" ON "PedidoVenta"("estado");

-- CreateIndex
CREATE INDEX "ItemPedidoVenta_pedidoVentaId_idx" ON "ItemPedidoVenta"("pedidoVentaId");

-- CreateIndex
CREATE UNIQUE INDEX "JurisdiccionIIBB_codigo_key" ON "JurisdiccionIIBB"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "JurisdiccionIIBB_provinciaId_key" ON "JurisdiccionIIBB"("provinciaId");

-- CreateIndex
CREATE UNIQUE INDEX "Provincia_codigo_key" ON "Provincia"("codigo");

-- CreateIndex
CREATE INDEX "Localidad_provinciaId_idx" ON "Localidad"("provinciaId");

-- CreateIndex
CREATE UNIQUE INDEX "Localidad_provinciaId_nombre_key" ON "Localidad"("provinciaId", "nombre");

-- CreateIndex
CREATE INDEX "CodigoPostal_localidadId_idx" ON "CodigoPostal"("localidadId");

-- CreateIndex
CREATE UNIQUE INDEX "CodigoPostal_localidadId_cp_key" ON "CodigoPostal"("localidadId", "cp");

-- CreateIndex
CREATE UNIQUE INDEX "IndiceIPC_periodo_key" ON "IndiceIPC"("periodo");

-- CreateIndex
CREATE INDEX "AuditLog_usuarioId_idx" ON "AuditLog"("usuarioId");

-- CreateIndex
CREATE INDEX "AuditLog_tabla_registroId_idx" ON "AuditLog"("tabla", "registroId");

-- CreateIndex
CREATE INDEX "ParametroRetencion_tipo_concepto_condicion_activo_idx" ON "ParametroRetencion"("tipo", "concepto", "condicion", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "ParametroRetencion_tipo_concepto_condicion_vigenciaDesde_key" ON "ParametroRetencion"("tipo", "concepto", "condicion", "vigenciaDesde");

-- CreateIndex
CREATE UNIQUE INDEX "RetencionPracticada_movimientoTesoreriaId_key" ON "RetencionPracticada"("movimientoTesoreriaId");

-- CreateIndex
CREATE UNIQUE INDEX "RetencionPracticada_certificadoNumero_key" ON "RetencionPracticada"("certificadoNumero");

-- CreateIndex
CREATE INDEX "RetencionPracticada_proveedorId_fechaRetencion_idx" ON "RetencionPracticada"("proveedorId", "fechaRetencion");

-- CreateIndex
CREATE INDEX "RetencionPracticada_estado_idx" ON "RetencionPracticada"("estado");

-- CreateIndex
CREATE INDEX "RetencionPracticada_concepto_fechaRetencion_idx" ON "RetencionPracticada"("concepto", "fechaRetencion");

-- CreateIndex
CREATE INDEX "GastoFijo_proveedorId_idx" ON "GastoFijo"("proveedorId");

-- CreateIndex
CREATE INDEX "GastoFijo_activo_idx" ON "GastoFijo"("activo");

-- CreateIndex
CREATE UNIQUE INDEX "GastoFijoRegistro_asientoId_key" ON "GastoFijoRegistro"("asientoId");

-- CreateIndex
CREATE INDEX "GastoFijoRegistro_periodoYear_periodoMonth_idx" ON "GastoFijoRegistro"("periodoYear", "periodoMonth");

-- CreateIndex
CREATE UNIQUE INDEX "GastoFijoRegistro_gastoFijoId_periodoYear_periodoMonth_key" ON "GastoFijoRegistro"("gastoFijoId", "periodoYear", "periodoMonth");

-- CreateIndex
CREATE INDEX "ImportacionExtracto_status_idx" ON "ImportacionExtracto"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportacionExtracto_cuentaBancariaId_periodoYear_periodoMon_key" ON "ImportacionExtracto"("cuentaBancariaId", "periodoYear", "periodoMonth");

-- CreateIndex
CREATE UNIQUE INDEX "LineaExtractoSugerencia_movimientoId_key" ON "LineaExtractoSugerencia"("movimientoId");

-- CreateIndex
CREATE INDEX "LineaExtractoSugerencia_importacionId_ordenLinea_idx" ON "LineaExtractoSugerencia"("importacionId", "ordenLinea");

-- CreateIndex
CREATE INDEX "LineaExtractoSugerencia_status_idx" ON "LineaExtractoSugerencia"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Cotizacion_fecha_key" ON "Cotizacion"("fecha");

-- CreateIndex
CREATE INDEX "Cotizacion_fecha_idx" ON "Cotizacion"("fecha");

-- CreateIndex
CREATE INDEX "Lead_ownerId_idx" ON "Lead"("ownerId");

-- CreateIndex
CREATE INDEX "Lead_estado_idx" ON "Lead"("estado");

-- CreateIndex
CREATE INDEX "Lead_clienteId_idx" ON "Lead"("clienteId");

-- CreateIndex
CREATE INDEX "Contacto_leadId_idx" ON "Contacto"("leadId");

-- CreateIndex
CREATE INDEX "Contacto_clienteId_idx" ON "Contacto"("clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_orden_key" ON "PipelineStage"("orden");

-- CreateIndex
CREATE UNIQUE INDEX "Oportunidad_numero_key" ON "Oportunidad"("numero");

-- CreateIndex
CREATE INDEX "Oportunidad_stageId_idx" ON "Oportunidad"("stageId");

-- CreateIndex
CREATE INDEX "Oportunidad_ownerId_idx" ON "Oportunidad"("ownerId");

-- CreateIndex
CREATE INDEX "Oportunidad_estado_idx" ON "Oportunidad"("estado");

-- CreateIndex
CREATE INDEX "Oportunidad_leadId_idx" ON "Oportunidad"("leadId");

-- CreateIndex
CREATE INDEX "Oportunidad_clienteId_idx" ON "Oportunidad"("clienteId");

-- CreateIndex
CREATE INDEX "Actividad_ownerId_completada_idx" ON "Actividad"("ownerId", "completada");

-- CreateIndex
CREATE INDEX "Actividad_leadId_idx" ON "Actividad"("leadId");

-- CreateIndex
CREATE INDEX "Actividad_clienteId_idx" ON "Actividad"("clienteId");

-- CreateIndex
CREATE INDEX "Actividad_oportunidadId_idx" ON "Actividad"("oportunidadId");

-- CreateIndex
CREATE INDEX "LlmCache_scope_expiresAt_idx" ON "LlmCache"("scope", "expiresAt");

-- CreateIndex
CREATE INDEX "LlmCache_expiresAt_idx" ON "LlmCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SimulacionImportacion_codigo_key" ON "SimulacionImportacion"("codigo");

-- CreateIndex
CREATE INDEX "SimulacionImportacion_proveedorId_idx" ON "SimulacionImportacion"("proveedorId");

-- CreateIndex
CREATE INDEX "SimulacionImportacion_createdAt_idx" ON "SimulacionImportacion"("createdAt");

-- CreateIndex
CREATE INDEX "ItemSimulacionImportacion_simulacionId_idx" ON "ItemSimulacionImportacion"("simulacionId");

-- CreateIndex
CREATE INDEX "CostoSimulacionImportacion_simulacionId_idx" ON "CostoSimulacionImportacion"("simulacionId");

-- AddForeignKey
ALTER TABLE "CuentaContable" ADD CONSTRAINT "CuentaContable_padreCodigo_fkey" FOREIGN KEY ("padreCodigo") REFERENCES "CuentaContable"("codigo") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asiento" ADD CONSTRAINT "Asiento_periodoId_fkey" FOREIGN KEY ("periodoId") REFERENCES "PeriodoContable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineaAsiento" ADD CONSTRAINT "LineaAsiento_asientoId_fkey" FOREIGN KEY ("asientoId") REFERENCES "Asiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineaAsiento" ADD CONSTRAINT "LineaAsiento_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "CuentaContable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AplicacionPagoEmbarqueCosto" ADD CONSTRAINT "AplicacionPagoEmbarqueCosto_lineaAsientoId_fkey" FOREIGN KEY ("lineaAsientoId") REFERENCES "LineaAsiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AplicacionPagoEmbarqueCosto" ADD CONSTRAINT "AplicacionPagoEmbarqueCosto_embarqueCostoId_fkey" FOREIGN KEY ("embarqueCostoId") REFERENCES "EmbarqueCosto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AplicacionPagoCompra" ADD CONSTRAINT "AplicacionPagoCompra_lineaAsientoId_fkey" FOREIGN KEY ("lineaAsientoId") REFERENCES "LineaAsiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AplicacionPagoCompra" ADD CONSTRAINT "AplicacionPagoCompra_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "Compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AplicacionPagoGasto" ADD CONSTRAINT "AplicacionPagoGasto_lineaAsientoId_fkey" FOREIGN KEY ("lineaAsientoId") REFERENCES "LineaAsiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AplicacionPagoGasto" ADD CONSTRAINT "AplicacionPagoGasto_gastoId_fkey" FOREIGN KEY ("gastoId") REFERENCES "Gasto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuentaBancaria" ADD CONSTRAINT "CuentaBancaria_cuentaContableId_fkey" FOREIGN KEY ("cuentaContableId") REFERENCES "CuentaContable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoTesoreria" ADD CONSTRAINT "MovimientoTesoreria_cuentaBancariaId_fkey" FOREIGN KEY ("cuentaBancariaId") REFERENCES "CuentaBancaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoTesoreria" ADD CONSTRAINT "MovimientoTesoreria_cuentaContableId_fkey" FOREIGN KEY ("cuentaContableId") REFERENCES "CuentaContable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoTesoreria" ADD CONSTRAINT "MovimientoTesoreria_asientoId_fkey" FOREIGN KEY ("asientoId") REFERENCES "Asiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrestamoExterno" ADD CONSTRAINT "PrestamoExterno_cuentaBancariaId_fkey" FOREIGN KEY ("cuentaBancariaId") REFERENCES "CuentaBancaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrestamoExterno" ADD CONSTRAINT "PrestamoExterno_cuentaContableId_fkey" FOREIGN KEY ("cuentaContableId") REFERENCES "CuentaContable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrestamoExterno" ADD CONSTRAINT "PrestamoExterno_asientoId_fkey" FOREIGN KEY ("asientoId") REFERENCES "Asiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embarque" ADD CONSTRAINT "Embarque_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embarque" ADD CONSTRAINT "Embarque_asientoId_fkey" FOREIGN KEY ("asientoId") REFERENCES "Asiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embarque" ADD CONSTRAINT "Embarque_asientoZonaPrimariaId_fkey" FOREIGN KEY ("asientoZonaPrimariaId") REFERENCES "Asiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embarque" ADD CONSTRAINT "Embarque_depositoDestinoId_fkey" FOREIGN KEY ("depositoDestinoId") REFERENCES "Deposito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embarque" ADD CONSTRAINT "Embarque_depositoZonaPrimariaId_fkey" FOREIGN KEY ("depositoZonaPrimariaId") REFERENCES "Deposito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embarque" ADD CONSTRAINT "Embarque_pedidoCompraId_fkey" FOREIGN KEY ("pedidoCompraId") REFERENCES "PedidoCompra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbarqueCosto" ADD CONSTRAINT "EmbarqueCosto_embarqueId_fkey" FOREIGN KEY ("embarqueId") REFERENCES "Embarque"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbarqueCosto" ADD CONSTRAINT "EmbarqueCosto_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbarqueCosto" ADD CONSTRAINT "EmbarqueCosto_despachoId_fkey" FOREIGN KEY ("despachoId") REFERENCES "Despacho"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbarqueCosto" ADD CONSTRAINT "EmbarqueCosto_asientoId_fkey" FOREIGN KEY ("asientoId") REFERENCES "Asiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbarqueCostoLinea" ADD CONSTRAINT "EmbarqueCostoLinea_embarqueCostoId_fkey" FOREIGN KEY ("embarqueCostoId") REFERENCES "EmbarqueCosto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbarqueCostoLinea" ADD CONSTRAINT "EmbarqueCostoLinea_cuentaContableGastoId_fkey" FOREIGN KEY ("cuentaContableGastoId") REFERENCES "CuentaContable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemEmbarque" ADD CONSTRAINT "ItemEmbarque_embarqueId_fkey" FOREIGN KEY ("embarqueId") REFERENCES "Embarque"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemEmbarque" ADD CONSTRAINT "ItemEmbarque_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Despacho" ADD CONSTRAINT "Despacho_embarqueId_fkey" FOREIGN KEY ("embarqueId") REFERENCES "Embarque"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Despacho" ADD CONSTRAINT "Despacho_asientoId_fkey" FOREIGN KEY ("asientoId") REFERENCES "Asiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemDespacho" ADD CONSTRAINT "ItemDespacho_despachoId_fkey" FOREIGN KEY ("despachoId") REFERENCES "Despacho"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemDespacho" ADD CONSTRAINT "ItemDespacho_itemEmbarqueId_fkey" FOREIGN KEY ("itemEmbarqueId") REFERENCES "ItemEmbarque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemDespacho" ADD CONSTRAINT "ItemDespacho_contenedorId_fkey" FOREIGN KEY ("contenedorId") REFERENCES "Contenedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemDespacho" ADD CONSTRAINT "ItemDespacho_itemContenedorId_fkey" FOREIGN KEY ("itemContenedorId") REFERENCES "ItemContenedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contenedor" ADD CONSTRAINT "Contenedor_embarqueId_fkey" FOREIGN KEY ("embarqueId") REFERENCES "Embarque"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contenedor" ADD CONSTRAINT "Contenedor_depositoZonaPrimariaId_fkey" FOREIGN KEY ("depositoZonaPrimariaId") REFERENCES "Deposito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contenedor" ADD CONSTRAINT "Contenedor_depositoFiscalId_fkey" FOREIGN KEY ("depositoFiscalId") REFERENCES "Deposito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contenedor" ADD CONSTRAINT "Contenedor_depositoDestinoId_fkey" FOREIGN KEY ("depositoDestinoId") REFERENCES "Deposito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemContenedor" ADD CONSTRAINT "ItemContenedor_contenedorId_fkey" FOREIGN KEY ("contenedorId") REFERENCES "Contenedor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemContenedor" ADD CONSTRAINT "ItemContenedor_itemEmbarqueId_fkey" FOREIGN KEY ("itemEmbarqueId") REFERENCES "ItemEmbarque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemContenedor" ADD CONSTRAINT "ItemContenedor_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Desconsolidacion" ADD CONSTRAINT "Desconsolidacion_contenedorId_fkey" FOREIGN KEY ("contenedorId") REFERENCES "Contenedor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Desconsolidacion" ADD CONSTRAINT "Desconsolidacion_depositoFiscalId_fkey" FOREIGN KEY ("depositoFiscalId") REFERENCES "Deposito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnidadInventario" ADD CONSTRAINT "UnidadInventario_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnidadInventario" ADD CONSTRAINT "UnidadInventario_embarqueId_fkey" FOREIGN KEY ("embarqueId") REFERENCES "Embarque"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnidadInventario" ADD CONSTRAINT "UnidadInventario_contenedorId_fkey" FOREIGN KEY ("contenedorId") REFERENCES "Contenedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnidadInventario" ADD CONSTRAINT "UnidadInventario_itemContenedorId_fkey" FOREIGN KEY ("itemContenedorId") REFERENCES "ItemContenedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnidadInventario" ADD CONSTRAINT "UnidadInventario_despachoId_fkey" FOREIGN KEY ("despachoId") REFERENCES "Despacho"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnidadInventario" ADD CONSTRAINT "UnidadInventario_itemDespachoId_fkey" FOREIGN KEY ("itemDespachoId") REFERENCES "ItemDespacho"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnidadInventario" ADD CONSTRAINT "UnidadInventario_depositoActualId_fkey" FOREIGN KEY ("depositoActualId") REFERENCES "Deposito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnidadInventario" ADD CONSTRAINT "UnidadInventario_itemEmbarqueId_fkey" FOREIGN KEY ("itemEmbarqueId") REFERENCES "ItemEmbarque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivergenciaInvestigacion" ADD CONSTRAINT "DivergenciaInvestigacion_desconsolidacionId_fkey" FOREIGN KEY ("desconsolidacionId") REFERENCES "Desconsolidacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivergenciaInvestigacion" ADD CONSTRAINT "DivergenciaInvestigacion_asientoAjusteId_fkey" FOREIGN KEY ("asientoAjusteId") REFERENCES "Asiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivergenciaItem" ADD CONSTRAINT "DivergenciaItem_divergenciaInvestigacionId_fkey" FOREIGN KEY ("divergenciaInvestigacionId") REFERENCES "DivergenciaInvestigacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivergenciaItem" ADD CONSTRAINT "DivergenciaItem_itemContenedorId_fkey" FOREIGN KEY ("itemContenedorId") REFERENCES "ItemContenedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_asientoId_fkey" FOREIGN KEY ("asientoId") REFERENCES "Asiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_pedidoCompraId_fkey" FOREIGN KEY ("pedidoCompraId") REFERENCES "PedidoCompra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCompra" ADD CONSTRAINT "ItemCompra_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "Compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCompra" ADD CONSTRAINT "ItemCompra_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemCompra" ADD CONSTRAINT "ItemCompra_categoriaCuentaId_fkey" FOREIGN KEY ("categoriaCuentaId") REFERENCES "CuentaContable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_asientoId_fkey" FOREIGN KEY ("asientoId") REFERENCES "Asiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineaGasto" ADD CONSTRAINT "LineaGasto_gastoId_fkey" FOREIGN KEY ("gastoId") REFERENCES "Gasto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineaGasto" ADD CONSTRAINT "LineaGasto_cuentaContableGastoId_fkey" FOREIGN KEY ("cuentaContableGastoId") REFERENCES "CuentaContable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_cuentaContableId_fkey" FOREIGN KEY ("cuentaContableId") REFERENCES "CuentaContable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_provinciaId_fkey" FOREIGN KEY ("provinciaId") REFERENCES "Provincia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_localidadId_fkey" FOREIGN KEY ("localidadId") REFERENCES "Localidad"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_codigoPostalId_fkey" FOREIGN KEY ("codigoPostalId") REFERENCES "CodigoPostal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proveedor" ADD CONSTRAINT "Proveedor_cuentaContableId_fkey" FOREIGN KEY ("cuentaContableId") REFERENCES "CuentaContable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proveedor" ADD CONSTRAINT "Proveedor_cuentaGastoContableId_fkey" FOREIGN KEY ("cuentaGastoContableId") REFERENCES "CuentaContable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_itemEmbarqueId_fkey" FOREIGN KEY ("itemEmbarqueId") REFERENCES "ItemEmbarque"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_itemDespachoId_fkey" FOREIGN KEY ("itemDespachoId") REFERENCES "ItemDespacho"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_itemEntregaId_fkey" FOREIGN KEY ("itemEntregaId") REFERENCES "ItemEntrega"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_transferenciaId_fkey" FOREIGN KEY ("transferenciaId") REFERENCES "Transferencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_contenedorId_fkey" FOREIGN KEY ("contenedorId") REFERENCES "Contenedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_itemContenedorId_fkey" FOREIGN KEY ("itemContenedorId") REFERENCES "ItemContenedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_desconsolidacionId_fkey" FOREIGN KEY ("desconsolidacionId") REFERENCES "Desconsolidacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_unidadInventarioId_fkey" FOREIGN KEY ("unidadInventarioId") REFERENCES "UnidadInventario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_itemCompraId_fkey" FOREIGN KEY ("itemCompraId") REFERENCES "ItemCompra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_asientoId_fkey" FOREIGN KEY ("asientoId") REFERENCES "Asiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_pedidoVentaId_fkey" FOREIGN KEY ("pedidoVentaId") REFERENCES "PedidoVenta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_percepcionIIBBJurisdiccionId_fkey" FOREIGN KEY ("percepcionIIBBJurisdiccionId") REFERENCES "JurisdiccionIIBB"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChequeRecibido" ADD CONSTRAINT "ChequeRecibido_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChequeRecibido" ADD CONSTRAINT "ChequeRecibido_asientoCobroId_fkey" FOREIGN KEY ("asientoCobroId") REFERENCES "Asiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemVenta" ADD CONSTRAINT "ItemVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemVenta" ADD CONSTRAINT "ItemVenta_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemVenta" ADD CONSTRAINT "ItemVenta_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPorDeposito" ADD CONSTRAINT "StockPorDeposito_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPorDeposito" ADD CONSTRAINT "StockPorDeposito_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntregaVenta" ADD CONSTRAINT "EntregaVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntregaVenta" ADD CONSTRAINT "EntregaVenta_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "Deposito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntregaVenta" ADD CONSTRAINT "EntregaVenta_asientoId_fkey" FOREIGN KEY ("asientoId") REFERENCES "Asiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemEntrega" ADD CONSTRAINT "ItemEntrega_entregaId_fkey" FOREIGN KEY ("entregaId") REFERENCES "EntregaVenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemEntrega" ADD CONSTRAINT "ItemEntrega_itemVentaId_fkey" FOREIGN KEY ("itemVentaId") REFERENCES "ItemVenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transferencia" ADD CONSTRAINT "Transferencia_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transferencia" ADD CONSTRAINT "Transferencia_depositoOrigenId_fkey" FOREIGN KEY ("depositoOrigenId") REFERENCES "Deposito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transferencia" ADD CONSTRAINT "Transferencia_depositoDestinoId_fkey" FOREIGN KEY ("depositoDestinoId") REFERENCES "Deposito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transferencia" ADD CONSTRAINT "Transferencia_despachoId_fkey" FOREIGN KEY ("despachoId") REFERENCES "Despacho"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VepDespacho" ADD CONSTRAINT "VepDespacho_despachoId_fkey" FOREIGN KEY ("despachoId") REFERENCES "Despacho"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VepDespacho" ADD CONSTRAINT "VepDespacho_movimientoTesoreriaId_fkey" FOREIGN KEY ("movimientoTesoreriaId") REFERENCES "MovimientoTesoreria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoCompra" ADD CONSTRAINT "PedidoCompra_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPedidoCompra" ADD CONSTRAINT "ItemPedidoCompra_pedidoCompraId_fkey" FOREIGN KEY ("pedidoCompraId") REFERENCES "PedidoCompra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPedidoCompra" ADD CONSTRAINT "ItemPedidoCompra_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoVenta" ADD CONSTRAINT "PedidoVenta_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPedidoVenta" ADD CONSTRAINT "ItemPedidoVenta_pedidoVentaId_fkey" FOREIGN KEY ("pedidoVentaId") REFERENCES "PedidoVenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemPedidoVenta" ADD CONSTRAINT "ItemPedidoVenta_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JurisdiccionIIBB" ADD CONSTRAINT "JurisdiccionIIBB_provinciaId_fkey" FOREIGN KEY ("provinciaId") REFERENCES "Provincia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Localidad" ADD CONSTRAINT "Localidad_provinciaId_fkey" FOREIGN KEY ("provinciaId") REFERENCES "Provincia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodigoPostal" ADD CONSTRAINT "CodigoPostal_localidadId_fkey" FOREIGN KEY ("localidadId") REFERENCES "Localidad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetencionPracticada" ADD CONSTRAINT "RetencionPracticada_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetencionPracticada" ADD CONSTRAINT "RetencionPracticada_movimientoTesoreriaId_fkey" FOREIGN KEY ("movimientoTesoreriaId") REFERENCES "MovimientoTesoreria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetencionPracticada" ADD CONSTRAINT "RetencionPracticada_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GastoFijo" ADD CONSTRAINT "GastoFijo_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GastoFijo" ADD CONSTRAINT "GastoFijo_cuentaGastoContableId_fkey" FOREIGN KEY ("cuentaGastoContableId") REFERENCES "CuentaContable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GastoFijoRegistro" ADD CONSTRAINT "GastoFijoRegistro_gastoFijoId_fkey" FOREIGN KEY ("gastoFijoId") REFERENCES "GastoFijo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GastoFijoRegistro" ADD CONSTRAINT "GastoFijoRegistro_asientoId_fkey" FOREIGN KEY ("asientoId") REFERENCES "Asiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportacionExtracto" ADD CONSTRAINT "ImportacionExtracto_cuentaBancariaId_fkey" FOREIGN KEY ("cuentaBancariaId") REFERENCES "CuentaBancaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineaExtractoSugerencia" ADD CONSTRAINT "LineaExtractoSugerencia_importacionId_fkey" FOREIGN KEY ("importacionId") REFERENCES "ImportacionExtracto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineaExtractoSugerencia" ADD CONSTRAINT "LineaExtractoSugerencia_cuentaSugeridaId_fkey" FOREIGN KEY ("cuentaSugeridaId") REFERENCES "CuentaContable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineaExtractoSugerencia" ADD CONSTRAINT "LineaExtractoSugerencia_proveedorSugeridoId_fkey" FOREIGN KEY ("proveedorSugeridoId") REFERENCES "Proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineaExtractoSugerencia" ADD CONSTRAINT "LineaExtractoSugerencia_clienteSugeridoId_fkey" FOREIGN KEY ("clienteSugeridoId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineaExtractoSugerencia" ADD CONSTRAINT "LineaExtractoSugerencia_movimientoId_fkey" FOREIGN KEY ("movimientoId") REFERENCES "MovimientoTesoreria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contacto" ADD CONSTRAINT "Contacto_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contacto" ADD CONSTRAINT "Contacto_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Oportunidad" ADD CONSTRAINT "Oportunidad_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Oportunidad" ADD CONSTRAINT "Oportunidad_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Oportunidad" ADD CONSTRAINT "Oportunidad_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Oportunidad" ADD CONSTRAINT "Oportunidad_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Actividad" ADD CONSTRAINT "Actividad_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Actividad" ADD CONSTRAINT "Actividad_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Actividad" ADD CONSTRAINT "Actividad_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Actividad" ADD CONSTRAINT "Actividad_oportunidadId_fkey" FOREIGN KEY ("oportunidadId") REFERENCES "Oportunidad"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulacionImportacion" ADD CONSTRAINT "SimulacionImportacion_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSimulacionImportacion" ADD CONSTRAINT "ItemSimulacionImportacion_simulacionId_fkey" FOREIGN KEY ("simulacionId") REFERENCES "SimulacionImportacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSimulacionImportacion" ADD CONSTRAINT "ItemSimulacionImportacion_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostoSimulacionImportacion" ADD CONSTRAINT "CostoSimulacionImportacion_simulacionId_fkey" FOREIGN KEY ("simulacionId") REFERENCES "SimulacionImportacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Objetos raw NÃO modelados pelo PSL do Prisma (índices parciais + CHECK).
-- `prisma migrate diff --from-empty` não os gera, mas EXISTEM em produção
-- (aplicados historicamente via scripts). Materializados aqui para que o
-- baseline seja FIEL a prod e os bancos novos (testes/dev via `migrate deploy`)
-- tenham a MESMA unicidade que produção. Todos idempotentes.
-- Fontes: prisma/partial-indexes-despacho.ts (ITEM_DESPACHO_PARTIAL_DDL) e
--         prisma/add-partial-indexes-contenedor.ts.
-- ============================================================================

-- ItemDespacho: unicidade do despacho parcial cruzado (índices parciais disjuntos)
CREATE UNIQUE INDEX IF NOT EXISTS "ItemDespacho_legacy_uq" ON "ItemDespacho" ("despachoId", "itemEmbarqueId") WHERE "contenedorId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "ItemDespacho_cruzado_uq" ON "ItemDespacho" ("despachoId", "itemContenedorId") WHERE "contenedorId" IS NOT NULL;

-- ItemDespacho: CHECK de coerência de origem (legacy ⇔ ambos NULL; cruzado ⇔ ambos setados)
ALTER TABLE "ItemDespacho" DROP CONSTRAINT IF EXISTS "ItemDespacho_origen_coherente_chk";
ALTER TABLE "ItemDespacho" ADD CONSTRAINT "ItemDespacho_origen_coherente_chk" CHECK (("contenedorId" IS NULL) = ("itemContenedorId" IS NULL)) NOT VALID;
ALTER TABLE "ItemDespacho" VALIDATE CONSTRAINT "ItemDespacho_origen_coherente_chk";

-- ItemContenedor: unicidade por lote (Q11) — `@@unique` do Prisma não suporta WHERE
CREATE UNIQUE INDEX IF NOT EXISTS "ItemContenedor_clp_idx" ON "ItemContenedor" ("contenedorId", "productoId", "loteFabricacion") WHERE "loteFabricacion" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "ItemContenedor_cp_null_idx" ON "ItemContenedor" ("contenedorId", "productoId") WHERE "loteFabricacion" IS NULL;


# Plan de Cuentas — Sunset Tires Corporation SAS

**Modelo:** RT9 (exposición) / RT17 (medición) / RT6 (reexpresión) — FACPCE · Ley 19.550
**Estado:** v3 — ajustado para cumplimiento contable + segmentado por subgrupos (CFO) · pendiente de validación final del contador
**Fecha:** 2026-06-16
**Contexto:** rebuild completo del libro mayor sobre este plan, preservando los maestros. Esta versión corrige las desviaciones normativas del DRAFT v1 (ver changelog).

---

## Convenciones

- **Tipo:** `S` = SINTÉTICA (agrupadora, no recibe asientos) · `A` = ANALÍTICA (recibe asientos).
- **Nat:** naturaleza del saldo. `D` = DEUDOR (ACTIVO/EGRESO) · `A` = ACREEDOR (PASIVO/PN/INGRESO). Las **regularizadoras** `(-)` invierten la naturaleza de su rubro.
- **← origen:** código en el plan actual; vacío = sin cambio; `NUEVA` = cuenta incorporada por cumplimiento.
- **auto:** cuenta creada automáticamente por el sistema (un código por entidad). El rango queda reservado; `.01–.09` para cuentas genéricas manuales.
- **Regla de oro de jerarquía:** toda cuenta ANALÍTICA cuelga de una SINTÉTICA declarada; `nivel == codigo.split('.').length`; ninguna analítica queda huérfana.
- **Exposición (RT9):** la agrupación en EECC se rige por `rubroEECC`, no solo por el árbol de código.

---

## Changelog de cumplimiento (v1 → v3)

1. **Costos de importación = ACTIVO, no gasto (RT 17, secc. 4 / NIC 2).** Se eliminan del Estado de Resultados los rubros `5.4 Gastos de Importación` y `5.7 Impuestos Nacionalización (egreso)`. Derechos, tasa estadística, SIM, flete internacional, seguro, despachante, gastos portuarios y flete interno de entrada **se capitalizan a `1.1.7.02 Mercaderías en Tránsito`** y llegan al resultado vía `5.1.1.01 CMV` al vender.
2. **Impuesto a las Ganancias con línea propia (RT 9).** Sale de `5.9` y pasa al rubro propio `5.10`.
3. **Patrimonio Neto completo (RT 9 — EEPN + Ley 19.550 art. 70).** Se incorporan Ajuste de Capital (RT 6), Prima de Emisión, Reserva Legal, Facultativa y Estatutaria. Se completan las sintéticas intermedias 3.x.
4. **RECPAM (RT 6, ajuste por inflación).** `4.3.1.04` (positivo) y `5.8.1.06` (negativo).
5. **Jerarquía sin huérfanas.** Se declaran todas las sintéticas intermedias faltantes (`3.1.1`, `3.2.1`, `4.1.1`, `5.1.1`, `5.2.1`, etc.).
6. **Corrección de `2.1.3.03 Ganancias por Pagar (importación)`.** La percepción de Ganancias en aduana es un pago a cuenta (activo, `1.1.5.3.01`). La cuenta se reconvierte en `Retenciones/Percepciones a Depositar (practicadas)`.
7. **Resultados financieros agrupados (RT 9).** `Intereses Ganados` pasa de `4.2` a `4.3`. Par único de diferencia de cambio (ganancia `4.3.1.02` / pérdida `5.8.1.02`).
8. **Anticipos a Proveedores (RT 9 — Otros Créditos).** `1.1.6.1.01–03`.
9. **Intangibles y Otros Activos No Corrientes (RT 9).** `1.2.2 Intangibles` (+ amortización) y `1.2.3 Depósitos en Garantía`.
10. **Medición de inventario a VNR (RT 17).** `(-) Desvalorización de Bienes de Cambio` regularizadora a sembrar si VNR < costo.
11. **Limpiezas menores:** `Caja y Equivalentes` → `Caja` (equivalentes en Inversiones).
12. **Segmentación por subgrupos (v3).** Nivel sintético intermedio por subcategoría: **Créditos Fiscales** → `1.1.5.1` IVA / `1.1.5.2` IIBB / `1.1.5.3` Ganancias / `1.1.5.4` Aduana; **Deudas Fiscales** → `2.1.3.1` IVA / `2.1.3.2` IIBB / `2.1.3.3` Ganancias / `2.1.3.4` Retenciones (se **disuelve `2.1.6`** y el IVA débito pasa a `2.1.3.1.01`); **Otros Créditos** → `1.1.6.1` Anticipos / `1.1.6.2` Otros. Convención: subgrupo = 1 dígito (`.1`), analítica = 2 dígitos (`.01`).

---

## 1 · ACTIVO

### 1.1 · ACTIVO CORRIENTE

| Código | Cuenta | Tipo | Cat | Nat | ← origen | Notas |
|---|---|---|---|---|---|---|
| `1` | ACTIVO | S | ACTIVO | D | | |
| `1.1` | ACTIVO CORRIENTE | S | ACTIVO | D | | |
| `1.1.1` | CAJA | S | ACTIVO | D | | renombrado (equivalentes en 1.1.3) |
| `1.1.1.10–99` | Cajas / cajas chicas | A | ACTIVO | D | | auto (CuentaBancaria CAJA_CHICA) |
| `1.1.2` | BANCOS | S | ACTIVO | D | | |
| `1.1.2.10–99` | Cuentas bancarias | A | ACTIVO | D | | auto · marcar USD-nativas |
| `1.1.3` | INVERSIONES | S | ACTIVO | D | | |
| `1.1.3.01` | INVERSIONES EN FONDOS COMUNES | A | ACTIVO | D | `1.1.6.01` | FCI |
| `1.1.3.02` | PLAZOS FIJOS | A | ACTIVO | D | NUEVA | |
| `1.1.4` | CRÉDITOS POR VENTAS | S | ACTIVO | D | `1.1.3` | clientes movidos aquí |
| `1.1.4.01` | DEUDORES POR VENTAS (fallback) | A | ACTIVO | D | `1.1.3.01` | |
| `1.1.4.09` | (-) PREVISIÓN DEUDORES INCOBRABLES | A | ACTIVO | A | | regularizadora (RT 17) |
| `1.1.4.10–99` | Clientes por canal | A | ACTIVO | D | `1.1.3.10–99` | auto (Cliente) |
| `1.1.5` | CRÉDITOS FISCALES | S | ACTIVO | D | | pago a cuenta / recuperables |
| `1.1.5.1` | IVA — CRÉDITO FISCAL Y PERCEPCIONES | S | ACTIVO | D | | subgrupo |
| `1.1.5.1.01` | IVA CRÉDITO FISCAL — COMPRAS LOCALES | A | ACTIVO | D | `1.1.4.01`+`1.1.4.08` | consolida CF y CF compras |
| `1.1.5.1.02` | PERCEPCIÓN IVA RG 2408 (BANCARIA) | A | ACTIVO | D | `1.1.4.02` | |
| `1.1.5.1.03` | IVA CRÉDITO FISCAL IMPORTACIÓN | A | ACTIVO | D | `1.1.4.04` | |
| `1.1.5.1.04` | PERCEPCIÓN IVA ADICIONAL IMPORTACIÓN | A | ACTIVO | D | `1.1.4.05` | pago a cuenta |
| `1.1.5.2` | INGRESOS BRUTOS — PERCEPCIONES | S | ACTIVO | D | | subgrupo |
| `1.1.5.2.01` | PERCEPCIÓN IIBB IMPORTACIÓN | A | ACTIVO | D | `1.1.4.06` | |
| `1.1.5.2.02` | PERCEPCIÓN IIBB COMPRAS | A | ACTIVO | D | `1.1.4.11` | |
| `1.1.5.2.03` | PERCEPCIÓN IIBB BANCARIA (SIRCREB) | A | ACTIVO | D | `1.1.4.10` | |
| `1.1.5.3` | GANANCIAS — PERCEPCIONES Y PAGOS A CUENTA | S | ACTIVO | D | | subgrupo |
| `1.1.5.3.01` | PERCEPCIÓN GANANCIAS IMPORTACIÓN | A | ACTIVO | D | `1.1.4.07` | |
| `1.1.5.3.02` | CRÉDITO LEY 25413 PAGO A CTA GANANCIAS | A | ACTIVO | D | `1.1.4.12` | 33% imp. al cheque |
| `1.1.5.4` | ADUANA | S | ACTIVO | D | | subgrupo |
| `1.1.5.4.01` | CRÉDITO A FAVOR ADUANA (DIF CAMBIARIA) | A | ACTIVO | D | `1.1.4.13` | |
| `1.1.6` | OTROS CRÉDITOS | S | ACTIVO | D | | |
| `1.1.6.1` | ANTICIPOS | S | ACTIVO | D | | subgrupo |
| `1.1.6.1.01` | ANTICIPOS A PROVEEDORES DEL EXTERIOR (USD) | A | ACTIVO | D | NUEVA | USD-nativa · revalúo |
| `1.1.6.1.02` | ANTICIPOS A PROVEEDORES LOCALES | A | ACTIVO | D | NUEVA | |
| `1.1.6.1.03` | ANTICIPOS AL PERSONAL | A | ACTIVO | D | NUEVA | |
| `1.1.6.2` | OTROS | S | ACTIVO | D | | subgrupo |
| `1.1.6.2.01` | VALORES A COBRAR (CHEQUES DE TERCEROS) | A | ACTIVO | D | `1.1.4.20` | cuasi-efectivo |
| `1.1.6.2.02` | GASTOS PAGADOS POR ADELANTADO | A | ACTIVO | D | NUEVA | seguros, alquileres |
| `1.1.7` | ESTOQUE | S | ACTIVO | D | `1.1.5` | estoque movido aquí |
| `1.1.7.01` | ESTOQUE NACIONALIZADO | A | ACTIVO | D | `1.1.5.01` | vendible (costo landed) |
| `1.1.7.02` | ESTOQUE A DESPACHAR | A | ACTIVO | D | `1.1.5.02` | **acumula costo landed** (FOB+flete+seguro+tributos+despachante+portuarios+flete interno); rol motor = en tránsito |
| `1.1.7.03` | MERCADERÍAS EN TRÁNSITO | A | ACTIVO | D | `1.1.5.04` | rol motor = zona primaria (ZPA, bonded) |
| `1.1.7.04` | MERCADERÍAS EN DEPÓSITO FISCAL (DF) | A | ACTIVO | D | `1.1.5.05` | bonded |
| `1.1.7.05` | MERCADERÍAS A ENTREGAR | A | ACTIVO | D | `1.1.5.03` | puente stock-dual |
| `1.1.7.09` | (-) DESVALORIZACIÓN DE BIENES DE CAMBIO | A | ACTIVO | A | NUEVA | regularizadora VNR (RT 17) |

### 1.2 · ACTIVO NO CORRIENTE

| Código | Cuenta | Tipo | Cat | Nat | ← origen | Notas |
|---|---|---|---|---|---|---|
| `1.2` | ACTIVO NO CORRIENTE | S | ACTIVO | D | | |
| `1.2.1` | BIENES DE USO | S | ACTIVO | D | | |
| `1.2.1.01–08` | Rodados / Muebles / Equipos / Instalaciones | A | ACTIVO | D | | a sembrar |
| `1.2.1.09` | (-) DEPRECIACIÓN ACUMULADA BIENES DE USO | A | ACTIVO | A | | regularizadora |
| `1.2.2` | ACTIVOS INTANGIBLES | S | ACTIVO | D | NUEVA | |
| `1.2.2.01` | SOFTWARE Y LICENCIAS (ERP) | A | ACTIVO | D | NUEVA | |
| `1.2.2.09` | (-) AMORTIZACIÓN ACUMULADA INTANGIBLES | A | ACTIVO | A | NUEVA | regularizadora |
| `1.2.3` | OTROS ACTIVOS NO CORRIENTES | S | ACTIVO | D | NUEVA | |
| `1.2.3.01` | DEPÓSITOS EN GARANTÍA | A | ACTIVO | D | NUEVA | alquileres, servicios |

---

## 2 · PASIVO

### 2.1 · PASIVO CORRIENTE

| Código | Cuenta | Tipo | Cat | Nat | ← origen | Notas |
|---|---|---|---|---|---|---|
| `2` | PASIVO | S | PASIVO | A | | |
| `2.1` | PASIVO CORRIENTE | S | PASIVO | A | | |
| `2.1.1` | DEUDAS COMERCIALES | S | PASIVO | A | | proveedores locales |
| `2.1.1.01` | PROVEEDORES LOCALES (fallback) | A | PASIVO | A | | |
| `2.1.1.05` | FLETES SOBRE VENTAS POR PAGAR | A | PASIVO | A | | |
| `2.1.1.10–99` | Proveedores locales por tipo | A | PASIVO | A | | auto · servicios de import. locales capitalizan a `1.1.7.02` |
| `2.1.2` | DEUDAS BANCARIAS Y FINANCIERAS | S | PASIVO | A | | |
| `2.1.2.10–99` | Préstamos corto plazo | A | PASIVO | A | `2.1.7.10–99` | auto (PrestamoExterno CP) |
| `2.1.3` | DEUDAS FISCALES | S | PASIVO | A | | `rubroEECC = Deudas Fiscales` |
| `2.1.3.1` | IVA | S | PASIVO | A | | subgrupo |
| `2.1.3.1.01` | IVA DÉBITO FISCAL | A | PASIVO | A | `2.1.6.01` | |
| `2.1.3.1.02` | IVA SALDO A PAGAR (POSICIÓN) | A | PASIVO | A | | neto DF − CF |
| `2.1.3.2` | INGRESOS BRUTOS | S | PASIVO | A | | subgrupo |
| `2.1.3.2.01` | IIBB POR PAGAR | A | PASIVO | A | `2.1.3.02` | propio (Córdoba) |
| `2.1.3.2.02` | IIBB CONVENIO MULTILATERAL A DEPOSITAR | A | PASIVO | A | `2.1.3.05` | |
| `2.1.3.3` | GANANCIAS | S | PASIVO | A | | subgrupo |
| `2.1.3.3.01` | IMPUESTO A LAS GANANCIAS A PAGAR (PROVISIÓN) | A | PASIVO | A | `2.1.3.06` | 35% s/ utilidad |
| `2.1.3.3.02` | RETENCIONES GANANCIAS A DEPOSITAR (SICORE) | A | PASIVO | A | `2.1.3.07` | RG 830 / F.997 |
| `2.1.3.4` | RETENCIONES Y OTROS | S | PASIVO | A | | subgrupo |
| `2.1.3.4.01` | RETENCIONES/PERCEPCIONES A DEPOSITAR (PRACTICADAS) | A | PASIVO | A | `2.1.3.03` | corrige "Ganancias importación" (era error) |
| `2.1.3.4.02` | OTROS IMPUESTOS | A | PASIVO | A | `2.1.3.04` | |
| `2.1.4` | DEUDAS SOCIALES | S | PASIVO | A | | |
| `2.1.4.01` | SUELDOS A PAGAR | A | PASIVO | A | NUEVA | |
| `2.1.4.02` | CARGAS SOCIALES A PAGAR (SUSS) | A | PASIVO | A | NUEVA | |
| `2.1.4.03` | PROVISIÓN SAC Y VACACIONES | A | PASIVO | A | NUEVA | |
| `2.1.4.04` | ART / SINDICATO A DEPOSITAR | A | PASIVO | A | NUEVA | |
| `2.1.5` | IMPUESTOS NACIONALIZACIÓN POR PAGAR | S | PASIVO | A | | tributos aduaneros pendientes |
| `2.1.5.01` | DERECHOS DE IMPORTACIÓN POR PAGAR | A | PASIVO | A | | |
| `2.1.5.02` | TASA ESTADÍSTICA POR PAGAR | A | PASIVO | A | | |
| `2.1.5.03` | ARANCEL SIM POR PAGAR | A | PASIVO | A | | |
| `2.1.5.04` | IVA IMPORTACIÓN POR PAGAR | A | PASIVO | A | | |
| `2.1.5.99` | SALDO PENDIENTE ADUANA (REFUERZO VEP) | A | PASIVO | A | | dif. cambiaria VEP |
| `2.1.7` | ANTICIPOS DE CLIENTES | S | PASIVO | A | | rubro corregido (no es préstamo) |
| `2.1.7.01` | ANTICIPOS DE CLIENTES | A | PASIVO | A | | excedente cheques / cobros anticipados |
| `2.1.8` | PROVEEDORES DEL EXTERIOR | S | PASIVO | A | | USD-nativa |
| `2.1.8.01` | PROVEEDORES DEL EXTERIOR (fallback) | A | PASIVO | A | `2.1.1.02` | |
| `2.1.8.10–99` | Proveedores exterior | A | PASIVO | A | | auto · FOB y fletes capitalizan a `1.1.7.02` |

### 2.2 · PASIVO NO CORRIENTE

| Código | Cuenta | Tipo | Cat | Nat | ← origen | Notas |
|---|---|---|---|---|---|---|
| `2.2` | PASIVO NO CORRIENTE | S | PASIVO | A | | |
| `2.2.1` | PRÉSTAMOS LARGO PLAZO | S | PASIVO | A | | |
| `2.2.1.10–99` | Préstamos largo plazo | A | PASIVO | A | | auto (PrestamoExterno LP) |
| `2.2.2` | PREVISIONES (LARGO PLAZO) | S | PASIVO | A | NUEVA | |
| `2.2.2.01` | PREVISIÓN PARA INDEMNIZACIONES / CONTINGENCIAS | A | PASIVO | A | NUEVA | a criterio del contador |

---

## 3 · PATRIMONIO NETO

| Código | Cuenta | Tipo | Cat | Nat | ← origen | Notas |
|---|---|---|---|---|---|---|
| `3` | PATRIMONIO NETO | S | PATRIMONIO | A | | |
| `3.1` | APORTES DE LOS PROPIETARIOS | S | PATRIMONIO | A | | |
| `3.1.1` | CAPITAL | S | PATRIMONIO | A | | |
| `3.1.1.01` | CAPITAL SOCIAL | A | PATRIMONIO | A | | |
| `3.1.1.02` | APORTES IRREVOCABLES | A | PATRIMONIO | A | | |
| `3.1.2` | AJUSTES Y PRIMAS | S | PATRIMONIO | A | NUEVA | |
| `3.1.2.01` | AJUSTE DE CAPITAL | A | PATRIMONIO | A | NUEVA | reexpresión RT 6 |
| `3.1.2.02` | PRIMA DE EMISIÓN | A | PATRIMONIO | A | NUEVA | |
| `3.2` | RESULTADOS | S | PATRIMONIO | A | | |
| `3.2.1` | RESULTADOS ACUMULADOS | S | PATRIMONIO | A | | |
| `3.2.1.01` | RESULTADOS NO ASIGNADOS (EJ. ANTERIORES) | A | PATRIMONIO | A | | |
| `3.2.1.02` | RESULTADO DEL EJERCICIO | A | PATRIMONIO | A | | |
| `3.2.1.03` | (-) DIVIDENDOS DECLARADOS | A | PATRIMONIO | D | | regularizadora |
| `3.3` | RESERVAS | S | PATRIMONIO | A | NUEVA | |
| `3.3.1` | RESERVAS | S | PATRIMONIO | A | NUEVA | |
| `3.3.1.01` | RESERVA LEGAL | A | PATRIMONIO | A | NUEVA | 5% hasta 20% (LGS art. 70) |
| `3.3.1.02` | RESERVA FACULTATIVA | A | PATRIMONIO | A | NUEVA | |
| `3.3.1.03` | RESERVA ESTATUTARIA | A | PATRIMONIO | A | NUEVA | |

> **Nota societaria:** Reserva Legal (art. 70 LGS) obligatoria para S.A./S.R.L.; para SAS (Ley 27.349) depende del estatuto. Confirmar tipo societario con el contador.

---

## 4 · INGRESOS

| Código | Cuenta | Tipo | Cat | Nat | ← origen | Notas |
|---|---|---|---|---|---|---|
| `4` | INGRESOS | S | INGRESO | A | | |
| `4.1` | INGRESOS POR VENTAS | S | INGRESO | A | | |
| `4.1.1` | VENTAS | S | INGRESO | A | | |
| `4.1.1.01` | VENTAS NEUMÁTICOS NUEVOS | A | INGRESO | A | | |
| `4.1.2` | DEDUCCIONES SOBRE VENTAS | S | INGRESO | D | | |
| `4.1.2.01` | (-) DEVOLUCIONES SOBRE VENTAS | A | INGRESO | D | | regularizadora (RT9) |
| `4.1.2.02` | (-) BONIFICACIONES SOBRE VENTAS | A | INGRESO | D | | regularizadora (RT9) |
| `4.2` | OTROS INGRESOS | S | INGRESO | A | | |
| `4.2.1` | OTROS INGRESOS OPERATIVOS | S | INGRESO | A | | |
| `4.2.1.01` | DESCUENTOS OBTENIDOS | A | INGRESO | A | | |
| `4.2.1.02` | RECUPERO DE GASTOS | A | INGRESO | A | NUEVA | |
| `4.2.2` | RESULTADOS POR TENENCIA DE INVENTARIO | S | INGRESO | A | | |
| `4.2.2.01` | INGRESOS POR DIFERENCIA DE INVENTARIO (SOBRANTES) | A | INGRESO | A | `4.9.1.01` | |
| `4.3` | RESULTADOS FINANCIEROS Y POR TENENCIA | S | INGRESO | A | | |
| `4.3.1` | RESULTADOS FINANCIEROS POSITIVOS | S | INGRESO | A | | |
| `4.3.1.01` | INTERESES GANADOS | A | INGRESO | A | `4.2.1.02` | movido desde Otros Ingresos |
| `4.3.1.02` | GANANCIA POR DIFERENCIA DE CAMBIO | A | INGRESO | A | `4.3.1.01`+`4.5.1.01` | par único |
| `4.3.1.03` | RENDIMIENTO DE INVERSIONES (FCI) | A | INGRESO | A | NUEVA | |
| `4.3.1.04` | RECPAM POSITIVO | A | INGRESO | A | NUEVA | RT 6 |

---

## 5 · EGRESOS

> Reestructurado por función (RT 9). **Los costos de importación ya no son egresos: se capitalizan a `1.1.7.02` (RT 17).**

| Código | Cuenta | Tipo | Cat | Nat | ← origen | Notas |
|---|---|---|---|---|---|---|
| `5` | EGRESOS | S | EGRESO | D | | |
| `5.1` | COSTO DE MERCADERÍAS VENDIDAS | S | EGRESO | D | | |
| `5.1.1` | COSTO DE VENTAS | S | EGRESO | D | | |
| `5.1.1.01` | COSTO MERCADERÍA VENDIDA (CMV) | A | EGRESO | D | `5.6.1.01` | absorbe el costo landed al vender |
| `5.1.1.02` | MERMAS Y FALTANTES DE INVENTARIO | A | EGRESO | D | `5.9.2.01` | |
| `5.2` | GASTOS DE COMERCIALIZACIÓN | S | EGRESO | D | | |
| `5.2.1` | GASTOS DE COMERCIALIZACIÓN | S | EGRESO | D | | |
| `5.2.1.01` | FLETE SOBRE VENTAS | A | EGRESO | D | `5.5.1.60` | flete de salida (NO inventariable) |
| `5.2.1.02` | PUBLICIDAD Y MARKETING | A | EGRESO | D | `5.3.1.05` | |
| `5.2.1.03` | INGRESOS BRUTOS (IIBB) | A | EGRESO | D | `5.5.02` | tributo sobre ventas |
| `5.2.1.04` | COMISIONES SOBRE VENTAS | A | EGRESO | D | NUEVA | |
| `5.2.2` | MARKETING POR PROVEEDOR | S | EGRESO | D | | agrupador de auto |
| `5.2.2.10–49` | Marketing por proveedor | A | EGRESO | D | `5.3.1.30–49` | auto |
| `5.3` | GASTOS DE ADMINISTRACIÓN | S | EGRESO | D | | |
| `5.3.1` | GASTOS DE ADMINISTRACIÓN | S | EGRESO | D | | |
| `5.3.1.01` | HONORARIOS CONTABLES Y PROFESIONALES | A | EGRESO | D | `5.1.1.01` | |
| `5.3.1.02` | SISTEMAS Y SOFTWARE | A | EGRESO | D | `5.3.1.02` | |
| `5.3.1.03` | ALQUILERES | A | EGRESO | D | `5.2.1.01` | |
| `5.3.1.04` | SUELDOS Y CARGAS SOCIALES (ADM.) | A | EGRESO | D | NUEVA | |
| `5.3.1.05` | SERVICIOS Y GASTOS GENERALES | A | EGRESO | D | NUEVA | |
| `5.3.1.06` | DEPRECIACIONES Y AMORTIZACIONES | A | EGRESO | D | NUEVA | |
| `5.3.1.07` | ALMACENAJE DE STOCK PROPIO (POST-NACIONALIZACIÓN) | A | EGRESO | D | (parte de `5.5.1.05`) | el almacenaje bonded/ZPA capitaliza |
| `5.3.1.99` | OTROS GASTOS DE ADMINISTRACIÓN | A | EGRESO | D | `5.3.1.99` | |
| `5.3.2` | SERVICIOS PROFESIONALES POR PROVEEDOR | S | EGRESO | D | | agrupador de auto |
| `5.3.2.10–29` | Servicios profesionales por proveedor | A | EGRESO | D | `5.1.1.30–49` | auto |
| `5.3.3` | IT / SOFTWARE POR PROVEEDOR | S | EGRESO | D | | agrupador de auto |
| `5.3.3.10–29` | IT / software por proveedor | A | EGRESO | D | `5.3.1.10–29` | auto |
| `5.8` | RESULTADOS FINANCIEROS Y POR TENENCIA | S | EGRESO | D | | |
| `5.8.1` | RESULTADOS FINANCIEROS NEGATIVOS | S | EGRESO | D | | |
| `5.8.1.01` | COMISIONES BANCARIAS | A | EGRESO | D | `5.8.1.01` | |
| `5.8.1.02` | PÉRDIDA POR DIFERENCIA DE CAMBIO | A | EGRESO | D | `5.8.2.01`+`5.5.3.01` | par único |
| `5.8.1.03` | GASTOS TRANSFERENCIA EXTERIOR | A | EGRESO | D | `5.8.1.02` | SWIFT / TT |
| `5.8.1.04` | IMPUESTO DE SELLOS | A | EGRESO | D | `5.8.1.04` | |
| `5.8.1.05` | IMPUESTO LEY 25413 (NO COMPUTABLE) | A | EGRESO | D | `5.8.1.06` | 67% no computable |
| `5.8.1.06` | RECPAM NEGATIVO | A | EGRESO | D | NUEVA | RT 6 |
| `5.8.1.07` | INTERESES PAGADOS | A | EGRESO | D | `5.8.2.02` | |
| `5.8.1.08` | DIFERENCIAS DE REDONDEO | A | EGRESO | D | `5.8.3.01` | |
| `5.9` | OTROS EGRESOS | S | EGRESO | D | | |
| `5.9.1` | OTROS EGRESOS | S | EGRESO | D | | |
| `5.9.1.01` | GASTOS NO DEDUCIBLES / MULTAS | A | EGRESO | D | NUEVA | |
| `5.9.1.02` | OTROS EGRESOS | A | EGRESO | D | | |
| `5.10` | IMPUESTO A LAS GANANCIAS | S | EGRESO | D | | rubro propio (RT 9) |
| `5.10.1` | IMPUESTO A LAS GANANCIAS | S | EGRESO | D | | |
| `5.10.1.01` | IMPUESTO A LAS GANANCIAS DEL EJERCICIO | A | EGRESO | D | `5.9.1.01` | devengo del período |

### 5.4 y 5.7 — ELIMINADOS (capitalización a inventario)

| Concepto v1 (egreso) | ← origen | Destino v3 | Tratamiento |
|---|---|---|---|
| Derechos de importación | `5.7.1.01` | `1.1.7.02` | costo landed |
| Tasa estadística | `5.7.1.02` | `1.1.7.02` | costo landed |
| Arancel SIM | `5.7.1.03` | `1.1.7.02` | costo landed |
| Honorarios despachante | `5.1.1.03` | `1.1.7.02` | costo landed |
| Gastos portuarios | `5.4.1.01` | `1.1.7.02` | costo landed |
| Flete internacional | `5.5.1.02` | `1.1.7.02` | costo landed |
| Flete nacional **de entrada** (puerto→depósito) | `5.5.1.01` | `1.1.7.02` | costo landed |
| Almacenaje bonded / ZPA / DF (pre-nac.) | `5.5.1.05` | `1.1.7.02` | costo landed |
| Almacenaje de stock propio (post-nac.) | `5.5.1.05` (parte) | `5.3.1.07` | gasto de administración |
| Flete nacional **de salida** (a cliente) | `5.5.1.60` | `5.2.1.01` | gasto de comercialización |

> **Migración:** la capitalización de saldos preexistentes se hace contra `1.1.7.x`/`5.1.1.01` según la mercadería esté en stock o ya vendida, a coordinar con el contador en el corte.

---

## Rangos de auto-creación (un código por entidad)

| Entidad / tipo | Rango nuevo | ← rango actual | Padre | ¿Imputa a resultado? |
|---|---|---|---|---|
| Caja chica | `1.1.1.10–99` | `1.1.1.10–99` | `1.1.1` | — (activo) |
| Cuenta bancaria | `1.1.2.10–99` | `1.1.2.10–99` | `1.1.2` | — (activo) |
| Cliente (por canal) | `1.1.4.10–99` | `1.1.3.10–99` | `1.1.4` | — (activo) |
| Proveedor local (por tipo) | `2.1.1.10–99` | `2.1.1.10–99` | `2.1.1` | — (pasivo); servicio import. → `1.1.7.02` |
| Proveedor exterior | `2.1.8.10–99` | `2.1.8.10–99` | `2.1.8` | — (pasivo); FOB/flete → `1.1.7.02` |
| Préstamo corto plazo | `2.1.2.10–99` | `2.1.7.10–99` | `2.1.2` | — (pasivo) |
| Préstamo largo plazo | `2.2.1.10–99` | `2.2.1.10–99` | `2.2.1` | — (pasivo) |
| Gasto de **período** por proveedor (marketing/serv.prof./IT) | bajo `5.2`–`5.3` | bajo `5.1`–`5.5` | varios | Sí (resultado) |
| Servicio de **importación** por proveedor (despachante/portuario/naviera/flete/almacenaje bonded) | — (no crea cuenta de resultado) | `5.4.x`/`5.5.x` | `2.1.1`/`2.1.8` (pasivo) + `1.1.7.02` (costo) | No → capitaliza |

`.01–.09` de cada padre quedan reservados para cuentas genéricas (fallback / manuales).

---

## Regularizadoras (naturaleza invertida)

| Código | Cuenta | Rubro | Naturaleza |
|---|---|---|---|
| `1.1.4.09` | (-) Previsión deudores incobrables | ACTIVO | ACREEDOR |
| `1.1.7.09` | (-) Desvalorización de bienes de cambio | ACTIVO | ACREEDOR |
| `1.2.1.09` | (-) Depreciación acumulada bienes de uso | ACTIVO | ACREEDOR |
| `1.2.2.09` | (-) Amortización acumulada intangibles | ACTIVO | ACREEDOR |
| `3.2.1.03` | (-) Dividendos declarados | PATRIMONIO | DEUDOR |
| `4.1.2.01` | (-) Devoluciones sobre ventas | INGRESO | DEUDOR |
| `4.1.2.02` | (-) Bonificaciones sobre ventas | INGRESO | DEUDOR |

`CuentaContable.naturaleza` debe setearse explícito en estas; el resto se deriva de la categoría.

---

## Campos por cuenta (schema)

- **`naturaleza`** (DEUDOR/ACREEDOR): explícito en regularizadoras; default por categoría.
- **`moneda`** (ARS/USD/BI): USD-nativas → `1.1.6.1.01` (anticipos exterior), `1.1.7.02` (parte USD), `2.1.8.x`, `2.2.1.x` y bancos USD → revalúo al cierre contra `4.3.1.02`/`5.8.1.02`.
- **`rubroEECC`** (string): agrupa la exposición. Todo `2.1.3.x` → "Deudas Fiscales"; `4.3`/`5.8` → "Resultados Financieros y por Tenencia".

---

## Estado de Resultados (RT 9) — orden de exposición

```
Ventas Netas                          4.1
(−) CMV                               5.1
= RESULTADO BRUTO
(−) Gastos de Comercialización        5.2
(−) Gastos de Administración          5.3
= RESULTADO OPERATIVO
(±) Resultados Financieros y Tenencia 4.3 / 5.8   (incluye RECPAM, RT 6)
(±) Otros Ingresos / Egresos          4.2 / 5.9
= RESULTADO ANTES DE IMPUESTOS
(−) Impuesto a las Ganancias          5.10
= RESULTADO DEL EJERCICIO             → 3.2.1.02
```

---

## Decisiones abiertas (requieren al contador)

1. **Tipo societario:** SAS vs S.A. → define si la Reserva Legal (`3.3.1.01`) es obligatoria.
2. **Capitalización de import-costs:** corte para reclasificar saldos preexistentes de `5.4/5.7` a `1.1.7.x`.
3. **VNR de inventario:** política y periodicidad de `1.1.7.09` (RT 17).
4. **Previsión incobrables (`1.1.4.09`):** criterio de constitución.
5. **`moneda`/`rubroEECC`** definitivos por cuenta; definición de `BI` bimonetario.
6. **Cheques de terceros (`1.1.6.2.01`):** exposición en "Otros Créditos" vs "Caja".

---

## Impacto en el motor (al cerrar el mapa)

- `src/lib/services/cuenta-registry.ts` — nuevos: `IMP_GANANCIAS=5.10.1.01`, `RECPAM_POS=4.3.1.04`, `RECPAM_NEG=5.8.1.06`, `RESERVA_LEGAL=3.3.1.01`, `AJUSTE_CAPITAL=3.1.2.01`.
- `src/lib/services/cuenta-auto.ts` (`RANGES` + `SINTETICA_DEFAULTS`) — los proveedores de servicios de importación **no** crean cuenta de resultado; su costo va a `1.1.7.02`.
- **Asiento de importación:** despachante/portuarios/flete/derechos/tasa/SIM → DÉBITO `1.1.7.02` (no `5.4/5.7`). Hoy se debitan a `5.7.1.x` en `asiento-automatico.ts:1304-1318` y `:2474-2486`.
- Reclasificación por prefijo en `reportes/balance-general.ts` y `estado-resultados.ts`; `rubroEECC` manda sobre `padreCodigo`.
- Flags FX (`FX_GAIN=4.3.1.02`, `FX_LOSS=5.8.1.02`), RECPAM, flag "cuenta inventariable" para bloquear que un `5.x` reciba costo de importación.
- **Guard bidireccional** (`prisma/guard-plan-de-cuentas.ts`) en CI: (1) todo código del registry existe con su categoría; (2) ninguna analítica huérfana; (3) `nivel == codigo.split('.').length`; (4) ningún `5.x` marcado inventariable; (5) toda regularizadora con `naturaleza` explícita.

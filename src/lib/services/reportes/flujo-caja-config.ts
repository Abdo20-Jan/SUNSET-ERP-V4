/**
 * Estrutura estática do Fluxo de Caixa, replicando o modelo do Excel da diretoria
 * (seções obrigatórias). Cada subitem do template aparece na matriz mesmo quando
 * não há conta contábil dedicada — isso preserva a estrutura completa do relatório
 * conforme PRD (`01-contabilidad/relatorios-financeiros.md`).
 *
 * Numeração RT9 (rebuild #4): os `cuentaCodigos` foram remapeados ao plano v3
 * (`docs/nuevo-plan-de-cuentas-rt9.md`). Decisões do remap:
 * - Os custos logísticos de importação (gastos portuários, agente de cargas,
 *   operador logístico, despachante, frete internacional) CAPITALIZAM a
 *   `1.1.7.02` (RT17) — já não são contas de egresso `5.4/5.5/5.6/5.7`. Suas
 *   linhas ficam como template sem conta (`cuentaCodigos: []`); a saída de caixa
 *   real aparece no `getFlujoCaja` pela contrapartida do proveedor/banco, não
 *   por este config.
 * - Os tributos de nacionalização (DIE/Tasa/Arancel) também capitalizam; resta
 *   apenas a obrigação por pagar (`2.1.5.0x`), que é a que se mapeia aqui.
 * - Onde o plano v3 consolidou várias contas antigas numa só (ex.: serviços e
 *   gastos gerais → `5.3.1.05`), uma linha é dona do código e as demais ficam
 *   `[]` (consolidadas), preservando o ownership único.
 * Este config segue sem consumidor vivo (o flujo realizado é dirigido por
 *   movimentos bancários); serve de template para a projeção futura (FC-4).
 *
 * Convenção de mapeamento (ownership único):
 * - Cada `codigo` de conta contábil deve aparecer em NO MÁXIMO um `item` em toda
 *   a estrutura. Validado em runtime por `assertOwnershipUnico()`.
 * - Items com `cuentaCodigos: []` são intencionais: linhas do template sem conta
 *   dedicada (conceituais ou consolidadas em outro item canônico). Aparecem
 *   sempre em zero na matriz.
 * - Exceção: IMPUESTOS_NACIONALIZACION agrega conta EGRESO + conta PASIVO no
 *   mesmo item (decisão da diretoria: consolidar devengado + obrigação). Isso
 *   não conflita com a regra desde que cada código apareça em um único item.
 */

export type FlujoSeccionId =
  | "GASTOS_FIJOS"
  | "GASTOS_VARIABLES"
  | "IMPUESTOS_NACIONALIZACION"
  | "IMPUESTOS_VENTAS"
  | "INGRESOS"
  | "PRESTAMOS";

export type FlujoDireccion = "SALIDA" | "ENTRADA";

export type FlujoItem = {
  label: string;
  cuentaCodigos: string[];
};

export type FlujoSubseccion = {
  label: string;
  items: FlujoItem[];
};

export type FlujoSeccion = {
  id: FlujoSeccionId;
  label: string;
  direccion: FlujoDireccion;
  subsecciones: FlujoSubseccion[];
};

export const FLUJO_CAJA_ESTRUCTURA: readonly FlujoSeccion[] = [
  {
    id: "GASTOS_FIJOS",
    label: "Gastos Fijos",
    direccion: "SALIDA",
    subsecciones: [
      {
        label: "HONORÁRIOS ABDO",
        items: [
          // Pro-labore de dirección → Sueldos y Jornales (Administración).
          { label: "Honorários", cuentaCodigos: ["7.1.01"] },
          // Cargas sociales consolidadas en 7.1.03.
          { label: "Encargos Trabalhistas (80%)", cuentaCodigos: [] },
        ],
      },
      {
        label: "INFRAESTRUTURA",
        items: [
          { label: "Escritório / Coworking", cuentaCodigos: ["7.4.01"] },
          // Depósito en garantía: sin cuenta analítica dedicada en ULTRA (template).
          { label: "Depósito en garantía", cuentaCodigos: [] },
          // Cuota de activación: evento único sem conta dedicada.
          { label: "Cuota de activación", cuentaCodigos: [] },
          {
            label: "Serviços (luz, gás, água)",
            cuentaCodigos: ["7.5.99"],
          },
          // Seguros → 7.6 (consolidados en el template).
          { label: "Seguros", cuentaCodigos: [] },
        ],
      },
      {
        label: "SERVICIO TERCERO",
        items: [
          { label: "Contador", cuentaCodigos: ["7.2.01"] },
          { label: "Sistema para Facturación", cuentaCodigos: ["7.3.01"] },
          // Comunicaciones consolidadas en 5.3.1.05 (Servicios y Gastos Grales).
          { label: "Comunicações", cuentaCodigos: [] },
        ],
      },
    ],
  },
  {
    id: "GASTOS_VARIABLES",
    label: "Gastos Variables con Llegada de Productos",
    direccion: "SALIDA",
    subsecciones: [
      // Toda esta sección CAPITALIZA a 1.1.7.02 (Mercaderías en Tránsito) bajo
      // RT17 — ya no hay cuentas de egreso 5.4/5.5/5.6/5.7. Las líneas se
      // conservan como template; la salida de caja real aparece en el flujo
      // realizado por la contrapartida del proveedor/banco.
      {
        label: "GASTOS PORTUÁRIOS",
        items: [
          { label: "Terminal", cuentaCodigos: [] },
          { label: "Acarreo Nacional", cuentaCodigos: [] },
          { label: "Gastos en Origen", cuentaCodigos: [] },
          { label: "Gastos en Destino", cuentaCodigos: [] },
        ],
      },
      {
        label: "AGENTE DE CARGAS",
        items: [
          { label: "Agency Fee", cuentaCodigos: [] },
          { label: "Logistic Fee", cuentaCodigos: [] },
          { label: "Gate In", cuentaCodigos: [] },
          { label: "River Plate Toll", cuentaCodigos: [] },
          { label: "SIM Buenos Aires", cuentaCodigos: [] },
          { label: "THC", cuentaCodigos: [] },
          { label: "Admin Fee", cuentaCodigos: [] },
          { label: "Delivery Order", cuentaCodigos: [] },
          { label: "Equipment Condition", cuentaCodigos: [] },
          { label: "Manejo Documentación", cuentaCodigos: [] },
          { label: "Cargo Terminal", cuentaCodigos: [] },
        ],
      },
      {
        label: "OPERADOR LOGÍSTICO",
        items: [
          { label: "Transporte desde puerto", cuentaCodigos: [] },
          { label: "Devolución vacío", cuentaCodigos: [] },
          { label: "Utilización de Containera", cuentaCodigos: [] },
          { label: "Descarga + WMS IN", cuentaCodigos: [] },
          { label: "Etiquetagem", cuentaCodigos: [] },
          { label: "Armazenagem", cuentaCodigos: [] },
          { label: "Carga por Conteiner", cuentaCodigos: [] },
        ],
      },
      {
        label: "DESPACHANTE",
        items: [
          { label: "Gasto Operativo", cuentaCodigos: [] },
          { label: "Honorários", cuentaCodigos: [] },
          { label: "Canal", cuentaCodigos: [] },
        ],
      },
      {
        label: "FRETE",
        items: [
          { label: "Frete Marítimo", cuentaCodigos: [] },
          { label: "Seguro Marítimo", cuentaCodigos: [] },
        ],
      },
    ],
  },
  {
    id: "IMPUESTOS_NACIONALIZACION",
    label: "Impuestos al Nacionalizar",
    direccion: "SALIDA",
    subsecciones: [
      {
        label: "IMPUESTOS DE IMPORTAÇÃO",
        items: [
          // DIE/Tasa/Arancel capitalizan (RT17); queda sólo la obligación por
          // pagar 2.1.5.0x, que es la que mueve caja al cancelarse.
          { label: "Derecho de Importación (16%)", cuentaCodigos: ["2.1.4.4.01"] },
          { label: "Tasa Estadística (3%)", cuentaCodigos: ["2.1.4.4.02"] },
          { label: "Arancel SIM (0,5%)", cuentaCodigos: ["2.1.4.4.03"] },
          { label: "IVA Importación (21%)", cuentaCodigos: ["1.1.4.1.03"] },
          { label: "IVA Adicional (20%)", cuentaCodigos: ["1.1.4.1.04"] },
          { label: "Percepción IIBB (2,5%)", cuentaCodigos: ["1.1.4.2.01"] },
          { label: "Percepción Ganancias (6%)", cuentaCodigos: ["1.1.4.3.01"] },
        ],
      },
    ],
  },
  {
    id: "IMPUESTOS_VENTAS",
    label: "Impuestos sobre las Ventas",
    direccion: "SALIDA",
    subsecciones: [
      {
        label: "IMPUESTOS VENTAS",
        items: [
          { label: "IVA Ventas (21%)", cuentaCodigos: ["2.1.4.1.01"] },
          { label: "IIBB Ventas (2,5%)", cuentaCodigos: ["2.1.4.2.01"] },
          { label: "Ganancias por Pagar", cuentaCodigos: ["2.1.4.3.01"] },
        ],
      },
    ],
  },
  {
    id: "INGRESOS",
    label: "Ingresos",
    direccion: "ENTRADA",
    subsecciones: [
      {
        label: "VENTAS",
        items: [
          {
            label: "Ventas Neumáticos Nuevos",
            cuentaCodigos: ["4.1.01.01", "4.1.01.02", "4.1.01.03", "4.1.01.04", "4.1.01.09"],
          },
          // El plan ULTRA no separa "usados" (sin cuenta dedicada).
          { label: "Ventas Neumáticos Usados", cuentaCodigos: [] },
          { label: "Otros Ingresos", cuentaCodigos: ["4.3.02", "4.3.99"] },
        ],
      },
    ],
  },
  {
    id: "PRESTAMOS",
    label: "Préstamos e Financiamentos",
    direccion: "ENTRADA",
    subsecciones: [
      {
        label: "RECEBIMENTOS DE CAPITAL",
        items: [
          { label: "Aportes de Capital", cuentaCodigos: ["3.1.01", "3.1.02"] },
          // Préstamos nacen bajo 2.1.5.01.x / 2.2.2.01.x en runtime (sin código
          // canónico fijo); se exponen por su rama al consolidarse.
          { label: "Empréstimos Bancários CP", cuentaCodigos: [] },
          { label: "Empréstimos Exterior", cuentaCodigos: [] },
        ],
      },
      {
        label: "AMORTIZAÇÕES E JUROS",
        items: [
          { label: "Juros Pagos", cuentaCodigos: ["9.1.03"] },
          { label: "Comissões Bancárias", cuentaCodigos: ["9.5.01"] },
          { label: "Gastos Transferência Exterior", cuentaCodigos: ["9.5.02"] },
        ],
      },
    ],
  },
] as const;

/**
 * Valida a invariante de ownership único: cada `codigo` de conta deve aparecer
 * em no máximo UM `item` em toda `FLUJO_CAJA_ESTRUCTURA`. Sem isso, a agregação
 * em `getFlujoCaja()` conta o mesmo movimento múltiplas vezes em Total Salidas /
 * Total Ingresos. Lançar cedo é melhor do que silenciosamente inflar o fluxo.
 */
export function assertOwnershipUnico(): void {
  const donoPorCodigo = new Map<string, string>();
  for (const sec of FLUJO_CAJA_ESTRUCTURA) {
    for (const sub of sec.subsecciones) {
      for (const item of sub.items) {
        const ownerLabel = `${sec.id} / ${sub.label} / ${item.label}`;
        for (const codigo of item.cuentaCodigos) {
          const donoPrevio = donoPorCodigo.get(codigo);
          if (donoPrevio) {
            throw new Error(
              `flujo-caja-config: codigo "${codigo}" aparece em dois items: ` +
                `"${donoPrevio}" e "${ownerLabel}". Cada codigo deve ter ` +
                "ownership único para não duplicar na matriz.",
            );
          }
          donoPorCodigo.set(codigo, ownerLabel);
        }
      }
    }
  }
}

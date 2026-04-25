/**
 * Estrutura estática do Fluxo de Caixa, replicando o modelo do Excel da diretoria
 * (seções obrigatórias). Cada subitem do template aparece na matriz mesmo quando
 * não há conta contábil dedicada — isso preserva a estrutura completa do relatório
 * conforme PRD (`01-contabilidad/relatorios-financeiros.md`).
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
          { label: "Honorários", cuentaCodigos: ["5.1.1.01", "5.1.1.02"] },
          { label: "Encargos Trabalhistas (80%)", cuentaCodigos: ["5.1.2.01"] },
        ],
      },
      {
        label: "INFRAESTRUTURA",
        items: [
          { label: "Escritório / Coworking", cuentaCodigos: ["5.2.1.01"] },
          { label: "Depósito en garantía", cuentaCodigos: ["5.2.1.04"] },
          // Cuota de activación: evento único sem conta dedicada.
          { label: "Cuota de activación", cuentaCodigos: [] },
          {
            label: "Serviços (luz, gás, água)",
            cuentaCodigos: ["5.2.1.02"],
          },
          { label: "Seguros", cuentaCodigos: ["5.2.1.03"] },
        ],
      },
      {
        label: "SERVICIO TERCERO",
        items: [
          { label: "Contador", cuentaCodigos: ["5.3.1.03"] },
          { label: "Sistema para Facturación", cuentaCodigos: ["5.3.1.02"] },
          { label: "Comunicações", cuentaCodigos: ["5.3.1.01"] },
        ],
      },
    ],
  },
  {
    id: "GASTOS_VARIABLES",
    label: "Gastos Variables con Llegada de Productos",
    direccion: "SALIDA",
    subsecciones: [
      {
        label: "GASTOS PORTUÁRIOS",
        items: [
          { label: "Terminal", cuentaCodigos: ["5.4.1.01"] },
          // Acarreo/Gastos Origen/Gastos Destino: consolidados em 5.4.1.01.
          { label: "Acarreo Nacional", cuentaCodigos: [] },
          { label: "Gastos en Origen", cuentaCodigos: [] },
          { label: "Gastos en Destino", cuentaCodigos: [] },
        ],
      },
      {
        label: "AGENTE DE CARGAS",
        items: [
          // Agency Fee é owner canônico de 5.4.1.02 AGENTE DE CARGAS.
          // Demais 10 subitens são consolidados nessa conta (granularidade
          // não rastreada no momento; diretoria revisa como total agregado).
          { label: "Agency Fee", cuentaCodigos: ["5.4.1.02"] },
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
          { label: "Transporte desde puerto", cuentaCodigos: ["5.5.1.01"] },
          { label: "Devolución vacío", cuentaCodigos: ["5.5.1.04"] },
          // Utilización/Descarga+WMS/Etiquetagem: consolidados em Armazenagem.
          { label: "Utilización de Containera", cuentaCodigos: [] },
          { label: "Descarga + WMS IN", cuentaCodigos: [] },
          { label: "Etiquetagem", cuentaCodigos: [] },
          { label: "Armazenagem", cuentaCodigos: ["5.5.1.05"] },
          { label: "Carga por Conteiner", cuentaCodigos: ["5.5.1.03"] },
        ],
      },
      {
        label: "DESPACHANTE",
        items: [
          // Gasto Operativo / Canal: consolidados em Honorários.
          { label: "Gasto Operativo", cuentaCodigos: [] },
          { label: "Honorários", cuentaCodigos: ["5.6.1.01", "5.1.1.03"] },
          { label: "Canal", cuentaCodigos: [] },
        ],
      },
      {
        label: "FRETE",
        items: [
          { label: "Frete Marítimo", cuentaCodigos: ["5.5.1.02"] },
          { label: "Seguro Marítimo", cuentaCodigos: ["5.5.1.06"] },
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
          {
            label: "Derecho de Importación (16%)",
            cuentaCodigos: ["5.7.1.01", "2.1.5.01"],
          },
          {
            label: "Tasa Estadística (3%)",
            cuentaCodigos: ["5.7.1.02", "2.1.5.02"],
          },
          {
            label: "Arancel SIM (0,5%)",
            cuentaCodigos: ["5.7.1.03", "2.1.5.03"],
          },
          { label: "IVA Importación (21%)", cuentaCodigos: ["1.1.4.04"] },
          {
            label: "IVA Adicional (20%)",
            cuentaCodigos: ["1.1.4.05"],
          },
          {
            label: "Percepción IIBB (2,5%)",
            cuentaCodigos: ["1.1.4.06"],
          },
          {
            label: "Percepción Ganancias (6%)",
            cuentaCodigos: ["1.1.4.07"],
          },
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
          { label: "IVA Ventas (21%)", cuentaCodigos: ["2.1.3.01", "2.1.6.01"] },
          { label: "IIBB Ventas (2,5%)", cuentaCodigos: ["2.1.3.02"] },
          { label: "Ganancias por Pagar", cuentaCodigos: ["2.1.3.03"] },
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
            cuentaCodigos: ["4.1.1.01"],
          },
          {
            label: "Ventas Neumáticos Usados",
            cuentaCodigos: ["4.1.1.02"],
          },
          { label: "Otros Ingresos", cuentaCodigos: ["4.2.1.01", "4.2.1.02"] },
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
          { label: "Aportes de Capital", cuentaCodigos: ["3.1.1.01", "3.1.1.02"] },
          {
            label: "Empréstimos Bancários CP",
            cuentaCodigos: ["2.1.7.01", "2.1.7.02"],
          },
          {
            label: "Empréstimos Exterior",
            cuentaCodigos: ["2.1.7.05", "2.1.7.03"],
          },
        ],
      },
      {
        label: "AMORTIZAÇÕES E JUROS",
        items: [
          { label: "Juros Pagos", cuentaCodigos: ["5.8.2.02"] },
          { label: "Comissões Bancárias", cuentaCodigos: ["5.8.1.01"] },
          {
            label: "Gastos Transferência Exterior",
            cuentaCodigos: ["5.8.1.02"],
          },
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
                `ownership único para não duplicar na matriz.`,
            );
          }
          donoPorCodigo.set(codigo, ownerLabel);
        }
      }
    }
  }
}

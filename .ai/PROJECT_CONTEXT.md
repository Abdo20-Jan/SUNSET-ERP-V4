# PROJECT_CONTEXT.md — SUNSET ERP

## Contexto do produto

O SUNSET ERP é o sistema de gestão da Sunset Tires Argentina, com operação orientada a importação, distribuição, vendas B2B, pneus, estoque por despacho/container, financeiro, tesouraria, contabilidade, Comex e BI.

## Direção de UI/UX

O ERP deve ser:
- desktop-first
- denso
- corporativo
- baixo brilho
- visual NetSuite/SAP Business One/Excel
- sem cara de app genérico gerado por IA
- centrado em tabelas, abas internas, filtros, worklists, record pages, janelas flutuantes e drill-down

## Padrões obrigatórios

- Top navigation textual e hierárquica.
- Sem sidebar principal no desktop.
- Botões com texto completo.
- Ícones apenas auxiliares.
- Floating Work Window central para formulários contextuais.
- Tabelas densas com linhas de 32px, fonte 13px, zebra sutil, colunas congeladas, resize, reorder, exportação.
- EntityLink com chevron para entidades relevantes.
- InternalTabs para registros abertos.
- PermissionGate no UI e autorização real no backend.
- Auditoria antes/depois, usuário, data/hora, motivo e origem.
- BI concentra KPIs; módulos operacionais focam execução.

## Regras de negócio consolidadas

- Finanças programa/controla.
- Tesouraria executa pagamentos, recebimentos, baixas, bancos e conciliação.
- Entregas pertencem a Inventario > Logística.
- Comercial visualiza status logístico, mas não gere entrega.
- Vendedor não vê custo/margem salvo permissão específica.
- Moeda original deve ser preservada em transações.
- ARS/USD devem ser visualizados conforme permissão.
- Comex preserva motor de rateio atual; não reimplementar sem aprovação.
- Custo contábil exclui IVA.
- Custo gerencial inclui todos os gastos, inclusive recuperáveis, conforme regra gerencial definida.
- Atraso > 20 dias pode bloquear novas vendas conforme regra por cliente.

## PRs recentes conhecidos

- PR-019: Pedido Venta Record Page migrado para PAGE-STD-02; aberto como GitHub PR #346 contra main; checks verdes; 1 commit lógico.
- PR-020: Comex Embarques Worklist implementado em branch pr-020-comex-worklist; validado verde; ainda não commitado no histórico lembrado.

## Objetivo do autopilot

Gerar uma linha paralela comparativa, em cópia do ERP, para evolução acelerada por agentes:
- PR-001 até PR-N
- cada PR pequeno
- validação automática
- merge automático quando checks verdes
- contexto compactado em Markdown/Obsidian
- roadmap vivo

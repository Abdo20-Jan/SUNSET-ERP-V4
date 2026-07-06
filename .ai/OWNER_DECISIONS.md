# OWNER_DECISIONS.md — Decisões do dono

## Decisões assumidas para o modo autopilot comparativo

1. Este ambiente é uma cópia/laboratório, não produção.
2. O agente pode planejar PR-001 até PR-N.
3. O agente pode executar PRs em sequência.
4. O agente pode abrir PRs automaticamente.
5. O agente pode fazer merge automático apenas se:
   - branch não for main
   - validações locais passarem
   - GitHub checks passarem ou não existirem e ALLOW_MERGE_WITHOUT_CHECKS=true estiver configurado
6. O agente deve atualizar Obsidian/Graphy após cada PR.
7. O agente deve compactar o contexto para reduzir tokens.
8. O agente deve parar se houver risco fiscal/contábil, segredo, erro desconhecido ou mudança destrutiva.

## Decisões técnicas recomendadas

- Permissões: manter `Role` existente e adicionar flags/perfis progressivamente.
- AuditLog: estender com motivo/origen/documentoId/ip em PR próprio.
- Navegação: introduzir top-nav atrás de feature flag antes de remover sidebar.
- Páginas ausentes: criar PRs próprios por página.
- CxC/CxP: preferir realocação funcional para Finanças mantendo compatibilidade de rota antiga quando possível.
- Comex custos/rateio: não tocar UI de custos sem golden files definidos.

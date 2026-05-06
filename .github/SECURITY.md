# Política de Segurança

## Versões suportadas

Apenas a branch `main` recebe correções de segurança. Não há LTS para versões anteriores deste projeto.

## Reporte de vulnerabilidade

**Não abra issue público para vulnerabilidades.** Use um dos canais privados:

1. **GitHub Security Advisories** (preferencial): <https://github.com/Abdo20-Jan/SUNSET-ERP-V4/security/advisories/new>
2. **E-mail**: <abdolatifnasser@gmail.com> com assunto `[SECURITY] sunset-erp-v4: <título curto>`

Inclua, se possível:

- Descrição da falha e impacto estimado.
- Passos para reproduzir, com versão/commit afetado.
- PoC (proof-of-concept) mínimo, se houver.
- Sua expectativa de divulgação (privada/pública, com ou sem crédito).

## Tempo de resposta

| Severidade | Acknowledge | Triagem inicial | Fix-target |
| --- | --- | --- | --- |
| Critical | ≤ 24h | ≤ 72h | ≤ 7 dias |
| High | ≤ 48h | ≤ 5 dias | ≤ 14 dias |
| Medium / Low | ≤ 7 dias | ≤ 14 dias | conforme roadmap |

A escala segue [Codacy SRM](https://app.codacy.com/p/871357) e CVE base score do projeto.

## Escopo

Em escopo: `src/`, `prisma/`, `.github/workflows/`, configurações de runtime, dependências diretas listadas em `package.json`.

Fora de escopo: builds locais não publicados, dados de teste em `prisma/seed*.ts`, ambientes de desenvolvimento de terceiros.

## Coordenação

Após correção em produção, podemos publicar GitHub Security Advisory com crédito ao reporter (opt-in). CVEs são solicitados quando aplicável via [GitHub CNA](https://github.com/security-advisories).

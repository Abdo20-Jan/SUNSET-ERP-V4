# VALIDATION_CHECKLIST.md

## Antes de começar

- [ ] Estou na raiz do repositório.
- [ ] `git status` limpo.
- [ ] Branch atual não é `main`.
- [ ] `main` está atualizado.
- [ ] Escopo do PR está definido.

## Validação local

Rodar o que existir:
- [ ] install/check dependency lock
- [ ] lint
- [ ] typecheck
- [ ] unit tests
- [ ] integration tests
- [ ] build
- [ ] e2e se aplicável

## Segurança

- [ ] Sem `.env`.
- [ ] Sem secrets.
- [ ] Sem tokens.
- [ ] Sem dumps.
- [ ] Sem credenciais.
- [ ] Sem dados reais sensíveis.
- [ ] Sem force push.
- [ ] Sem comandos destrutivos.

## Produto

- [ ] Preserva backend/motores existentes.
- [ ] Respeita permissões.
- [ ] Respeita auditoria.
- [ ] Respeita densidade UI.
- [ ] Não cria arquitetura paralela.
- [ ] Não altera módulo fora do escopo.

## PR

- [ ] Descrição completa.
- [ ] Validações documentadas.
- [ ] Riscos documentados.
- [ ] Rollback descrito.
- [ ] Contexto Obsidian atualizado.

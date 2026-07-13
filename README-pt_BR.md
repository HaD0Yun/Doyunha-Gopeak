# GoPeak

🌐 **Idiomas**: [English](README.md) | [한국어](README-ko.md) | [日本語](README-ja.md) | [Deutsch](README-de.md) | **Português** | [简体中文](README-zh.md)

> Canonical docs: [README.md](README.md). This localized page is a concise overview and may lag behind the English source.

**GoPeak é um servidor MCP para Godot que permite que assistentes de IA executem, inspecionem, modifiquem e depurem projetos reais.**

## Início rápido

### Requisitos
- Godot 4.x
- Bun 1.3.3+
- Cliente compatível com MCP

### Executar
```bash
curl -fLO https://github.com/HaD0Yun/Doyunha-Gopeak/releases/download/v2.3.9/gopeak-2.3.9.tgz
curl -fLO https://github.com/HaD0Yun/Doyunha-Gopeak/releases/download/v2.3.9/gopeak-2.3.9.tgz.sha256
if command -v sha256sum >/dev/null 2>&1; then sha256sum -c gopeak-2.3.9.tgz.sha256; else shasum -a 256 -c gopeak-2.3.9.tgz.sha256; fi
bun add -g "$PWD/gopeak-2.3.9.tgz"
gopeak
```

Após a verificação do checksum, o Bun instala o arquivo de release globalmente. No Linux, usa-se `sha256sum`; no macOS, `shasum`.

As opções antigas `--dir`, `--godot` e `--configure` continuam aceitas com aviso durante a série `2.3.x` e serão removidas em `3.0.0`. Consulte a [política de migração](docs/migration-policy.md#bun-distribution-migration) para o mapeamento do local de instalação, caminho do Godot e configuração do cliente.

## Resumo
- Ferramentas principais confiáveis + grupos dinâmicos ativados sob demanda
- Cobre cenas, scripts, recursos, runtime, LSP, DAP e automação de entrada
- Pensado para fluxos de IA baseados no estado real do projeto Godot

## Documentação detalhada
- Documentação canônica: [README.md](README.md)
- Mapa da documentação: [docs/README.md](docs/README.md)
- Arquitetura: [docs/architecture.md](docs/architecture.md)
- Processo de release: [docs/release-process.md](docs/release-process.md)

## Observação
- O README em inglês é a fonte oficial.
- Esta página localizada é um resumo e pode ficar desatualizada em relação ao inglês.

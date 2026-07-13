# GoPeak

🌐 **Sprachen**: [English](README.md) | [한국어](README-ko.md) | [日本語](README-ja.md) | **Deutsch** | [Português](README-pt_BR.md) | [简体中文](README-zh.md)

> Canonical docs: [README.md](README.md). This localized page is a concise overview and may lag behind the English source.

**GoPeak ist ein MCP-Server für Godot, mit dem KI-Assistenten reale Projekte ausführen, untersuchen, ändern und debuggen können.**

## Schnellstart

### Anforderungen
- Godot 4.x
- Bun 1.3.3+
- MCP-kompatibler Client

### Starten
```bash
curl -fLO https://github.com/HaD0Yun/Doyunha-Gopeak/releases/download/v2.3.9/gopeak-2.3.9.tgz
curl -fLO https://github.com/HaD0Yun/Doyunha-Gopeak/releases/download/v2.3.9/gopeak-2.3.9.tgz.sha256
if command -v sha256sum >/dev/null 2>&1; then sha256sum -c gopeak-2.3.9.tgz.sha256; else shasum -a 256 -c gopeak-2.3.9.tgz.sha256; fi
bun add -g "$PWD/gopeak-2.3.9.tgz"
gopeak
```

Erst nach erfolgreicher Prüfsummenprüfung installiert Bun das Release-Archiv global. Linux verwendet `sha256sum`, macOS `shasum`.

Die alten Installer-Optionen `--dir`, `--godot` und `--configure` bleiben während `2.3.x` mit Warnhinweis kompatibel und sollen in `3.0.0` entfernt werden. Die Zuordnung zum neuen Installationsort, Godot-Pfad und zur Client-Konfiguration steht in der [Migrationsrichtlinie](docs/migration-policy.md#bun-distribution-migration).

## Kurzüberblick
- Vertrauenswürdige Kern-Tools + dynamische Tool-Gruppen bei Bedarf
- Unterstützt Szenen, Skripte, Ressourcen, Runtime-Inspektion, LSP, DAP und Input-Automation
- Für KI-Workflows, die auf echtem Godot-Projektzustand basieren

## Weitere Dokumentation
- Vollständige Dokumentation: [README.md](README.md)
- Dokumentationsübersicht: [docs/README.md](docs/README.md)
- Architektur: [docs/architecture.md](docs/architecture.md)
- Release-Prozess: [docs/release-process.md](docs/release-process.md)

## Hinweis
- Die englische README ist die maßgebliche Quelle.
- Diese lokalisierte Seite ist nur eine Kurzfassung und kann gegenüber der englischen Version zurückliegen.

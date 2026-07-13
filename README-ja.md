# GoPeak

🌐 **言語**: [English](README.md) | [한국어](README-ko.md) | **日本語** | [Deutsch](README-de.md) | [Português](README-pt_BR.md) | [简体中文](README-zh.md)

> Canonical docs: [README.md](README.md). This localized page is a concise overview and may lag behind the English source.

**GoPeak は Godot 向けの MCP サーバーで、AI アシスタントが実際のプロジェクトを実行・調査・変更・デバッグできるようにします。**

## クイックスタート

### 要件
- Godot 4.x
- Bun 1.3.3+
- MCP 対応クライアント

### 実行
```bash
curl -fLO https://github.com/HaD0Yun/Doyunha-Gopeak/releases/download/v2.3.9/gopeak-2.3.9.tgz
curl -fLO https://github.com/HaD0Yun/Doyunha-Gopeak/releases/download/v2.3.9/gopeak-2.3.9.tgz.sha256
if command -v sha256sum >/dev/null 2>&1; then sha256sum -c gopeak-2.3.9.tgz.sha256; else shasum -a 256 -c gopeak-2.3.9.tgz.sha256; fi
bun add -g "$PWD/gopeak-2.3.9.tgz"
gopeak
```

チェックサムが一致した後、Bun がリリースファイルをグローバルにインストールします。Linux では `sha256sum`、macOS では `shasum` を使用します。

旧インストーラーの `--dir`、`--godot`、`--configure` は `2.3.x` の間は警告付きで互換性が保たれ、`3.0.0` で削除される予定です。新しいインストール先、Godot パス、クライアント設定への対応は[移行ポリシー](docs/migration-policy.md#bun-distribution-migration)を参照してください。

## 要点
- 信頼できる基本ツール + 必要時に有効化される動的ツールグループ
- シーン / スクリプト / リソース / ランタイム / LSP / DAP / 入力自動化をカバー
- 実際の Godot プロジェクト状態に基づく AI ワークフロー

## 詳細ドキュメント
- 正式ドキュメント: [README.md](README.md)
- ドキュメント一覧: [docs/README.md](docs/README.md)
- アーキテクチャ: [docs/architecture.md](docs/architecture.md)
- リリース手順: [docs/release-process.md](docs/release-process.md)

## メモ
- 英語版 README が唯一の正本です。
- この翻訳ページは概要版であり、英語版より更新が遅れる場合があります。

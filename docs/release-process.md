# Release Process

GoPeak releases use a bump → verify → package → tag → attest → publish flow. Each GitHub Release carries a versioned Bun-installable tarball and its SHA-256 checksum. The archive contains the bundled runtime and has no install-time registry dependencies.

## 1) Bump version

Use the version sync script to update `package.json` and `server.json`:

```bash
bun run version:bump -- patch
# or: bun run version:bump -- minor
# or: bun run version:bump -- 2.3.9
```

Preview without writing:

```bash
bun run version:bump -- patch --dry-run
```

Then update the versioned release filenames and URLs in the current README, localized quick starts, website, and release notes. All of those references must match the new version before tagging.

## 2) Verify locally

Run the release checks before packaging:

```bash
bun ci
bun run ci
bun run test:dynamic-groups
bun run test:integration
bun run test:setup
bun run test:docs
bun run test:distribution
```

## 3) Build the release assets

```bash
bun run release:pack
```

For version `X.Y.Z`, the packaging task must create both files:

- `dist/gopeak-X.Y.Z.tgz`
- `dist/gopeak-X.Y.Z.tgz.sha256`

Verify the checksum on Linux or macOS before tagging:

```bash
if command -v sha256sum >/dev/null 2>&1; then
  (cd dist && sha256sum -c gopeak-X.Y.Z.tgz.sha256)
else
  (cd dist && shasum -a 256 -c gopeak-X.Y.Z.tgz.sha256)
fi
```

The archive must install with `bun add -g "$PWD/dist/gopeak-X.Y.Z.tgz"` and expose both `gopeak` and `godot-mcp`. Use an absolute path because Bun 1.3.3 resolves a relative global tarball path from the wrong working directory. Installation must not contact the npm registry: the tarball contains the bundled runtime and its release package metadata has no runtime dependency ranges. `bun run test:packaging` checks the archive and an isolated registry-blocked global install of both binaries. `bun run test:distribution` adds installer and updater behavior. `bun run test:metadata` checks MCP startup against the built CLI; before publishing, also exercise the MCP handshake through an installed global binary.

## 4) Commit and tag

```bash
git add package.json server.json README.md CHANGELOG.md
# include the packaging script and other synchronized release files
git commit -m "chore(release): vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

The tag must exactly match the versions in `package.json` and `server.json`.

## 5) Publish and verify the GitHub Release

The tag-triggered release workflow builds and verifies the project, creates a GitHub artifact attestation for the tarball, then uploads the tarball and checksum to the matching GitHub Release. Confirm both assets are present and test installation from the public asset URL:

```bash
curl -fLO https://github.com/HaD0Yun/Doyunha-Gopeak/releases/download/vX.Y.Z/gopeak-X.Y.Z.tgz
curl -fLO https://github.com/HaD0Yun/Doyunha-Gopeak/releases/download/vX.Y.Z/gopeak-X.Y.Z.tgz.sha256
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum -c gopeak-X.Y.Z.tgz.sha256
else
  shasum -a 256 -c gopeak-X.Y.Z.tgz.sha256
fi
bun add -g "$PWD/gopeak-X.Y.Z.tgz"
gopeak version
```

SHA-256 proves that the downloaded bytes match the release checksum. The attestation separately proves that GitHub Actions built those bytes for this repository. With GitHub CLI installed and authenticated, verify the downloaded archive before installation:

```bash
gh attestation verify gopeak-X.Y.Z.tgz --repo HaD0Yun/Doyunha-Gopeak
```

The shell installer performs the SHA-256 check automatically; attestation verification is a separate release-review step because the installer does not require GitHub CLI or GitHub authentication.

## Notes

- Keep release changes focused on synchronized metadata, release notes, packaging, and verification.
- `server.json` describes the GitHub repository and installation website; an ordinary GitHub tarball is not represented as an MCP Registry package.
- Do not upload an archive until its checksum, attestation, installed binaries, CLI version, and MCP startup have been verified.
- Publishing and installation require no npm credentials, and installing the release must not contact the npm registry.
- The Godot addon installers are separate from the GoPeak CLI release and remain documented in `README.md`.

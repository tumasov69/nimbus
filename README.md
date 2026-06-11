# Nimbus — Minecraft Launcher

A modern, lightweight Minecraft launcher built with **Tauri 2 + Rust + React**.

Современный лёгкий лаунчер Minecraft.

## Features

- **Instances** — isolated profiles with their own mods, worlds and settings; shared assets/libraries are not duplicated
- **Mod loaders** — Vanilla, Fabric, Quilt, Forge, NeoForge (versions fetched automatically)
- **Modrinth** — search & install mods (with automatic dependencies), modpacks (.mrpack), resource packs and shaders; update mods and modpacks
- **Accounts** — Microsoft (licensed) and offline; in-app skin change for Microsoft accounts
- **Folders, cloning, export/import** of instances; worlds backup; server list
- **No Java needed** — the required JRE is downloaded automatically
- **10 languages**, light / dark / OLED / Mica themes
- **Auto-updates** signed with minisign
- **Optimized** — Rust backend, parallel downloads, ~10 MB binary, low memory use

## Download

Windows installers are published on the
[Releases page](https://github.com/tumasov69/nimbus/releases/latest).

## Code signing

Free code signing for the Windows builds is provided by the
[SignPath Foundation](https://signpath.org/) (certificate by SignPath Foundation),
with a free code signing certificate from [SignPath.io](https://signpath.io/).

## Development

```bash
npm install
npm run tauri dev      # run in dev mode
npm run tauri build    # build installers (nsis/msi)
```

## Structure

- `src/` — frontend (React + TypeScript + Tailwind CSS v4)
- `src-tauri/src/commands/` — backend commands: game launch, instances, Modrinth, accounts
- Minecraft launching via the [lyceris](https://github.com/BatuhanAksoyy/lyceris) crate

## Releases & auto-update

Releases are built by GitHub Actions on a `v*` tag (see `.github/workflows/release.yml`).
The updater manifest (`latest.json`) is signed with minisign; the public key lives
in `src-tauri/tauri.conf.json`. The private signing key and password are stored only
as GitHub Actions secrets — never in this repository.

To cut a release: bump `version` in `src-tauri/tauri.conf.json`, then push a tag
`vX.Y.Z`. CI builds, signs and publishes the release, keeping only the latest.

## Data location

Stored in `%APPDATA%/com.qqqex.nimbus`:

- `game/` — shared assets, libraries, versions, JRE
- `instances/<id>/` — per-instance files (mods, worlds, configs)
- `settings.json`, `instances.json`, `accounts.json` (Microsoft tokens encrypted via Windows DPAPI)

## License

[MIT](LICENSE) © tumasov69

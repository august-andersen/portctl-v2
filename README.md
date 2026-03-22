# portctl

[![GitHub Release](https://img.shields.io/github/v/release/august-andersen/portctl?display_name=tag)](https://github.com/august-andersen/portctl/releases)
[![GitHub License](https://img.shields.io/github/license/august-andersen/portctl)](https://github.com/august-andersen/portctl/blob/main/LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/august-andersen/portctl?style=social)](https://github.com/august-andersen/portctl/stargazers)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/august-andersen/portctl)](https://github.com/august-andersen/portctl/commits/main)

Local-only macOS dashboard for seeing what is listening on your ports, moving processes between ports, and reserving the ports you always want kept free.

![portctl dashboard preview](preview-image.png)

## Features

- Background daemon with a localhost-only dashboard at `127.0.0.1`
- Global `portctl` CLI for start, stop, restart, status, open, and uninstall
- 1-second polling of listening TCP ports with `lsof` and `ps`
- Card and table views for process names, PIDs, uptime, CPU, memory, tags, and status
- Kill, suspend, resume, and restart-on-a-new-port actions from the UI
- Reservation system that auto-migrates matching processes back to their preferred ports
- Blocked ports that are enforced automatically
- Pinned cards for ports you want visible even when nothing is running
- In-memory log capture for processes that portctl restarts or launches
- Dark and light themes with settings persisted in `~/.portctl/config.json`

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/august-andersen/portctl/main/install.sh | bash
portctl start
portctl open
```

The install script clones the repo into `~/.portctl/app`, installs dependencies, builds the client and server bundles, and links a global `portctl` command.

## CLI Reference

| Command | Description |
| --- | --- |
| `portctl start` | Start the background daemon. If it is already running, print the dashboard URL and exit. |
| `portctl stop` | Stop the daemon gracefully. |
| `portctl restart` | Stop and start the daemon again. |
| `portctl status` | Print whether the daemon is running, its PID, uptime, and dashboard URL. |
| `portctl open` | Open the dashboard in the default macOS browser. |
| `portctl uninstall` | Remove the daemon, runtime files, logs, config, and CLI symlink after confirmation. |

## Configuration

portctl stores all persistent state in `~/.portctl/config.json`. The file is created automatically on first start and backed up to `~/.portctl/.config.json.bak` before every write.

Example structure:

```json
{
  "version": 1,
  "settings": {
    "dashboardPort": 47777,
    "pollingInterval": 1000,
    "defaultView": "card",
    "theme": "dark",
    "cardClickBehavior": "openBrowser",
    "logBufferSize": 10000
  },
  "reservations": [],
  "blockedPorts": [],
  "pinnedPorts": [],
  "tags": {},
  "cardOrder": [],
  "customRestartCommands": {}
}
```

## Port Reservations

Reservations are the feature that makes portctl feel smart rather than reactive.

1. Start a service normally.
2. Move it to the port you actually want.
3. Open the card menu and choose `Reserve port`.
4. Keep the auto-detected matcher, or switch to process name, working directory, or regex.
5. The next time that service appears on the wrong port, portctl will move it back.

If a non-reserved process is occupying the reserved port, portctl will clear the way before migrating the reserved process. If two reservations conflict with each other, portctl raises a visible error instead of guessing.

## Development

Requirements:

- macOS
- Node.js 20+
- `lsof`, `ps`, and other standard macOS process tools

Install and run locally:

```bash
npm install
npm run build
node bin/portctl.js start
```

During UI development, run the server and Vite side by side:

```bash
npm run dev
```

That starts:

- the API server on the configured dashboard port, default `47777`
- the Vite dev server on `http://127.0.0.1:5174`

Project layout:

```text
bin/            CLI entry point
client/         React dashboard
server/         daemon, discovery, actions, routes, config
shared/         shared TypeScript contracts
docs/           preview assets for GitHub
```

## Uninstall

```bash
portctl uninstall
```

Manual cleanup if needed:

```bash
rm -rf ~/.portctl
rm -f /usr/local/bin/portctl /opt/homebrew/bin/portctl ~/.local/bin/portctl
```

## License

MIT. See [LICENSE](LICENSE).

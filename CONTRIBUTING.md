# Contributing to signalk-windy-apiv2

Contributions are welcome. This document covers the basics for getting started.

## Reporting Bugs

Open an issue at [GitHub Issues](https://github.com/Peter-Petrik/signalk-windy-apiv2/issues) with:

- Signal K server version and Node.js version
- Plugin version
- Steps to reproduce
- Relevant log output (redact Station Password and API Key before posting)

To capture plugin logs:

```bash
journalctl -u signalk-server -n 100 --no-pager | grep "signalk-windy-apiv2"
```

## Development Setup

The plugin is a single-file Node.js module (`index.js`) with one external dependency (`axios`).

### Local Testing

1. Clone the repository.
2. Run `npm install` to install dependencies.
3. Link the plugin to a local Signal K server for testing:

```bash
cd signalk-windy-apiv2
npm link
cd ~/.signalk
npm link signalk-windy-apiv2
```

4. Restart the Signal K server. The plugin will appear in **Server > Plugin Config**.
5. Enable debug logging in the Signal K admin UI under **Server > Server Log** to see detailed plugin output.

### Syntax Check

```bash
npm test
```

This runs `node --check index.js` to validate syntax.

## Pull Requests

- One logical change per PR.
- Include a clear description of what the change does and why.
- Update `CHANGELOG.md` under an `[Unreleased]` section with a summary of the change.
- Test against a running Signal K server before submitting. If live Windy API testing is not possible, note that in the PR description.

## Code Style

- Comments should explain what the code does and why, not just what. Assume the reader is not familiar with the codebase.
- Use the Signal K plugin API for logging: `app.debug()` for diagnostic info, `app.error()` for error conditions, `app.setPluginStatus()` for dashboard display, `app.setPluginError()` for error display.
- Follow [Keep a Changelog](https://keepachangelog.com/) format for changelog entries.
- Versioning follows [SemVer](https://semver.org/): major for breaking changes, minor for features, patch for fixes.

## License

By contributing, contributions are licensed under the [Apache-2.0 License](LICENSE).

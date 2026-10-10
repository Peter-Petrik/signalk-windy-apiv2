# Contributing to signalk-windy-apiv2

Contributions are welcome. This document covers the basics for getting started.

## Reporting Bugs

Open an issue at [GitHub Issues](https://github.com/Peter-Petrik/signalk-windy-apiv2/issues) with:

- Signal K server version and Node.js version
- Plugin version
- Steps to reproduce
- Relevant log output (redact Station Password and API Key before posting)

To capture plugin logs on an installation created with `signalk-server-setup`:

```bash
journalctl -u signalk -n 100 --no-pager | grep "signalk-windy-apiv2"
```

## Development Setup

The plugin is plain JavaScript with no build step and one runtime dependency, `axios`.

| Path | Contents |
| :--- | :--- |
| `index.js` | The plugin: configuration form, subscriptions, movement guard, the two requests to Windy, scheduling and state. |
| `test/` | Automated tests. |
| `test-support/harness.js` | The mock Signal K `app` object, the interception of the two requests, and the controlled clock that the tests share. |
| `.github/workflows/signalk-ci.yml` | Runs the Signal K plugin CI on every push. |
| `.github/workflows/publish.yml` | Publishes a tagged version to npm and creates the GitHub Release. |

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

4. Restart the Signal K server. The plugin appears in **Apps & Plugins > Configuration**.
5. Switch on **Enable debug** for the plugin on that page to see detailed plugin output in **Server > Server Logs**.

### Automated Tests

```bash
npm test
```

This checks the syntax of `index.js` and runs the test suite with the Node.js built-in test runner. No extra packages are needed.

The tests drive the plugin the way the Signal K server does: through the `app` object, through `start()` and `stop()`, and through the passage of time. The two requests to Windy are intercepted, so no test contacts Windy, and the clock is controlled, so a five-minute reporting cycle takes no time.

| File | Covers |
| :--- | :--- |
| `test/reporting.test.js` | What is sent, in which order and when; the movement guard |
| `test/conversions.test.js` | Unit conversion, missing values, the gust rule, path overrides |
| `test/errors.test.js` | Rate limits, rejected requests, network errors, dashboard messages |
| `test/state.test.js` | The state file and restarts |
| `test/schema.test.js` | The configuration form |
| `test/package.test.js` | App Store metadata in `package.json` and the format of `CHANGELOG.md` |

A change in behaviour needs a test that fails without it.

## Pull Requests

- One logical change per PR.
- Include a clear description of what the change does and why.
- Add an entry to `CHANGELOG.md` under the version being prepared. The file must not contain an `[Unreleased]` section when a version is tagged: the publish workflow copies the section for the tagged version into the GitHub Release, and the Signal K App Store shows that text.
- Run `npm test`, and test against a running Signal K server before submitting. If live Windy API testing is not possible, note that in the PR description.

## Releases

A release is a commit that sets the version in `package.json` and in the header of `index.js` and adds the matching `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md`, followed by a tag `vx.y.z`. Pushing the tag runs the publish workflow, which runs the tests, checks that the tag matches `package.json`, creates the GitHub Release from the changelog section, and publishes to npm.

## Code Style

- Comments should explain what the code does and why, not just what. Assume the reader is not familiar with the codebase.
- Use the Signal K plugin API for logging: `app.debug()` for diagnostic info, `app.error()` for error conditions, `app.setPluginStatus()` for dashboard display, `app.setPluginError()` for error display.
- Follow [Keep a Changelog](https://keepachangelog.com/) format for changelog entries.
- Versioning follows [SemVer](https://semver.org/): major for breaking changes, minor for features, patch for fixes.

## License

By contributing, contributions are licensed under the [GNU General Public License v3.0 or later](LICENSE).

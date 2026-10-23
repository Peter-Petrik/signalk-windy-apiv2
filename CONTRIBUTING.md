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
| `index.js` | The plugin's lifecycle and schedule: start, stop, subscriptions, the countdown, and the order of the two requests in a reporting cycle. |
| `lib/schema.js` | The configuration form, and the reading of a saved configuration with its defaults. |
| `lib/readings.js` | The latest value of every subscribed path and the time it arrived. |
| `lib/samples.js` | The values of the wind paths over the reporting interval: the mean, the highest value and the mean direction. |
| `lib/convert.js` | Readings to observation fields: age check, unit conversion, the gust rule, range checks. |
| `lib/movement.js` | Distance from the last position sent to Windy. |
| `lib/state.js` | Loading and saving `state.json`. |
| `lib/windy.js` | The two requests to Windy and the meaning of each answer. |
| `test/` | Automated tests. |
| `test-support/harness.js` | The mock Signal K `app` object, the interception of the two requests, and the controlled clock that the tests share. |
| `integration/server-check.js` | A check against a running Signal K server, run by the plugin CI. |
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
5. Switch on **Enable debug log** for the plugin on that page to see detailed plugin output in **Server > Server Logs**.

### Automated Tests

```bash
npm test
```

This checks the syntax of `index.js` and runs the test suite with the Node.js built-in test runner. No extra packages are needed.

The tests drive the plugin the way the Signal K server does: through the `app` object, through `start()` and `stop()`, and through the passage of time. The two requests to Windy are intercepted, so no test contacts Windy, and the clock is controlled, so a five-minute reporting cycle takes no time. The harness delivers values the way the server's subscriptions do: the value held for each path at the moment of subscribing, then one delivery per update. By default it repeats every value once a minute, as working sensors do; `createEnv({ live: false })` gives sensors that have stopped. `env.emit(path, value, source)` delivers a value from a named source. `env.dashboard()` returns the dashboard line and its Last Error, kept the way the server keeps them.

| File | Covers |
| :--- | :--- |
| `test/reporting.test.js` | What is sent, in which order and when; the movement guard |
| `test/conversions.test.js` | Unit conversion, missing values, the gust rule, path overrides, the dew point |
| `test/robustness.test.js` | Values that are not numbers, out-of-range readings, positions without coordinates, a cycle that fails |
| `test/settings.test.js` | Zero values, defaults without the form, the share option, Force GPS Updates, station elevation, the humidity path, the position precision |
| `test/stale.test.js` | Stale readings, paths the server declares timed out, values held by the server at start, the no-data line, wind and gust from the same samples, the wind window across failed and delayed reports |
| `test/lifecycle.test.js` | Starting without credentials, stopping during a request, release of subscriptions |
| `test/errors.test.js` | Rate limits, rejected requests, network errors, dashboard messages |
| `test/dashboard.test.js` | How long an error stays on the dashboard and what becomes its Last Error, Windy out of reach, the time and the countdown |
| `test/station-record.test.js` | The station record sent again after a change of the settings it is built from |
| `test/wind.test.js` | The wind over the reporting interval: the mean, the gust and the mean direction; a clock set back; wind paths that cannot give the wind Windy expects |
| `test/clock.test.js` | The system clock compared with GNSS time |
| `test/state.test.js` | The state file and restarts |
| `test/schema.test.js` | The configuration form |
| `test/package.test.js` | App Store metadata in `package.json` and the format of `CHANGELOG.md` |

A change in behaviour needs a test that fails without it.

### Integration Check

```bash
SIGNALK_URL=http://localhost:3000 npm run test:integration
```

This runs `integration/server-check.js` against a running Signal K server that has the plugin installed and enabled with an empty configuration. It confirms that the server loads the plugin and that the plugin reports itself as not configured. The plugin CI runs it against a real server on every push. The check saves no configuration and must stay that way: with credentials the plugin sends requests to Windy.

## Pull Requests

- One logical change per PR.
- Include a clear description of what the change does and why.
- Add an entry to `CHANGELOG.md` under the version being prepared. The file must not contain an `[Unreleased]` section when a version is tagged: the publish workflow copies the section for the tagged version into the GitHub Release, and the Signal K App Store shows that text.
- Run `npm test`, and test against a running Signal K server before submitting. If live Windy API testing is not possible, note that in the PR description.

## Releases

A release is a commit that sets the version in `package.json`, in `package-lock.json` (the top-level `version` and `packages[""].version`) and in the header of `index.js`, and adds the matching `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md` with its comparison link at the end of the file, followed by a tag `vx.y.z`. Pushing the tag runs the publish workflow, which runs the tests, checks that the tag matches `package.json`, creates the GitHub Release from the changelog section, and publishes to npm.

## Code Style

- Comments should explain what the code does and why, not just what. Assume the reader is not familiar with the codebase.
- Use the Signal K plugin API for logging: `app.debug()` for diagnostic info, `app.error()` for error conditions, `app.setPluginStatus()` for dashboard display, `app.setPluginError()` for error display.
- Follow [Keep a Changelog](https://keepachangelog.com/) format for changelog entries.
- Versioning follows [SemVer](https://semver.org/): major for breaking changes, minor for features, patch for fixes.

## License

By contributing, contributions are licensed under the [GNU General Public License v3.0 or later](LICENSE).

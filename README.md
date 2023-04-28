# GitHub Package

To put a Git and a GitHub in some atoms.

## Getting Started

Install via Atom's settings view (v1.7 or higher):

![settings view git install](https://cloud.githubusercontent.com/assets/1476/13877349/7efede88-ed0a-11e5-9fd5-c6d14f075cd8.png)

# Git Integration

## Features
- Diffs
- Staging
- Committing

## Keyboard shortcuts

- `cmd-shift-c` Opens git changes panel

### Staging/Unstaging Changes

- `right` on a file focuses hunk
- select hunks with `up` or `down`
- `enter` to stage hunk
- `/` to toggle line selection mode
- `shift-up` or `shift-down` to expand line selection
- `a` to select lines
- `enter` to stage selected lines
- `backspace` while on a changed file (not the diff) will prompt to discard changes
- `o` on a changed file or hunk/line will open that file in a tab

# GitHub Integration

![2016-03-02 at 2 29 pm](https://cloud.githubusercontent.com/assets/1476/13461672/4281bef0-e083-11e5-8964-b2940ed52cd9.png)


## Use

Sign in via the link in your status bar (it should open your browser and ask you to authenticate).

## Caveats

- Some organizations (e.g. @github) may [limit access from oauth apps that have yet to whitelist](https://github.com/blog/1941-organization-approved-applications), and the status and PR information will not be available for repos in those organizations.
- The package assumes the remote you would like to pull/push to is named `origin`

## Features

- Sign in to GitHub by clicking a link in the status bar or the `github:sign-in` command
- Show current pull request for branch
- Create a new pull request for a branch
- Show build status for current branch

See the [manifest](docs/manifest.md) to learn about the various states the app can have in tedious detail.

## Coming soon

- Read-only inline PR comments
- A panel showing more information about existing PRs
- A panel allowing in-app PR creation.

Here's a few wireframes of the MVP we might ship: https://github.com/atom/design/issues/43

Read more about the current plans for getting to that MVP here: https://github.com/atom/design/issues/44

Here's a discussion on the long-term vision for Git & GitHub integration: https://github.com/atom/design/issues/39


## Development

```
git clone git@github.com:atom/github.git
cd github
apm install
apm link -d
atom .

cd ../some-dir-with-a-git-repo
atom -d
```

* `npm run lint` — Lint the codes.
* `npm run check` — Type check the codes.
* `npm run start` — Start Flow in the background. This will let it parse and typecheck incrementally which is much faster for local development.
* `npm run stop` — Stop Flow.

We're using [Flow](http://flowtype.org) to add T Y P E S.

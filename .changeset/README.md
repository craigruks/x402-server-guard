# Changesets

This directory is managed by [changesets](https://github.com/changesets/changesets).
Add a changeset for any change that should appear in the changelog and trigger a
release:

```sh
npm run changeset
```

Commit the generated markdown file alongside your change. The release workflow
consumes accumulated changesets to version and publish the package.

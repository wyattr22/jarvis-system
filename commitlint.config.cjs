// Conventional commits enforced on every commit.
// Allowed types: feat, fix, chore, docs, refactor, test, perf, ci, build, style, revert.
// Format: <type>(<scope>?): <subject>
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "subject-case": [2, "never", ["upper-case", "pascal-case", "start-case"]],
    "body-max-line-length": [1, "always", 100],
  },
}

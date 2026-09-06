# Contributing

Contributions and bug reports are welcome.

Before opening a pull request:

1. Keep the extension functional without the optional helper.
2. Do not add company-specific routes, accounts, addresses or status output.
3. Do not add periodic calls to `cato-sdp status`.
4. Run `make check` and `make package`.
5. Verify that the generated ZIP contains no privileged helper or local data.

Changes to the helper must validate every argument and must never execute
profile values through a shell command string.

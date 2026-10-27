# AZWOL Personal 0.5.92

- AZWOL blue owl branding in the app, Windows executable and installer.
- Public Personal updates do not require an organization profile or operator login.
- Update failures distinguish connectivity, missing release, authentication and verification errors without displaying private URLs or credentials.
- Installation waits for the app/core to exit and never terminates work.
- Existing app identifiers, encrypted data, model connections and install filenames remain unchanged.
- Preserves the locally qualified 0.5.21 conversation/history improvements.

## Installation Family

An app displaying a Harness version (including 0.5.66 / Harness 5.186) is an
integrated organization build, even if Personal mode is selected. It must use the
organization installer. Selecting Personal mode does not authorize replacing its
managed runtime with a public Personal package.

The Personal installer refuses an integrated organization installation. Do not
enable downgrades, remove service directories or copy executables over it.
For organization builds use the organization channel or an administrator-provided
full installer; for a dedicated Personal installation contact the administrator
to complete a deliberate migration first.

## Release Qualification

Publication requires successful Windows CI, packaged UI/icon checks, the full
Personal regression suite and an actual NSIS upgrade from public 0.5.20, preserving
OS-encrypted settings and verifying a local fixture response. No real provider
calls are used. A successful CI run does not prove an inaccessible other PC has
installed the update.

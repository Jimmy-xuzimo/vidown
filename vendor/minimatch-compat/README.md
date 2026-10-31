# Legacy minimatch interface

The installer toolchain still calls minimatch 3/5 as a CommonJS function. This
small MIT-licensed Vidown adapter delegates matching, brace expansion, regex
creation and `Minimatch` to upstream minimatch 11.0.3. It restores only the
callable export, callable `defaults()` and glob 7's compiled-segment metadata /
`String.match()` interface. Segment matching stays on the non-recursive upstream
Matcher; it is not converted back into the legacy regexp engine. No legacy matching code is
copied, and no upstream package/version is impersonated.

The root npm override references this explicit development dependency. Modern
minimatch 9/10 callers use upstream 11.0.3 directly. The lockfile must resolve all
legacy aliases to `vendor/minimatch-compat`, not nested nonexistent vendor paths.
Check a clean `npm ci --ignore-scripts`, `npm ls`, audit and actual ASAR/glob/
directory comparison tests before updating the adapter or installer toolchain.
This package is a build dependency, not an application engine downloaded at runtime.

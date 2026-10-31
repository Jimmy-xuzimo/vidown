"use strict";
const modern = require("minimatch-modern");
function callable(api) {
  const match = (path, pattern, options) =>
    (typeof api === "function" ? api : api.minimatch)(path, pattern, options);
  Object.assign(match, api);
  // glob 7 reads _glob and calls String.match() on compiled path segments.
  // Modern minimatch uses non-recursive Matcher objects instead of RegExp.
  // Adapt those two interfaces without reintroducing the old regexp engine.
  match.Minimatch = class LegacyMinimatch extends api.Minimatch {
    constructor(pattern, options) {
      super(pattern, options);
      for (const parts of this.set)
        for (const part of parts)
          if (
            part &&
            typeof part === "object" &&
            typeof part.test === "function"
          ) {
            part._glob = part.pattern;
            part[Symbol.match] = (input) => (part.test(input) ? [input] : null);
          }
    }
    static defaults(options) {
      return callable(api.defaults(options)).Minimatch;
    }
  };
  // Legacy callers expect defaults() to return another callable matcher.
  match.defaults = (options) => callable(api.defaults(options));
  return match;
}
module.exports = callable(modern);

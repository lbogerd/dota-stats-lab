import definition from "../../parser-identity.json" with { type: "json" };

type ParserIdentityDefinition = {
  parserName: string;
  clarityUpstreamRelease: string;
  clarityForkRevision: string;
  exportFormatVersion: string;
};

const identity = definition as ParserIdentityDefinition;

requiredString("parserName", identity.parserName);
requiredString("clarityUpstreamRelease", identity.clarityUpstreamRelease);
requiredString("exportFormatVersion", identity.exportFormatVersion);
if (!/^[a-f0-9]{40}$/.test(identity.clarityForkRevision)) {
  throw new Error("parser-identity.json clarityForkRevision must be a full lowercase Git commit");
}

export const parserIdentity = Object.freeze({
  name: identity.parserName,
  upstreamRelease: identity.clarityUpstreamRelease,
  forkRevision: identity.clarityForkRevision,
  version: identity.clarityForkRevision,
  exporterVersion: identity.exportFormatVersion,
});

export const manifestParserIdentity = Object.freeze({
  name: parserIdentity.name,
  version: parserIdentity.version,
  upstreamRelease: parserIdentity.upstreamRelease,
  forkRevision: parserIdentity.forkRevision,
});

function requiredString(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`parser-identity.json ${name} must be a non-empty string`);
  }
}

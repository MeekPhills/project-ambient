#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "schemas/rights/v1/rights-manifest.schema.json");
const fixtureDirectory = path.join(root, "fixtures/rights/v1");
const supportedKeywords = new Set([
  "$schema", "$id", "$ref", "$defs", "title", "description",
  "type", "const", "enum", "format", "pattern", "minLength", "maxLength", "minimum",
  "required", "properties", "additionalProperties",
  "items", "minItems", "allOf", "oneOf", "if", "then", "else", "not",
]);

function clone(value) { return structuredClone(value); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function equal(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function dateTime(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)); }
function uri(value) {
  if (typeof value !== "string") return false;
  try { new URL(value); return true; } catch { return false; }
}

function resolveReference(schema, reference) {
  assert.ok(reference.startsWith("#/"), `only local references are supported: ${reference}`);
  return reference.slice(2).split("/").reduce((value, segment) => value?.[segment.replaceAll("~1", "/").replaceAll("~0", "~")], schema);
}

function auditSchema(rule, at = "$", errors = []) {
  if (typeof rule === "boolean") return errors;
  if (!object(rule)) return [...errors, `${at}: schema node must be object or boolean`];
  for (const key of Object.keys(rule)) if (!supportedKeywords.has(key)) errors.push(`${at}: unsupported keyword ${key}`);
  for (const [key, child] of Object.entries(rule.$defs ?? {})) auditSchema(child, `${at}.$defs.${key}`, errors);
  for (const [key, child] of Object.entries(rule.properties ?? {})) auditSchema(child, `${at}.properties.${key}`, errors);
  if (rule.additionalProperties !== undefined && (object(rule.additionalProperties) || typeof rule.additionalProperties === "boolean")) auditSchema(rule.additionalProperties, `${at}.additionalProperties`, errors);
  if (rule.items !== undefined) auditSchema(rule.items, `${at}.items`, errors);
  for (const keyword of ["allOf", "oneOf"]) (rule[keyword] ?? []).forEach((child, index) => auditSchema(child, `${at}.${keyword}[${index}]`, errors));
  for (const keyword of ["if", "then", "else", "not"]) if (rule[keyword] !== undefined) auditSchema(rule[keyword], `${at}.${keyword}`, errors);
  return errors;
}

function schemaErrors(value, rule, at = "$", rootSchema = rule) {
  if (rule === true) return [];
  if (rule === false) return [`${at}: rejected by schema`];
  if (!object(rule)) return [`${at}: invalid schema rule`];
  if (rule.$ref) {
    const target = resolveReference(rootSchema, rule.$ref);
    return target ? schemaErrors(value, target, at, rootSchema) : [`${at}: unresolved reference ${rule.$ref}`];
  }

  const errors = [];
  const types = {
    object: object(value), array: Array.isArray(value), string: typeof value === "string",
    number: typeof value === "number" && Number.isFinite(value), integer: Number.isInteger(value),
    boolean: typeof value === "boolean", null: value === null,
  };
  if (rule.type && !types[rule.type]) return [`${at}: expected ${rule.type}`];
  if (Object.hasOwn(rule, "const") && !equal(value, rule.const)) errors.push(`${at}: expected ${JSON.stringify(rule.const)}`);
  if (rule.enum && !rule.enum.some((item) => equal(item, value))) errors.push(`${at}: not in enum`);

  if (typeof value === "string") {
    if (rule.minLength !== undefined && value.length < rule.minLength) errors.push(`${at}: shorter than ${rule.minLength}`);
    if (rule.maxLength !== undefined && value.length > rule.maxLength) errors.push(`${at}: longer than ${rule.maxLength}`);
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`${at}: does not match ${rule.pattern}`);
    if (rule.format === "date-time" && !dateTime(value)) errors.push(`${at}: invalid date-time`);
    if (rule.format === "uri" && !uri(value)) errors.push(`${at}: invalid URI`);
  }
  if (typeof value === "number" && rule.minimum !== undefined && value < rule.minimum) errors.push(`${at}: below minimum ${rule.minimum}`);
  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) errors.push(`${at}: fewer than ${rule.minItems} items`);
    if (rule.items) value.forEach((item, index) => errors.push(...schemaErrors(item, rule.items, `${at}[${index}]`, rootSchema)));
  }
  if (object(value)) {
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${at}: missing ${key}`);
    const declared = rule.properties ?? {};
    for (const [key, child] of Object.entries(declared)) if (Object.hasOwn(value, key)) errors.push(...schemaErrors(value[key], child, `${at}.${key}`, rootSchema));
    const extra = Object.keys(value).filter((key) => !Object.hasOwn(declared, key));
    if (rule.additionalProperties === false) extra.forEach((key) => errors.push(`${at}: unknown property ${key}`));
    else if (rule.additionalProperties !== undefined) extra.forEach((key) => errors.push(...schemaErrors(value[key], rule.additionalProperties, `${at}.${key}`, rootSchema)));
  }
  for (const child of rule.allOf ?? []) errors.push(...schemaErrors(value, child, at, rootSchema));
  if (rule.if) {
    const matches = schemaErrors(value, rule.if, at, rootSchema).length === 0;
    if (matches && rule.then) errors.push(...schemaErrors(value, rule.then, at, rootSchema));
    if (!matches && rule.else) errors.push(...schemaErrors(value, rule.else, at, rootSchema));
  }
  if (rule.oneOf) {
    const matches = rule.oneOf.filter((child) => schemaErrors(value, child, at, rootSchema).length === 0).length;
    if (matches !== 1) errors.push(`${at}: expected one oneOf match, received ${matches}`);
  }
  if (rule.not && schemaErrors(value, rule.not, at, rootSchema).length === 0) errors.push(`${at}: matched prohibited schema`);
  return errors;
}

function semanticErrors(manifest, now = new Date()) {
  const errors = [];
  const commercial = manifest.pack?.commercialOffer === true;
  const delivery = manifest.deliveryClass;
  const assets = manifest.assets ?? [];
  const evidence = manifest.review?.evidence ?? [];
  const evidenceById = new Map(evidence.map((entry) => [entry.id, entry]));

  if (manifest.review?.status === "rejected") errors.push("rejected rights review cannot be used");
  if (Date.parse(manifest.review?.reviewedAt) > now.getTime()) errors.push("rights review is in the future");
  if (new Set(assets.map((asset) => asset.id)).size !== assets.length) errors.push("asset IDs must be unique");
  if (new Set(evidence.map((entry) => entry.id)).size !== evidence.length) errors.push("evidence IDs must be unique");
  for (const entry of evidence) {
    if (Date.parse(entry.checkedAt) > now.getTime()) errors.push(`${entry.id}: evidence check is in the future`);
    if (entry.visibility === "public") {
      if (!entry.locator?.startsWith("https://")) errors.push(`${entry.id}: public evidence must use HTTPS`);
      try { if (new URL(entry.locator).username || new URL(entry.locator).password) errors.push(`${entry.id}: evidence URL must not contain credentials`); } catch {}
    } else if (!/^evidence-record:[a-zA-Z0-9._-]+$/.test(entry.locator ?? "")) {
      errors.push(`${entry.id}: private evidence must use an opaque evidence-record identifier`);
    }
  }

  if (delivery === "private_reference") {
    if (commercial) errors.push("private_reference cannot be a commercial offer");
    for (const asset of assets) {
      if (asset.canonicalSource?.startsWith("file:")) errors.push(`${asset.id}: private canonical source must not expose a file path`);
      if (asset.authorization?.projectRights?.rights?.redistribution !== "prohibited") errors.push(`${asset.id}: private Project redistribution must be prohibited`);
      if (asset.authorization?.endUserRights?.rights?.redistribution !== "prohibited") errors.push(`${asset.id}: private end-user redistribution must be prohibited`);
    }
  }

  if (delivery === "bundled_media") {
    if (manifest.review?.status !== "verified") errors.push("bundled_media requires verified review");
    for (const asset of assets) {
      if (asset.provenance?.origin === "unknown") errors.push(`${asset.id}: bundled provenance is unknown`);
      if (asset.authorization?.projectRights?.rights?.reproduction !== "allowed") errors.push(`${asset.id}: bundled Project reproduction must be allowed`);
      if (asset.authorization?.projectRights?.rights?.redistribution !== "allowed") errors.push(`${asset.id}: bundled Project distribution must be allowed`);
      if (asset.authorization?.endUserRights?.rights?.display !== "allowed") errors.push(`${asset.id}: bundled end-user display must be allowed`);
      if (!["license_text", "rightsholder_statement", "contract", "public_domain_record"].some((type) => (asset.evidenceRefs ?? []).some((id) => evidenceById.get(id)?.type === type))) errors.push(`${asset.id}: bundled media lacks qualifying rights evidence`);
      for (const [right, value] of Object.entries(asset.otherRights ?? {})) {
        if (["unknown", "prohibited", "counsel_required"].includes(value)) errors.push(`${asset.id}: bundled ${right} is unresolved`);
      }
    }
  }

  if (delivery === "remote_reference") {
    if (manifest.review?.status !== "verified") errors.push("remote_reference requires verified review");
    if (!manifest.provider?.termsURL?.startsWith("https://")) errors.push("remote provider terms must use HTTPS");
    if (!manifest.provider?.clientFetchOnly) errors.push("remote_reference must be clientFetchOnly");
    if (Date.parse(manifest.provider?.termsReviewedAt) >= Date.parse(manifest.provider?.termsExpireAt)) errors.push("provider terms review must precede expiry");
    if (Date.parse(manifest.provider?.termsReviewedAt) > now.getTime()) errors.push("provider terms review is in the future");
    if (Date.parse(manifest.provider?.termsExpireAt) <= now.getTime()) errors.push("provider terms are expired");
    const termsEvidence = evidenceById.get(manifest.provider?.termsEvidenceRef);
    if (termsEvidence?.type !== "provider_terms") errors.push("remote_reference requires referenced provider_terms evidence");
    if (termsEvidence?.visibility !== "public" || termsEvidence?.locator !== manifest.provider?.termsURL) errors.push("provider terms evidence must bind the declared terms URL");
    const origins = new Set((manifest.provider?.approvedOrigins ?? []).map((value) => { try { return new URL(value).origin; } catch { return "invalid"; } }));
    try { if (!origins.has(new URL(manifest.provider.canonicalURL).origin)) errors.push("provider canonical URL origin is not approved"); } catch {}
    for (const asset of assets) {
      let sourceOrigin = "invalid";
      try { const parsed = new URL(asset.canonicalSource); sourceOrigin = parsed.origin; if (!["https:", "rtsp:", "rtsps:"].includes(parsed.protocol)) errors.push(`${asset.id}: remote source scheme is not approved`); } catch {}
      if (!origins.has(sourceOrigin)) errors.push(`${asset.id}: remote source origin is not provider-approved`);
      if (!(asset.evidenceRefs ?? []).includes(manifest.provider?.termsEvidenceRef)) errors.push(`${asset.id}: remote asset must reference provider terms evidence`);
      if (asset.authorization?.projectRights?.rights?.redistribution !== "prohibited" || asset.authorization?.endUserRights?.rights?.redistribution !== "prohibited") errors.push(`${asset.id}: remote redistribution must be prohibited`);
    }
  }

  if (commercial) {
    if (manifest.review?.status !== "verified") errors.push("commercial offer requires verified review");
    for (const asset of assets) {
      if (asset.provenance?.origin === "unknown") errors.push(`${asset.id}: commercial provenance is unknown`);
      if (asset.authorization?.projectRights?.rights?.commercialUse !== "allowed") errors.push(`${asset.id}: Project commercialization is not allowed`);
      for (const [right, value] of Object.entries(asset.otherRights ?? {})) {
        if (!["cleared", "not_applicable"].includes(value)) errors.push(`${asset.id}: commercial ${right} is unresolved`);
      }
    }
  }

  for (const asset of assets) {
    const evidenceIds = new Set(evidence.map((entry) => entry.id));
    for (const reference of asset.evidenceRefs ?? []) if (!evidenceIds.has(reference)) errors.push(`${asset.id}: unknown evidence reference ${reference}`);
    if (new Set(asset.evidenceRefs ?? []).size !== (asset.evidenceRefs ?? []).length) errors.push(`${asset.id}: duplicate evidence reference`);
    if (asset.mediaType === "live_stream" && asset.digestScope !== "source_descriptor") errors.push(`${asset.id}: live stream digest must bind its source descriptor`);
    if (asset.mediaType !== "live_stream" && asset.digestScope !== "asset_bytes") errors.push(`${asset.id}: static media digest must bind asset bytes`);
    if (asset.mediaType === "live_stream") {
      if (!asset.sourceDescriptor) errors.push(`${asset.id}: live stream requires sourceDescriptor`);
      else {
        const descriptorDigest = createHash("sha256").update(JSON.stringify(asset.sourceDescriptor)).digest("hex");
        if (descriptorDigest !== asset.sha256) errors.push(`${asset.id}: source descriptor digest does not match`);
        if (asset.sourceDescriptor.canonicalURL !== asset.canonicalSource || asset.sourceDescriptor.providerName !== manifest.provider?.name || asset.sourceDescriptor.termsEvidenceRef !== manifest.provider?.termsEvidenceRef) errors.push(`${asset.id}: source descriptor does not match provider binding`);
        try {
          const source = new URL(asset.sourceDescriptor.canonicalURL);
          const expectedTransport = source.protocol === "rtsp:" ? "rtsp" : source.protocol === "rtsps:" ? "rtsps" : source.pathname.toLowerCase().endsWith(".m3u8") ? "hls" : "https";
          if (asset.sourceDescriptor.transport !== expectedTransport) errors.push(`${asset.id}: descriptor transport does not match source URL`);
        } catch {}
      }
    } else if (asset.sourceDescriptor !== undefined) errors.push(`${asset.id}: non-live asset must not declare sourceDescriptor`);
    for (const scopeName of ["projectRights", "endUserRights"]) {
      const scope = asset.authorization?.[scopeName];
      if (Object.values(scope?.rights ?? {}).includes("conditional") && !scope?.conditions) errors.push(`${asset.id}.${scopeName}: conditional grant requires conditions`);
      if (scope?.conditions?.startsAt && scope?.conditions?.expiresAt && Date.parse(scope.conditions.startsAt) >= Date.parse(scope.conditions.expiresAt)) errors.push(`${asset.id}.${scopeName}: rights start must precede expiry`);
      if (scope?.conditions?.expiresAt && Date.parse(scope.conditions.expiresAt) <= now.getTime()) errors.push(`${asset.id}.${scopeName}: rights term is expired`);
      if (scope?.rights?.redistribution === "allowed" && scope?.rights?.reproduction === "prohibited") errors.push(`${asset.id}.${scopeName}: distribution cannot be allowed while reproduction is prohibited`);
      if (scope?.grantee === "organization_user" && !(scope.conditions?.audiences ?? []).includes("enterprise")) errors.push(`${asset.id}.${scopeName}: organization user requires enterprise audience`);
      if (scope?.grantee === "personal_user" && !(scope.conditions?.audiences ?? []).includes("personal")) errors.push(`${asset.id}.${scopeName}: personal user requires personal audience`);
    }
    if (asset.authorization?.projectRights?.grantee !== "project_ambient") errors.push(`${asset.id}: projectRights grantee must be project_ambient`);
    if (!["personal_user", "organization_user", "all_end_users"].includes(asset.authorization?.endUserRights?.grantee)) errors.push(`${asset.id}: endUserRights grantee must be an end-user class`);
    if (asset.provenance?.origin === "ai_generated" && !asset.provenance.toolOrModel) errors.push(`${asset.id}: AI provenance requires toolOrModel`);
  }
  return errors;
}

function validate(manifest, schema) { return [...schemaErrors(manifest, schema), ...semanticErrors(manifest)]; }
function expectInvalid(label, manifest, schema, fragment) {
  const errors = validate(manifest, schema);
  assert.ok(errors.some((error) => error.includes(fragment)), `${label}: expected ${fragment}; received ${errors.join(" | ")}`);
}

const schema = JSON.parse(await readFile(schemaPath, "utf8"));
assert.deepEqual(auditSchema(schema), [], "published schema must use only evaluated keywords");

const fixtureNames = (await readdir(fixtureDirectory)).filter((name) => name.endsWith(".json")).sort();
assert.deepEqual(fixtureNames, ["licensed-live-source.json", "paid-creator-pack.json", "private-enterprise-reference.json", "private-reference.json", "public-domain-pack.json"]);
const fixtures = new Map();
for (const name of fixtureNames) {
  const value = JSON.parse(await readFile(path.join(fixtureDirectory, name), "utf8"));
  assert.deepEqual(validate(value, schema), [], `${name} must validate`);
  fixtures.set(name, value);
}

const privateRedistribution = clone(fixtures.get("private-reference.json"));
privateRedistribution.assets[0].authorization.endUserRights.rights.redistribution = "allowed";
expectInvalid("private redistribution", privateRedistribution, schema, "private end-user redistribution");

const unverifiedBundle = clone(fixtures.get("public-domain-pack.json"));
unverifiedBundle.review.status = "self_attested";
expectInvalid("unverified bundle", unverifiedBundle, schema, "verified review");

const remoteWithoutProvider = clone(fixtures.get("licensed-live-source.json"));
delete remoteWithoutProvider.provider;
expectInvalid("remote provider required", remoteWithoutProvider, schema, "missing provider");

const serverFetchedRemote = clone(fixtures.get("licensed-live-source.json"));
serverFetchedRemote.provider.clientFetchOnly = false;
expectInvalid("remote client fetch", serverFetchedRemote, schema, "clientFetchOnly");

const expiredProvider = clone(fixtures.get("licensed-live-source.json"));
expiredProvider.provider.termsExpireAt = "2026-08-12T00:00:00Z";
expectInvalid("expired provider", expiredProvider, schema, "expired");

const selfAttestedRemote = clone(fixtures.get("licensed-live-source.json"));
selfAttestedRemote.review.status = "self_attested";
expectInvalid("remote review", selfAttestedRemote, schema, "requires verified review");

const remoteWithoutTermsEvidence = clone(fixtures.get("licensed-live-source.json"));
remoteWithoutTermsEvidence.review.evidence[0].type = "user_attestation";
expectInvalid("remote terms evidence", remoteWithoutTermsEvidence, schema, "provider_terms evidence");

const unrelatedRemoteOrigin = clone(fixtures.get("licensed-live-source.json"));
unrelatedRemoteOrigin.assets[0].canonicalSource = "https://unrelated.example/live.m3u8";
expectInvalid("remote origin binding", unrelatedRemoteOrigin, schema, "provider-approved");

const tamperedDescriptor = clone(fixtures.get("licensed-live-source.json"));
tamperedDescriptor.assets[0].sourceDescriptor.transport = "https";
expectInvalid("descriptor digest binding", tamperedDescriptor, schema, "source descriptor digest does not match");

const unsafeRemoteScheme = clone(fixtures.get("licensed-live-source.json"));
unsafeRemoteScheme.assets[0].canonicalSource = "file:///tmp/live.m3u8";
expectInvalid("remote scheme allowlist", unsafeRemoteScheme, schema, "source scheme is not approved");

const commercialWithoutGrant = clone(fixtures.get("public-domain-pack.json"));
commercialWithoutGrant.pack.commercialOffer = true;
commercialWithoutGrant.assets[0].authorization.projectRights.rights.commercialUse = "prohibited";
expectInvalid("commercial grant", commercialWithoutGrant, schema, "Project commercialization");

const unknownProperty = clone(fixtures.get("public-domain-pack.json"));
unknownProperty.assets[0].license.surprise = true;
expectInvalid("unknown property", unknownProperty, schema, "unknown property surprise");

const invalidDigest = clone(fixtures.get("public-domain-pack.json"));
invalidDigest.assets[0].sha256 = "not-a-digest";
expectInvalid("digest binding", invalidDigest, schema, "does not match");

const privatePath = clone(fixtures.get("private-reference.json"));
privatePath.assets[0].canonicalSource = "file:///Users/example/Pictures/private.jpg";
expectInvalid("private path redaction", privatePath, schema, "must not expose a file path");

const missingEvidence = clone(fixtures.get("public-domain-pack.json"));
missingEvidence.assets[0].evidenceRefs = ["missing-record"];
expectInvalid("evidence binding", missingEvidence, schema, "unknown evidence reference");

const rejectedReview = clone(fixtures.get("private-reference.json"));
rejectedReview.review.status = "rejected";
expectInvalid("rejected review", rejectedReview, schema, "rejected rights review");

const duplicateAsset = clone(fixtures.get("public-domain-pack.json"));
duplicateAsset.assets.push(clone(duplicateAsset.assets[0]));
expectInvalid("duplicate asset IDs", duplicateAsset, schema, "asset IDs must be unique");

const contradictoryDistribution = clone(fixtures.get("public-domain-pack.json"));
contradictoryDistribution.assets[0].authorization.endUserRights.rights.reproduction = "prohibited";
expectInvalid("distribution requires reproduction", contradictoryDistribution, schema, "distribution cannot be allowed");

const reversedTerm = clone(fixtures.get("paid-creator-pack.json"));
reversedTerm.assets[0].authorization.endUserRights.conditions.expiresAt = "2026-08-12T00:00:00Z";
expectInvalid("term ordering", reversedTerm, schema, "rights start must precede expiry");

const invalidProviderOrder = clone(fixtures.get("licensed-live-source.json"));
invalidProviderOrder.provider.termsReviewedAt = "2099-08-14T00:00:00Z";
expectInvalid("provider term ordering", invalidProviderOrder, schema, "review must precede expiry");

const futureProviderReview = clone(fixtures.get("licensed-live-source.json"));
futureProviderReview.provider.termsReviewedAt = "2098-08-13T20:00:00Z";
expectInvalid("future provider review", futureProviderReview, schema, "provider terms review is in the future");

const unrelatedTermsEvidence = clone(fixtures.get("licensed-live-source.json"));
unrelatedTermsEvidence.review.evidence[0].locator = "https://example.org/different-terms";
expectInvalid("provider terms URL binding", unrelatedTermsEvidence, schema, "bind the declared terms URL");

const timezoneMissing = clone(fixtures.get("public-domain-pack.json"));
timezoneMissing.review.reviewedAt = "2026-08-13T20:00:00";
expectInvalid("timezone required", timezoneMissing, schema, "invalid date-time");

const exposedPrivateEvidence = clone(fixtures.get("private-reference.json"));
exposedPrivateEvidence.review.evidence[0].locator = "/Users/example/private-contract.pdf";
expectInvalid("private evidence locator", exposedPrivateEvidence, schema, "opaque evidence-record");

const credentialEvidence = clone(fixtures.get("public-domain-pack.json"));
credentialEvidence.review.evidence[0].locator = "https://user:password@example.org/evidence";
expectInvalid("credential evidence", credentialEvidence, schema, "must not contain credentials");

const futureReview = clone(fixtures.get("private-reference.json"));
futureReview.review.reviewedAt = "2099-08-13T20:00:00Z";
expectInvalid("future review", futureReview, schema, "rights review is in the future");

const swappedGrantees = clone(fixtures.get("paid-creator-pack.json"));
swappedGrantees.assets[0].authorization.projectRights.grantee = "personal_user";
swappedGrantees.assets[0].authorization.endUserRights.grantee = "project_ambient";
expectInvalid("actor scope binding", swappedGrantees, schema, "projectRights grantee");

const mismatchedTransport = clone(fixtures.get("licensed-live-source.json"));
mismatchedTransport.assets[0].sourceDescriptor.transport = "rtsp";
mismatchedTransport.assets[0].sha256 = createHash("sha256").update(JSON.stringify(mismatchedTransport.assets[0].sourceDescriptor)).digest("hex");
expectInvalid("transport binding", mismatchedTransport, schema, "transport does not match");

const unsupportedSchema = clone(schema);
unsupportedSchema.properties.pack.maxProperties = 5;
assert.ok(auditSchema(unsupportedSchema).some((error) => error.includes("unsupported keyword maxProperties")), "schema audit must fail closed on unsupported constraints");

console.log(`Rights validation passed: schema 1.0.0, ${fixtureNames.length} fixtures, 29 negative/fail-closed checks.`);

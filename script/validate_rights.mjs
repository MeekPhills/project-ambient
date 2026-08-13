#!/usr/bin/env node

import assert from "node:assert/strict";
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
function dateTime(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value)); }
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

  if (delivery === "private_reference") {
    if (commercial) errors.push("private_reference cannot be a commercial offer");
    for (const asset of assets) {
      if (asset.canonicalSource?.startsWith("file:")) errors.push(`${asset.id}: private canonical source must not expose a file path`);
      if (asset.grants?.redistribution !== "prohibited") errors.push(`${asset.id}: private redistribution must be prohibited`);
      if (asset.grants?.commercialUse !== "prohibited") errors.push(`${asset.id}: private commercial use must be prohibited`);
    }
  }

  if (delivery === "bundled_media") {
    if (manifest.review?.status !== "verified") errors.push("bundled_media requires verified review");
    for (const asset of assets) {
      if (asset.grants?.display !== "allowed") errors.push(`${asset.id}: bundled display must be allowed`);
      if (asset.grants?.redistribution !== "allowed") errors.push(`${asset.id}: bundled redistribution must be allowed`);
      for (const [right, value] of Object.entries(asset.otherRights ?? {})) {
        if (["unknown", "prohibited", "counsel_required"].includes(value)) errors.push(`${asset.id}: bundled ${right} is unresolved`);
      }
    }
  }

  if (delivery === "remote_reference") {
    if (!manifest.provider?.clientFetchOnly) errors.push("remote_reference must be clientFetchOnly");
    if (Date.parse(manifest.provider?.termsExpireAt) <= now.getTime()) errors.push("provider terms are expired");
    for (const asset of assets) if (asset.grants?.redistribution !== "prohibited") errors.push(`${asset.id}: remote redistribution must be prohibited`);
  }

  if (commercial) {
    if (manifest.review?.status !== "verified") errors.push("commercial offer requires verified review");
    for (const asset of assets) {
      if (asset.grants?.commercialUse !== "allowed") errors.push(`${asset.id}: commercial use is not allowed`);
      for (const [right, value] of Object.entries(asset.otherRights ?? {})) {
        if (!["cleared", "not_applicable"].includes(value)) errors.push(`${asset.id}: commercial ${right} is unresolved`);
      }
    }
  }

  for (const asset of assets) {
    const evidenceIds = new Set((manifest.review?.evidence ?? []).map((entry) => entry.id));
    for (const reference of asset.evidenceRefs ?? []) if (!evidenceIds.has(reference)) errors.push(`${asset.id}: unknown evidence reference ${reference}`);
    if (new Set(asset.evidenceRefs ?? []).size !== (asset.evidenceRefs ?? []).length) errors.push(`${asset.id}: duplicate evidence reference`);
    if (asset.mediaType === "live_stream" && asset.digestScope !== "source_descriptor") errors.push(`${asset.id}: live stream digest must bind its source descriptor`);
    if (asset.mediaType !== "live_stream" && asset.digestScope !== "asset_bytes") errors.push(`${asset.id}: static media digest must bind asset bytes`);
    const conditional = Object.values(asset.grants ?? {}).includes("conditional");
    if (conditional && !asset.conditions) errors.push(`${asset.id}: conditional grant requires conditions`);
    if (asset.conditions?.expiresAt && Date.parse(asset.conditions.expiresAt) <= now.getTime()) errors.push(`${asset.id}: rights term is expired`);
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
assert.deepEqual(fixtureNames, ["licensed-live-source.json", "private-reference.json", "public-domain-pack.json"]);
const fixtures = new Map();
for (const name of fixtureNames) {
  const value = JSON.parse(await readFile(path.join(fixtureDirectory, name), "utf8"));
  assert.deepEqual(validate(value, schema), [], `${name} must validate`);
  fixtures.set(name, value);
}

const privateRedistribution = clone(fixtures.get("private-reference.json"));
privateRedistribution.assets[0].grants.redistribution = "allowed";
expectInvalid("private redistribution", privateRedistribution, schema, "private redistribution");

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

const commercialWithoutGrant = clone(fixtures.get("public-domain-pack.json"));
commercialWithoutGrant.pack.commercialOffer = true;
commercialWithoutGrant.assets[0].grants.commercialUse = "prohibited";
expectInvalid("commercial grant", commercialWithoutGrant, schema, "commercial use");

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

const unsupportedSchema = clone(schema);
unsupportedSchema.properties.pack.maxProperties = 5;
assert.ok(auditSchema(unsupportedSchema).some((error) => error.includes("unsupported keyword maxProperties")), "schema audit must fail closed on unsupported constraints");

console.log(`Rights validation passed: schema 1.0.0, ${fixtureNames.length} fixtures, 11 negative/fail-closed checks.`);

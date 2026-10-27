// A closed caller data contract can name compatible binding targets before
// generation. This prevents the retained /records vs /rows mismatch without
// guessing a path or rewriting authored values after generation.
import { joinPointer } from "./pointer.ts";
import { toWireSchema, type JSONSchema } from "./schema.ts";

export function bindDataContract(props: JSONSchema, data: JSONSchema): JSONSchema {
  const out = toWireSchema(props);
  if (data.additionalProperties !== false) return out;
  const paths: { path: string; schema: JSONSchema }[] = [];
  const deref = (schema: JSONSchema): JSONSchema => schema.$ref?.startsWith("#/$defs/") && Object.hasOwn(data.$defs ?? {}, schema.$ref.slice(8)) ? data.$defs![schema.$ref.slice(8)]! : schema;
  let open = false;
  const collect = (raw: JSONSchema, segments: string[], relative = false, depth = 0): void => {
    if (depth > 12 || paths.length > 512) { open = true; return; }
    const schema = deref(raw);
    if (segments.length) paths.push({ path: relative ? joinPointer(segments).slice(1) : joinPointer(segments), schema });
    if (schema.anyOf) { open = true; return; }
    if (schema.type === "object") {
      if (schema.additionalProperties !== false) open = true;
      for (const [key, value] of Object.entries(schema.properties ?? {})) collect(value, [...segments, key], relative, depth + 1);
    }
    // Template-relative bindings remain available for declared record items.
    if (schema.type === "array" && schema.items && deref(schema.items).type === "object") collect(schema.items, [], true, depth + 1);
  };
  collect(data, []);
  // Open dictionaries, unions or unbounded recursion need the ordinary
  // reference contract; do not exclude a valid caller-supported binding.
  if (open) return out;
  const fits = (expected: JSONSchema, raw: JSONSchema, depth = 0): boolean => {
    if (depth > 12) return false;
    const actual = deref(raw);
    if (expected.anyOf) return expected.anyOf.some(branch => fits(branch, actual, depth + 1));
    const types = (schema: JSONSchema) => Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
    const wanted = types(expected), offered = types(actual);
    if (!wanted.length || !offered.length) return false;
    if (!offered.every(type => wanted.includes(type) || type === "integer" && wanted.includes("number"))) return false;
    if (offered.includes("array") && expected.items) return Boolean(actual.items && fits(expected.items, actual.items, depth + 1));
    if (offered.includes("object") && expected.properties) return (expected.required ?? []).every(key => Boolean(actual.properties?.[key] && fits(expected.properties![key]!, actual.properties[key]!, depth + 1)));
    return true;
  };
  const specialize = (schema: JSONSchema): JSONSchema => {
    if (schema.anyOf) {
      const mapping = schema.anyOf.find(branch => branch.type === "object" && branch.properties?.records);
      const collections = paths.filter(candidate => candidate.schema.type === "array" && candidate.schema.items && deref(candidate.schema.items).type === "object");
      // Record collections have no positional-row equivalent. The retained
      // provider output copied unrelated cells (or []) despite declared records.
      // Narrow collection views to explicit mappings, never infer their values.
      if (mapping && schema.anyOf.some(branch => branch.type === "array") && collections.length && !paths.some(candidate => schema.anyOf!.some(branch => branch.type === "array" && fits(branch, candidate.schema)))) {
        return { anyOf: collections.map(({ path, schema: collection }) => {
          const item = deref(collection.items!);
          const keys = Object.keys(item.properties ?? {});
          return { ...mapping, properties: { ...mapping.properties,
            records: { type: "string", enum: path.startsWith("/") ? [`{${path}}`, `{${path.slice(1)}}`] : [`{${path}}`] },
            ...(keys.length ? { fields: { ...mapping.properties!.fields!, items: { type: "string", enum: keys } } } : {}),
          } };
        }) };
      }
      const binding = schema.anyOf.find(branch => branch.type === "string" && branch.pattern === "^\\{/?[^{}]*\\}$");
      if (binding) {
        const values = schema.anyOf.filter(branch => branch !== binding);
        const targets = paths.filter(candidate => values.some(value => fits(value, candidate.schema)));
        const references = [...new Set(targets.flatMap(({ path }) => path.startsWith("/") ? [`{${path}}`, `{${path.slice(1)}}`] : [`{${path}}`]))];
        // A declared compatible dataset is authoritative: copying its values
        // into props would create an independent, stale second copy.
        return references.length ? { type: "string", enum: references, description: schema.description } : { ...schema, anyOf: values.map(specialize) };
      }
      return { ...schema, anyOf: schema.anyOf.map(specialize) };
    }
    return { ...schema, ...(schema.properties ? { properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, key === "bind" && paths.length ? { ...value, enum: [...new Set(paths.map(p => p.path))] } : specialize(value)])) } : {}) };
  };
  return specialize(out);
}

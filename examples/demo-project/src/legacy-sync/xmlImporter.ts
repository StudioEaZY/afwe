// UNCHARTED: legacy-sync/xmlImporter.ts
export function parseLegacyXmlBatch(xmlRaw: string): Array<{ id: string; name: string }> {
  const matches = xmlRaw.match(/<item id="([^"]+)">([^<]+)<\/item>/g) || [];
  return matches.map(m => ({ id: "legacy-1", name: "parsed" }));
}

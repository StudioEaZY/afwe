// UNCHARTED: experiments/aiSuggest.ts
export function suggestWorkspaceTags(contentSnippet: string): string[] {
  const words = contentSnippet.toLowerCase().split(/\W+/);
  return words.filter(w => w.length > 5).slice(0, 3);
}

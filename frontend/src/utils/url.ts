export type UrlParts = {
  base: string;
  path: string;
  hash: string;
  params: Array<[string, string]>;
};
const supportedProtocols = new Set(['http:', 'https:', 'rtsp:', 'ws:', 'wss:']);
export function parseSupportedUrl(input: string): UrlParts | null {
  try {
    const url = new URL(input.trim());
    if (!supportedProtocols.has(url.protocol) || !url.hostname) return null;
    return {
      base: `${url.protocol}//${url.host}`,
      path: url.pathname || '/',
      hash: url.hash.slice(1),
      params: Array.from(url.searchParams.entries()),
    };
  } catch {
    return null;
  }
}
export function urlParamsJson(params: Array<[string, string]>) {
  const output: Record<string, string | string[]> = {};
  for (const [key, value] of params) {
    const current = output[key];
    output[key] =
      current === undefined
        ? value
        : Array.isArray(current)
          ? [...current, value]
          : [current, value];
  }
  return JSON.stringify(output, null, 2);
}

export type UrlParts = {
  base: string;
  protocol: string;
  hostname: string;
  port: string;
  username: string;
  password: string;
  path: string;
  hash: string;
  params: Array<[string, string]>;
};

export type UrlPartPatch = {
  base?: string;
  protocol?: string;
  hostname?: string;
  port?: string;
  username?: string;
  password?: string;
  path?: string;
  hash?: string;
  param?: {
    index: number;
    key?: string;
    value?: string;
  };
};

const supportedProtocols = new Set(['http:', 'https:', 'rtsp:', 'ws:', 'wss:']);

export function parseSupportedUrl(input: string): UrlParts | null {
  try {
    const url = new URL(input.trim());
    if (!supportedProtocols.has(url.protocol) || !url.hostname) return null;
    return {
      base: `${url.protocol}//${url.host}`,
      protocol: url.protocol.slice(0, -1),
      hostname: url.hostname,
      port: url.port,
      username: url.username,
      password: url.password,
      path: url.pathname || '/',
      hash: url.hash.slice(1),
      params: Array.from(url.searchParams.entries()),
    };
  } catch {
    return null;
  }
}

function hasOwn(object: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function hasCredentials(value: string) {
  const authorityStart = value.indexOf('//');
  if (authorityStart < 0) return false;
  const authority = value.slice(authorityStart + 2).split(/[/?#]/, 1)[0];
  return authority.includes('@');
}

function isValidPort(value: string) {
  if (value === '') return true;
  if (!/^\d+$/.test(value)) return false;
  return Number(value) <= 65535;
}

function rebuildUrlAuthority(url: URL, protocol: string, hostname: string, port: string) {
  if (
    !hostname ||
    hostname.includes('@') ||
    /[/?#\\]/.test(hostname) ||
    (hostname.includes(':') && !(hostname.startsWith('[') && hostname.endsWith(']')))
  ) {
    throw new Error('Invalid URL hostname');
  }

  const rebuilt = new URL(`${protocol}//${hostname}${port ? `:${port}` : ''}/`);
  if (!rebuilt.hostname) throw new Error('Invalid URL hostname');
  rebuilt.username = url.username;
  rebuilt.password = url.password;
  rebuilt.pathname = url.pathname;
  rebuilt.search = url.search;
  rebuilt.hash = url.hash;
  return rebuilt;
}

export function updateUrlPart(input: string, patch: UrlPartPatch): string {
  if (typeof input !== 'string' || !patch || typeof patch !== 'object') return input;
  const parsed = parseSupportedUrl(input);
  if (!parsed) return input;

  const patchKeys = [
    'protocol',
    'hostname',
    'port',
    'base',
    'username',
    'password',
    'path',
    'hash',
  ] as const;
  for (const key of patchKeys) {
    if (hasOwn(patch, key) && patch[key] !== undefined && typeof patch[key] !== 'string') {
      return input;
    }
  }
  if (hasOwn(patch, 'param') && patch.param !== undefined) {
    const param = patch.param;
    if (!param || typeof param !== 'object' || !Number.isInteger(param.index) || param.index < 0) {
      return input;
    }
    if (
      (param.key !== undefined && typeof param.key !== 'string') ||
      (param.value !== undefined && typeof param.value !== 'string')
    ) {
      return input;
    }
  }
  if (patch.port !== undefined && !isValidPort(patch.port)) return input;
  if (patch.protocol !== undefined && !supportedProtocols.has(`${patch.protocol}:`)) {
    return input;
  }

  try {
    let url = new URL(input.trim());

    if (patch.base !== undefined) {
      const base = new URL(patch.base.trim());
      if (
        base.protocol !== url.protocol ||
        !base.hostname ||
        hasCredentials(patch.base) ||
        (base.pathname !== '' && base.pathname !== '/') ||
        base.search ||
        base.hash
      ) {
        return input;
      }

      // 部分协议（例如 RTSP）不支持通过 host setter 更新 authority。
      url = rebuildUrlAuthority(url, base.protocol, base.hostname, base.port);
    }

    if (patch.protocol !== undefined || patch.hostname !== undefined || patch.port !== undefined) {
      url = rebuildUrlAuthority(
        url,
        patch.protocol !== undefined ? `${patch.protocol}:` : url.protocol,
        patch.hostname !== undefined ? patch.hostname : url.hostname,
        patch.port !== undefined ? patch.port : url.port,
      );
    }

    if (patch.username !== undefined) url.username = patch.username;
    if (patch.password !== undefined) url.password = patch.password;

    if (patch.path !== undefined) url.pathname = patch.path || '/';
    if (patch.hash !== undefined) {
      const hash = patch.hash.replace(/^#+/, '');
      url.hash = hash ? `#${hash}` : '';
    }

    if (patch.param !== undefined) {
      const entries = Array.from(url.searchParams.entries());
      if (patch.param.index >= entries.length) return input;
      const entry = entries[patch.param.index];
      if (patch.param.key !== undefined) entry[0] = patch.param.key;
      if (patch.param.value !== undefined) entry[1] = patch.param.value;
      url.search = new URLSearchParams(entries).toString();
    }

    return url.toString();
  } catch {
    return input;
  }
}

export function appendUrlParam(input: string): string {
  if (typeof input !== 'string' || !parseSupportedUrl(input)) return input;

  try {
    const url = new URL(input.trim());
    url.searchParams.append('', '');
    return url.toString();
  } catch {
    return input;
  }
}

export function removeUrlParam(input: string, index: number): string {
  if (typeof input !== 'string' || !parseSupportedUrl(input)) return input;
  if (!Number.isInteger(index) || index < 0) return input;

  try {
    const url = new URL(input.trim());
    const entries = Array.from(url.searchParams.entries());
    if (index >= entries.length) return input;
    entries.splice(index, 1);
    url.search = entries.length ? new URLSearchParams(entries).toString() : '';
    return url.toString();
  } catch {
    return input;
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

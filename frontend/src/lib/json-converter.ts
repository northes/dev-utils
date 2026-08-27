/**
 * 将严格 JSON 转换为不依赖第三方库的常用文本格式。
 *
 * 该模块只接受 JSON 原文，不会像 JSON5 一样删除注释或修复输入。
 */

export type JsonConvertFormat = 'yaml' | 'xml' | 'toml' | 'csv';

export type JsonConvertErrorCode =
  | 'invalidJson'
  | 'jsonComments'
  | 'unsafeInteger'
  | 'unsupportedFormat'
  | 'unsupportedType'
  | 'unsupportedNumber'
  | 'tomlRoot'
  | 'tomlNull'
  | 'xmlInvalidName'
  | 'xmlInvalidCharacter'
  | 'csvMixedRows';

export class JsonConverterError extends Error {
  constructor(
    readonly code: JsonConvertErrorCode,
    readonly params: Readonly<Record<string, string>> = {},
  ) {
    super(code);
    this.name = 'JsonConverterError';
  }
}

export const JSON_CONVERT_FORMATS: readonly JsonConvertFormat[] = ['yaml', 'xml', 'toml', 'csv'];

function convertFail(code: JsonConvertErrorCode, params?: Readonly<Record<string, string>>): never {
  throw new JsonConverterError(code, params);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: number): string {
  if (!Number.isFinite(value)) convertFail('unsupportedNumber');
  return String(value);
}

/*
 * 只在 JSON 词法层扫描数字和注释。这样字符串里的数字不会被当成数字，
 * 且安全整数检查一定发生在 JSON.parse 之前。
 */
const JSON_NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const SAFE_INTEGER_TEXT = '9007199254740991';

function allZeros(value: string): boolean {
  return /^0*$/.test(value);
}

function stripLeadingZeros(value: string): string {
  const stripped = value.replace(/^0+/, '');
  return stripped || '0';
}

/** 判断一个 JSON 数字字面量表示的整数是否超过 Number 的安全范围。 */
function isUnsafeIntegerLiteral(literal: string): boolean {
  const unsigned = literal.startsWith('-') ? literal.slice(1) : literal;
  const exponentMarker = unsigned.search(/[eE]/);
  const mantissa = exponentMarker === -1 ? unsigned : unsigned.slice(0, exponentMarker);
  const exponentText = exponentMarker === -1 ? '' : unsigned.slice(exponentMarker + 1);
  const dot = mantissa.indexOf('.');
  const integerPart = dot === -1 ? mantissa : mantissa.slice(0, dot);
  const fractionPart = dot === -1 ? '' : mantissa.slice(dot + 1);
  const digits = integerPart + fractionPart;

  // 对于 0e999999 这类值，不应因为指数很大而误报。
  if (allZeros(digits)) return false;

  let exponent = 0;
  if (exponentText) {
    exponent = Number(exponentText);
    if (!Number.isFinite(exponent)) {
      // 正无穷指数会把任意非零有限系数变成超大整数；负无穷指数
      // 则不可能是整数（非零系数的值趋近于 0）。
      return !exponentText.startsWith('-');
    }
  }

  const scale = fractionPart.length - exponent;
  let integerDigits: string;
  if (scale <= 0) {
    const significant = stripLeadingZeros(digits);
    const integerDigitCount = significant.length - scale;
    if (integerDigitCount > SAFE_INTEGER_TEXT.length) return true;
    integerDigits = `${significant}${'0'.repeat(-scale)}`;
  } else {
    // 小数点右侧仍有非零数字时，数学值不是整数。
    if (scale >= digits.length) return false;
    const split = digits.length - scale;
    if (!allZeros(digits.slice(split))) return false;
    integerDigits = stripLeadingZeros(digits.slice(0, split));
  }

  const normalized = stripLeadingZeros(integerDigits);
  return (
    normalized.length > SAFE_INTEGER_TEXT.length ||
    (normalized.length === SAFE_INTEGER_TEXT.length && normalized > SAFE_INTEGER_TEXT)
  );
}

function isNumberBoundary(char: string | undefined): boolean {
  return char === undefined || /[\s,\]}]/.test(char);
}

function inspectJsonSource(source: string): void {
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (char === '"') {
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2;
          continue;
        }
        if (source[index] === '"') break;
        index += 1;
      }
      continue;
    }

    if (char === '/' && (source[index + 1] === '/' || source[index + 1] === '*')) {
      convertFail('jsonComments');
    }

    if (char === '-' || /\d/.test(char)) {
      const match = source.slice(index).match(JSON_NUMBER);
      if (match && isNumberBoundary(source[index + match[0].length])) {
        if (isUnsafeIntegerLiteral(match[0])) convertFail('unsafeInteger');
        index += match[0].length - 1;
      }
    }
  }
}

function parseJsonSource(source: string): unknown {
  inspectJsonSource(source);
  try {
    return JSON.parse(source) as unknown;
  } catch {
    convertFail('invalidJson');
  }
}

function yamlScalar(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return finiteNumber(value);
  // JSON 双引号是 YAML 的合法双引号标量，并规避 YAML 的隐式类型推断。
  if (typeof value === 'string') return JSON.stringify(value);
  return convertFail('unsupportedType');
}

function yamlKey(key: string): string {
  return JSON.stringify(key);
}

function isEmptyCollection(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

function yamlLines(value: unknown, indent: number): string[] {
  const pad = '  '.repeat(indent);
  if (value === null || typeof value !== 'object') return [`${pad}${yamlScalar(value)}`];

  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}[]`];
    return value.flatMap((item) => {
      if (item !== null && typeof item === 'object' && !isEmptyCollection(item)) {
        const nested = yamlLines(item, indent + 1);
        return [`${pad}- ${nested[0]?.trimStart() ?? ''}`, ...nested.slice(1)];
      }
      if (item !== null && typeof item === 'object')
        return [`${pad}- ${Array.isArray(item) ? '[]' : '{}'}`];
      return [`${pad}- ${yamlScalar(item)}`];
    });
  }

  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.length === 0) return [`${pad}{}`];
  return keys.flatMap((key) => {
    const child = object[key];
    if (child !== null && typeof child === 'object' && !isEmptyCollection(child))
      return [`${pad}${yamlKey(key)}:`, ...yamlLines(child, indent + 1)];
    if (child !== null && typeof child === 'object')
      return [`${pad}${yamlKey(key)}: ${Array.isArray(child) ? '[]' : '{}'}`];
    return [`${pad}${yamlKey(key)}: ${yamlScalar(child)}`];
  });
}

function jsonToYaml(value: unknown): string {
  return `${yamlLines(value, 0).join('\n')}\n`;
}

function tomlBareKey(key: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(key);
}

function tomlKey(key: string): string {
  return tomlBareKey(key) ? key : tomlBasicString(key);
}

function hexEscape(codePoint: number): string {
  return `\\u${codePoint.toString(16).padStart(4, '0')}`;
}

function tomlBasicString(value: string): string {
  let output = '"';
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    const nextCodeUnit = value.charCodeAt(index + 1);
    const codePoint =
      codeUnit >= 0xd800 && codeUnit <= 0xdbff && nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff
        ? (codeUnit - 0xd800) * 0x400 + nextCodeUnit - 0xdc00 + 0x10000
        : codeUnit;

    if (codePoint > 0xffff) index += 1;
    if (codePoint === 0x22) output += '\\"';
    else if (codePoint === 0x5c) output += '\\\\';
    else if (codePoint === 0x08) output += '\\b';
    else if (codePoint === 0x09) output += '\\t';
    else if (codePoint === 0x0a) output += '\\n';
    else if (codePoint === 0x0c) output += '\\f';
    else if (codePoint === 0x0d) output += '\\r';
    else if (codePoint < 0x20 || codePoint === 0x7f || (codePoint >= 0xd800 && codePoint <= 0xdfff))
      output += hexEscape(codePoint);
    else output += String.fromCodePoint(codePoint);
  }
  return `${output}"`;
}

function tomlScalar(value: unknown): string {
  if (typeof value === 'string') return tomlBasicString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return finiteNumber(value);
  return convertFail('unsupportedType');
}

/*
 * 内联表是 TOML 1.0 中表达嵌套对象和对象数组的直接方式。使用统一的
 * 内联值还可以保留数组顺序，并允许数组中混合标量、数组和内联表。
 */
function tomlValue(value: unknown): string {
  if (value === null) convertFail('tomlNull');
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  if (isPlainObject(value)) {
    return `{ ${Object.entries(value)
      .map(([key, child]) => `${tomlKey(key)} = ${tomlValue(child)}`)
      .join(', ')} }`;
  }
  return tomlScalar(value);
}

function jsonToToml(value: unknown): string {
  if (!isPlainObject(value)) convertFail('tomlRoot');
  const lines = Object.entries(value).map(
    ([key, child]) => `${tomlKey(key)} = ${tomlValue(child)}`,
  );
  return lines.length ? `${lines.join('\n')}\n` : '';
}

function isXmlNameStart(codePoint: number): boolean {
  return (
    codePoint === 0x5f ||
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a) ||
    (codePoint >= 0xc0 && codePoint <= 0xd6) ||
    (codePoint >= 0xd8 && codePoint <= 0xf6) ||
    (codePoint >= 0xf8 && codePoint <= 0x2ff) ||
    (codePoint >= 0x370 && codePoint <= 0x37d) ||
    (codePoint >= 0x37f && codePoint <= 0x1fff) ||
    (codePoint >= 0x200c && codePoint <= 0x200d) ||
    (codePoint >= 0x2070 && codePoint <= 0x218f) ||
    (codePoint >= 0x2c00 && codePoint <= 0x2fef) ||
    (codePoint >= 0x3001 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfdcf) ||
    (codePoint >= 0xfdf0 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0xeffff)
  );
}

function isXmlNameChar(codePoint: number): boolean {
  return (
    isXmlNameStart(codePoint) ||
    codePoint === 0x2d ||
    codePoint === 0x2e ||
    codePoint === 0xb7 ||
    (codePoint >= 0x30 && codePoint <= 0x39) ||
    (codePoint >= 0x300 && codePoint <= 0x36f) ||
    (codePoint >= 0x203f && codePoint <= 0x2040)
  );
}

function xmlName(key: string): string {
  // 不接受冒号，避免生成未声明 namespace 前缀的 XML。
  if (!key || key.includes(':')) convertFail('xmlInvalidName', { key });
  let first = true;
  for (const character of key) {
    const codePoint = character.codePointAt(0) as number;
    if ((first && !isXmlNameStart(codePoint)) || (!first && !isXmlNameChar(codePoint)))
      convertFail('xmlInvalidName', { key });
    first = false;
  }
  return key;
}

function isXmlCharacter(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

function xmlText(value: string): string {
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    if (!isXmlCharacter(codePoint))
      convertFail('xmlInvalidCharacter', {
        codePoint: `U+${codePoint.toString(16).toUpperCase()}`,
      });
  }
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function xmlScalar(value: unknown): string {
  if (typeof value === 'string') return xmlText(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return finiteNumber(value);
  return convertFail('unsupportedType');
}

function xmlNode(value: unknown, key: string, indent: number): string {
  const pad = '  '.repeat(indent);
  const name = xmlName(key);
  if (value === null) return `${pad}<${name} nil="true" />`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}<${name} />`;
    return value.map((item) => xmlNode(item, key, indent)).join('\n');
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return `${pad}<${name} />`;
    return `${pad}<${name}>\n${keys
      .map((child) => xmlNode(value[child], child, indent + 1))
      .join('\n')}\n${pad}</${name}>`;
  }
  return `${pad}<${name}>${xmlScalar(value)}</${name}>`;
}

function jsonToXml(value: unknown): string {
  const header = '<?xml version="1.0" encoding="UTF-8"?>';
  if (value === null) return `${header}\n<root nil="true" />\n`;
  if (typeof value !== 'object') return `${header}\n<root>${xmlScalar(value)}</root>\n`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${header}\n<root />\n`;
    return `${header}\n<root>\n${value.map((item) => xmlNode(item, 'item', 1)).join('\n')}\n</root>\n`;
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.length === 0) return `${header}\n<root />\n`;
  return `${header}\n<root>\n${keys
    .map((key) => xmlNode(object[key], key, 1))
    .join('\n')}\n</root>\n`;
}

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return csvEscape(JSON.stringify(value));
  if (typeof value === 'string') return csvEscape(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return finiteNumber(value);
  return convertFail('unsupportedType');
}

function jsonToCsv(value: unknown): string {
  if (value === null || typeof value !== 'object') return `${csvCell(value)}\r\n`;
  if (!Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object);
    if (keys.length === 0) return '\r\n';
    return `${keys.map(csvEscape).join(',')}\r\n${keys
      .map((key) => csvCell(object[key]))
      .join(',')}\r\n`;
  }
  if (value.length === 0) return '';

  const allObjects = value.every((item) => isPlainObject(item));
  const allScalars = value.every((item) => item === null || typeof item !== 'object');
  const allArrays = value.every((item) => Array.isArray(item));
  if (allObjects) {
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const row of value) {
      const rowObject = row as Record<string, unknown>;
      for (const key of Object.keys(rowObject)) {
        if (seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
      }
    }
    const rows = value.map((row) => {
      const rowObject = row as Record<string, unknown>;
      return keys.map((key) => csvCell(rowObject[key])).join(',');
    });
    return `${[keys.map(csvEscape).join(','), ...rows].join('\r\n')}\r\n`;
  }
  if (allScalars) return `${value.map(csvCell).join('\r\n')}\r\n`;
  if (allArrays) {
    const width = Math.max(0, ...value.map((row) => (row as unknown[]).length));
    return `${value
      .map((row) => {
        const cells = [...(row as unknown[])];
        while (cells.length < width) cells.push('');
        return cells.map(csvCell).join(',');
      })
      .join('\r\n')}\r\n`;
  }
  return convertFail('csvMixedRows');
}

/** 从输入原文安全转换为目标格式；失败时抛出带稳定 code 的 JsonConverterError。 */
export function convertJson(input: string, format: JsonConvertFormat): string {
  if (!JSON_CONVERT_FORMATS.includes(format)) convertFail('unsupportedFormat');
  const value = parseJsonSource(input);
  if (format === 'yaml') return jsonToYaml(value);
  if (format === 'xml') return jsonToXml(value);
  if (format === 'toml') return jsonToToml(value);
  return jsonToCsv(value);
}

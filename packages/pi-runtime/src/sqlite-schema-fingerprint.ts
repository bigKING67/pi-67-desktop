const MAX_SCHEMA_SQL_CHARS = 32 * 1024;
const MAX_SCHEMA_TOKEN_COUNT = 4_096;

type SchemaTokenKind = "blob" | "number" | "operator" | "quoted" | "string" | "word";

export class SchemaSqlFingerprintError extends Error {}

export function fingerprintSchemaSql(sql: string): string {
  if (sql.length > MAX_SCHEMA_SQL_CHARS) {
    throw new SchemaSqlFingerprintError("Schema SQL exceeds the supported size.");
  }

  const tokens: string[] = [];
  let index = 0;
  while (index < sql.length) {
    const character = sql[index]!;
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (sql.startsWith("--", index)) {
      index = skipLineComment(sql, index + 2);
      continue;
    }
    if (sql.startsWith("/*", index)) {
      index = skipBlockComment(sql, index + 2);
      continue;
    }

    let token: { kind: SchemaTokenKind; value: string; end: number };
    if ((character === "x" || character === "X") && sql[index + 1] === "'") {
      token = readQuotedToken(sql, index + 1, "'", "blob", index);
    } else if (character === "'") {
      token = readQuotedToken(sql, index, "'", "string");
    } else if (character === '"' || character === "`") {
      token = readQuotedToken(sql, index, character, "quoted");
    } else if (character === "[") {
      token = readBracketToken(sql, index);
    } else if (isWordStart(character)) {
      token = readWord(sql, index);
    } else if (isAsciiDigit(character)) {
      token = readNumber(sql, index);
    } else {
      token = readOperator(sql, index);
    }

    tokens.push(serializeToken(token.kind, token.value));
    if (tokens.length > MAX_SCHEMA_TOKEN_COUNT) {
      throw new SchemaSqlFingerprintError("Schema SQL contains too many tokens.");
    }
    index = token.end;
  }
  return tokens.join("|");
}

function skipLineComment(sql: string, index: number): number {
  while (index < sql.length && sql[index] !== "\n" && sql[index] !== "\r") index += 1;
  return index;
}

function skipBlockComment(sql: string, index: number): number {
  const closing = sql.indexOf("*/", index);
  if (closing < 0) throw new SchemaSqlFingerprintError("Schema SQL contains an unterminated comment.");
  return closing + 2;
}

function readQuotedToken(
  sql: string,
  quoteIndex: number,
  quote: string,
  kind: "blob" | "quoted" | "string",
  tokenStart = quoteIndex
): { kind: SchemaTokenKind; value: string; end: number } {
  let index = quoteIndex + 1;
  while (index < sql.length) {
    if (sql[index] !== quote) {
      index += 1;
      continue;
    }
    if (sql[index + 1] === quote) {
      index += 2;
      continue;
    }
    const end = index + 1;
    return { kind, value: sql.slice(tokenStart, end), end };
  }
  throw new SchemaSqlFingerprintError("Schema SQL contains an unterminated quoted token.");
}

function readBracketToken(sql: string, start: number): { kind: SchemaTokenKind; value: string; end: number } {
  const closing = sql.indexOf("]", start + 1);
  if (closing < 0) throw new SchemaSqlFingerprintError("Schema SQL contains an unterminated identifier.");
  const end = closing + 1;
  return { kind: "quoted", value: sql.slice(start, end), end };
}

function readWord(sql: string, start: number): { kind: SchemaTokenKind; value: string; end: number } {
  let end = start + 1;
  while (end < sql.length && isWordPart(sql[end]!)) end += 1;
  return { kind: "word", value: asciiLower(sql.slice(start, end)), end };
}

function readNumber(sql: string, start: number): { kind: SchemaTokenKind; value: string; end: number } {
  let end = start;
  if (sql.startsWith("0x", start) || sql.startsWith("0X", start)) {
    end += 2;
    while (end < sql.length && /[0-9a-fA-F]/u.test(sql[end]!)) end += 1;
  } else {
    while (end < sql.length && isAsciiDigit(sql[end]!)) end += 1;
    if (sql[end] === ".") {
      end += 1;
      while (end < sql.length && isAsciiDigit(sql[end]!)) end += 1;
    }
    const exponent = sql[end];
    if ((exponent === "e" || exponent === "E") && hasExponentDigits(sql, end + 1)) {
      end += 1;
      if (sql[end] === "+" || sql[end] === "-") end += 1;
      while (end < sql.length && isAsciiDigit(sql[end]!)) end += 1;
    }
  }
  return { kind: "number", value: sql.slice(start, end), end };
}

function hasExponentDigits(sql: string, index: number): boolean {
  if (sql[index] === "+" || sql[index] === "-") index += 1;
  return index < sql.length && isAsciiDigit(sql[index]!);
}

function readOperator(sql: string, start: number): { kind: SchemaTokenKind; value: string; end: number } {
  const threeCharacters = sql.slice(start, start + 3);
  if (threeCharacters === "->>") return { kind: "operator", value: threeCharacters, end: start + 3 };
  const twoCharacters = sql.slice(start, start + 2);
  if (["||", "<<", ">>", "<=", ">=", "==", "!=", "<>", "->"].includes(twoCharacters)) {
    return { kind: "operator", value: twoCharacters, end: start + 2 };
  }
  return { kind: "operator", value: sql[start]!, end: start + 1 };
}

function serializeToken(kind: SchemaTokenKind, value: string): string {
  return `${kind}:${value.length}:${value}`;
}

function isWordStart(character: string): boolean {
  const code = character.codePointAt(0)!;
  return character === "_" || isAsciiLetter(character) || code >= 0x80;
}

function isWordPart(character: string): boolean {
  return isWordStart(character) || isAsciiDigit(character) || character === "$";
}

function isAsciiLetter(character: string): boolean {
  return (character >= "A" && character <= "Z") || (character >= "a" && character <= "z");
}

function isAsciiDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/gu, (character) => character.toLowerCase());
}

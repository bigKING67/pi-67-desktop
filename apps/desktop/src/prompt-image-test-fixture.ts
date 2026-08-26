export function heifFixture(
  width: number,
  height: number,
  brand = "heic"
): Uint8Array {
  const ftyp = box("ftyp", [ascii(brand), uint32(0), ascii("mif1"), ascii("heic")]);
  const ispe = box("ispe", [uint32(0), uint32(width), uint32(height)]);
  const ipco = box("ipco", [ispe]);
  const iprp = box("iprp", [ipco]);
  const meta = box("meta", [uint32(0), iprp]);
  return concat([ftyp, meta]);
}

export function jpegFixture(
  width: number,
  height: number,
  options: { metadata?: boolean } = {}
): Uint8Array {
  const metadata = options.metadata
    ? Uint8Array.from([0xff, 0xe1, 0x00, 0x04, 0x45, 0x78])
    : new Uint8Array();
  const frame = Uint8Array.from([
    0xff, 0xc0,
    0x00, 0x0b,
    0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x01,
    0x01, 0x11, 0x00
  ]);
  return concat([
    Uint8Array.from([0xff, 0xd8]),
    metadata,
    frame,
    Uint8Array.from([0xff, 0xda, 0xff, 0xd9])
  ]);
}

function box(type: string, contents: readonly Uint8Array[]): Uint8Array {
  const content = concat(contents);
  return concat([uint32(content.byteLength + 8), ascii(type), content]);
}

function uint32(value: number): Uint8Array {
  return Uint8Array.from([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ]);
}

function ascii(value: string): Uint8Array {
  return Uint8Array.from({ length: value.length }, (_, index) => value.charCodeAt(index));
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

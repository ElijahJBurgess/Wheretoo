export interface CanonicalClientAddress {
  actorInput: string;
  networkInput: string;
}

function parseIpv4(value: string): Uint8Array | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === undefined || !/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const number = Number(part);
    if (number > 255) return null;
    bytes[index] = number;
  }
  return bytes;
}

function parseIpv6(value: string): Uint8Array | null {
  if (
    value.length === 0 || value.includes("%") || value.includes(":::") ||
    value.split("::").length > 2
  ) return null;
  let source = value;
  const finalColon = source.lastIndexOf(":");
  if (source.includes(".")) {
    if (finalColon === -1) return null;
    const embedded = parseIpv4(source.slice(finalColon + 1));
    if (embedded === null) return null;
    source = `${source.slice(0, finalColon)}:${
      (embedded[0]! << 8 | embedded[1]!).toString(16)
    }:${(embedded[2]! << 8 | embedded[3]!).toString(16)}`;
  }
  const hasCompression = source.includes("::");
  const [leftText, rightText] = source.split("::", 2);
  const left = leftText === "" ? [] : leftText.split(":");
  const right = rightText === undefined || rightText === ""
    ? []
    : rightText.split(":");
  if (
    (!hasCompression && left.length !== 8) ||
    (hasCompression && left.length + right.length >= 8)
  ) return null;
  const groups = [
    ...left,
    ...Array(hasCompression ? 8 - left.length - right.length : 0).fill("0"),
    ...right,
  ];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-fA-F]{1,4}$/.test(group))
  ) return null;
  const bytes = new Uint8Array(16);
  for (let index = 0; index < groups.length; index += 1) {
    const group = Number.parseInt(groups[index]!, 16);
    bytes[index * 2] = group >>> 8;
    bytes[index * 2 + 1] = group & 0xff;
  }
  return bytes;
}

function ipv6Text(bytes: Uint8Array): string {
  const groups = Array.from(
    { length: 8 },
    (_, index) => (bytes[index * 2]! << 8 | bytes[index * 2 + 1]!).toString(16),
  );
  let bestStart = -1;
  let bestLength = 0;
  for (let start = 0; start < groups.length;) {
    if (groups[start] !== "0") {
      start += 1;
      continue;
    }
    let end = start;
    while (end < groups.length && groups[end] === "0") end += 1;
    if (end - start > bestLength && end - start >= 2) {
      bestStart = start;
      bestLength = end - start;
    }
    start = end;
  }
  if (bestStart === -1) return groups.join(":");
  const left = groups.slice(0, bestStart).join(":");
  const right = groups.slice(bestStart + bestLength).join(":");
  return left.length === 0
    ? `::${right}`
    : right.length === 0
    ? `${left}::`
    : `${left}::${right}`;
}

export function canonicalizeClientAddress(
  value: string | null,
): CanonicalClientAddress | null {
  if (value === null || value !== value.trim()) return null;
  const ipv4 = parseIpv4(value);
  if (ipv4 !== null) {
    const actor = Array.from(ipv4).join(".");
    return {
      actorInput: `ipv4:${actor}`,
      networkInput: `ipv4:${ipv4[0]}.${ipv4[1]}.${ipv4[2]}.0/24`,
    };
  }
  const ipv6 = parseIpv6(value);
  if (ipv6 === null) return null;
  const network = ipv6.slice();
  network.fill(0, 8);
  return {
    actorInput: `ipv6:${ipv6Text(ipv6)}`,
    networkInput: `ipv6:${ipv6Text(network)}/64`,
  };
}

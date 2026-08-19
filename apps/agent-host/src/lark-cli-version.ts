const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u;

export function isLarkCliVersion(value: string): boolean {
  try {
    parseVersion(value);
    return true;
  } catch {
    return false;
  }
}

export function compareLarkCliVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftVersion.numbers[index]! - rightVersion.numbers[index]!;
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  if (leftVersion.prerelease === rightVersion.prerelease) return 0;
  if (!leftVersion.prerelease) return 1;
  if (!rightVersion.prerelease) return -1;
  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

function parseVersion(value: string): { numbers: [number, number, number]; prerelease?: string } {
  const match = VERSION_PATTERN.exec(value);
  if (!match) throw new Error("Lark CLI version must use semantic versioning.");
  const numbers = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number];
  if (numbers.some((part) => !Number.isSafeInteger(part))) {
    throw new Error("Lark CLI version is outside the supported range.");
  }
  return { numbers, ...(match[4] ? { prerelease: match[4] } : {}) };
}

function comparePrerelease(left: string, right: string): number {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const count = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === rightPart) continue;
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const comparison = compareNumericIdentifier(leftPart, rightPart);
      if (comparison !== 0) return comparison;
      continue;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function compareNumericIdentifier(left: string, right: string): number {
  const normalizedLeft = left.replace(/^0+(?=\d)/u, "");
  const normalizedRight = right.replace(/^0+(?=\d)/u, "");
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length < normalizedRight.length ? -1 : 1;
  }
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft < normalizedRight ? -1 : 1;
}

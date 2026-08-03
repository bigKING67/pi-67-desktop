const MAX_AUTO_COMMAND_CHARACTERS = 4_096;

type ShellOperator = "and" | "pipe";

export interface ParsedShellCommand {
  commands: string[][];
  operators: ShellOperator[];
}

export function parseBoundedShellCommand(command: string): ParsedShellCommand | undefined {
  if (!command || command.length > MAX_AUTO_COMMAND_CHARACTERS) return undefined;
  const commands: string[][] = [];
  const operators: ShellOperator[] = [];
  let tokens: string[] = [];
  let token = "";
  let tokenStarted = false;
  let quote: "single" | "double" | undefined;

  const finishToken = (): void => {
    if (!tokenStarted) return;
    tokens.push(token);
    token = "";
    tokenStarted = false;
  };
  const finishCommand = (operator?: ShellOperator): boolean => {
    finishToken();
    if (tokens.length === 0) return false;
    commands.push(tokens);
    tokens = [];
    if (operator) operators.push(operator);
    return true;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? "";
    if (character === "\n" || character === "\r") return undefined;
    if (quote === "single") {
      if (character === "'") quote = undefined;
      else token += character;
      continue;
    }
    if (quote === "double") {
      if (character === '"') {
        quote = undefined;
        continue;
      }
      if (character === "`" || character === "$") return undefined;
      if (character === "\\") {
        const next = command[index + 1];
        if (next === undefined || next === "\n" || next === "\r") return undefined;
        token += next;
        index += 1;
      } else {
        token += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character === "'" ? "single" : "double";
      tokenStarted = true;
      continue;
    }
    if (/\s/u.test(character)) {
      finishToken();
      continue;
    }
    if (character === "\\") {
      const next = command[index + 1];
      if (next === undefined || next === "\n" || next === "\r") return undefined;
      token += next;
      tokenStarted = true;
      index += 1;
      continue;
    }
    if (character === "&") {
      if (command[index + 1] !== "&" || !finishCommand("and")) return undefined;
      index += 1;
      continue;
    }
    if (character === "|") {
      if (command[index + 1] === "|" || command[index + 1] === "&" || !finishCommand("pipe")) return undefined;
      continue;
    }
    if ([";", ">", "<", "`", "$", "(", ")"].includes(character)) return undefined;
    token += character;
    tokenStarted = true;
  }
  if (quote || !finishCommand()) return undefined;
  return commands.length === operators.length + 1 ? { commands, operators } : undefined;
}

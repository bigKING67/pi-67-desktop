import type {
  LarkAppConfigurationInput,
  LarkAuthLoginStartResult,
  LarkAuthSnapshot
} from "@pi67/domain";

export interface LarkCommandPayloads {
  "lark.auth.status": Record<string, never>;
  "lark.auth.login.begin": Record<string, never>;
  "lark.app.configuration.save": LarkAppConfigurationInput;
}

export interface LarkCommandResults {
  "lark.auth.status": LarkAuthSnapshot;
  "lark.auth.login.begin": LarkAuthLoginStartResult;
  "lark.app.configuration.save": LarkAuthSnapshot;
}

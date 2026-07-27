import { zhCNMessages } from "./zh-cn.js";

type WidenCatalog<T> = T extends (...arguments_: infer Arguments) => string
  ? (...arguments_: Arguments) => string
  : T extends string
    ? string
    : { readonly [Key in keyof T]: WidenCatalog<T[Key]> };

export type MessageCatalog = WidenCatalog<typeof zhCNMessages>;

export const appLocale = "zh-CN" as const;
export const messages: MessageCatalog = zhCNMessages;

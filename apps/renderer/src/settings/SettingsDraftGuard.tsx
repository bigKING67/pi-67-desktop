import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef
} from "react";

export interface SettingsDraftRegistration {
  dirty: boolean;
  busy: boolean;
  subject: string;
  discard: () => void;
}

export type SettingsDraftRegistrar = (
  registration: SettingsDraftRegistration
) => () => void;

export function combineSettingsDrafts(drafts: SettingsDraftRegistration[]): SettingsDraftRegistration | undefined {
  if (!drafts.length) return undefined;
  return { dirty: drafts.some((draft) => draft.dirty), busy: drafts.some((draft) => draft.busy),
    subject: [...new Set(drafts.filter((draft) => draft.dirty || draft.busy).map((draft) => draft.subject))].join("、") || drafts[0]!.subject,
    discard: () => { for (const draft of drafts) if (draft.dirty) draft.discard(); }
  };
}

export const SettingsDraftGuardContext = createContext<SettingsDraftRegistrar | undefined>(undefined);

export function useSettingsDraftRegistration({
  dirty,
  busy,
  subject,
  discard
}: SettingsDraftRegistration): void {
  const register = useContext(SettingsDraftGuardContext);
  const discardRef = useRef(discard);
  discardRef.current = discard;

  useLayoutEffect(() => {
    if (!register) return;
    return register({
      dirty,
      busy,
      subject,
      discard: () => discardRef.current()
    });
  }, [busy, dirty, register, subject]);
}

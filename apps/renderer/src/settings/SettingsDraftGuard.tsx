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

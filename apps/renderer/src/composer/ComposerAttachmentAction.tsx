import { Plus } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "react-aria-components";
import { messages } from "../localization/message-catalog.js";
import styles from "./Composer.module.css";

export function ComposerAttachmentAction({
  disabled,
  inputRef,
  onAdd
}: {
  disabled: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onAdd: (files: FileList | never[]) => void;
}) {
  return (
    <>
      <input
        ref={inputRef}
        aria-label={messages.composer.chooseAttachment}
        className="sr-only"
        disabled={disabled}
        multiple
        type="file"
        onChange={(event) => {
          onAdd(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
        }}
      />
      <Button
        aria-label={messages.composer.addAttachment}
        className={`icon-button ${styles.attachmentButton}`}
        isDisabled={disabled}
        onPress={() => inputRef.current?.click()}
      ><Plus size={17} /></Button>
    </>
  );
}

import { ArrowUp, Check, ChevronDown, ListPlus } from "lucide-react";
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { messages } from "../localization/message-catalog.js";
import styles from "./ComposerStreamModeControl.module.css";

const MODES = ["steer", "followUp"] as const;

export function ComposerStreamModeControl({
  disabled,
  mode,
  onChange
}: {
  disabled: boolean;
  mode: "steer" | "followUp";
  onChange: (mode: "steer" | "followUp") => void;
}) {
  const label = mode === "steer" ? messages.composer.steer : messages.composer.followUp;
  const Icon = mode === "steer" ? ArrowUp : ListPlus;
  return (
    <MenuTrigger>
      <Button
        aria-label={`${messages.composer.streamingDelivery}：${label}`}
        className={styles.streamModeButton!}
        isDisabled={disabled}
      >
        <Icon aria-hidden="true" size={13} />
        <span>{label}</span>
        <ChevronDown aria-hidden="true" size={12} />
      </Button>
      <Popover className={styles.streamModePopover!} offset={6} placement="top start" shouldFlip>
        <Menu
          aria-label={messages.composer.streamingDelivery}
          className={styles.streamModeMenu!}
          selectedKeys={[mode]}
          selectionMode="single"
          onAction={(key) => {
            if (key === "steer" || key === "followUp") onChange(key);
          }}
        >
          {MODES.map((candidate) => {
            const CandidateIcon = candidate === "steer" ? ArrowUp : ListPlus;
            const candidateLabel = candidate === "steer" ? messages.composer.steer : messages.composer.followUp;
            const candidateDetail = candidate === "steer"
              ? messages.composer.steerDetail
              : messages.composer.followUpDetail;
            return (
              <MenuItem className={styles.streamModeOption!} id={candidate} key={candidate} textValue={candidateLabel}>
                <CandidateIcon aria-hidden="true" size={14} />
                <span>
                  <strong>{candidateLabel}</strong>
                  <small>{candidateDetail}</small>
                </span>
                {candidate === mode ? <Check aria-hidden="true" size={14} /> : null}
              </MenuItem>
            );
          })}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

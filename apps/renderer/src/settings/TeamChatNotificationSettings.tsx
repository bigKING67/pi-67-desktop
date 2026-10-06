import { messages } from "../localization/message-catalog.js";
import {
  TEAM_CHAT_NOTIFICATION_TOPICS,
  updateTeamChatNotificationPreferences,
  useTeamChatNotificationPreferences
} from "../team-chat/team-chat-notification-preferences.js";
import { SettingsCheckbox, SettingsRow, SettingsRows, SettingsSectionBlock, SettingsSwitch } from "./SettingsPrimitives.js";
import styles from "./SettingsWorkbench.module.css";

/** Team Chat system notifications on this device (ADR 0006); muting a conversation lives in Chat. */
export function TeamChatNotificationSettings() {
  const copy = messages.teamChat.notificationSettings;
  const preferences = useTeamChatNotificationPreferences();
  return (
    <SettingsSectionBlock description={copy.description} info={copy.muteHint} title={copy.title}>
      <SettingsRows>
        <SettingsRow
          actions={<SettingsSwitch isSelected={preferences.enabled} label={copy.enabled}
            onChange={(enabled) => updateTeamChatNotificationPreferences({ enabled })} />}
          description={copy.systemDescription}
          title={copy.system}
        />
        <SettingsRow title={copy.topicsTitle}>
          <span aria-label={copy.topicsTitle} className={styles.notificationTopics} role="group">
            {TEAM_CHAT_NOTIFICATION_TOPICS.map((topic) => (
              <SettingsCheckbox isDisabled={!preferences.enabled} isSelected={preferences.topics[topic]} key={topic}
                onChange={(selected) => updateTeamChatNotificationPreferences({ topics: { [topic]: selected } })}>
                {copy.topics[topic]}
              </SettingsCheckbox>
            ))}
          </span>
        </SettingsRow>
        <SettingsRow
          actions={<SettingsSwitch isDisabled={!preferences.enabled} isSelected={preferences.preview} label={copy.preview}
            onChange={(preview) => updateTeamChatNotificationPreferences({ preview })} />}
          description={copy.previewDescription}
          title={copy.previewTitle}
        />
      </SettingsRows>
    </SettingsSectionBlock>
  );
}

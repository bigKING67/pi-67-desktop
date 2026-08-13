import {
  beginTaskDraftShutdown,
  initializeTaskDraftPersistence,
  persistTaskDraftStateCheckpoint
} from "./task-draft-persistence.js";

export const taskDraftShutdownCheckpoint = {
  initialize: initializeTaskDraftPersistence,
  begin: beginTaskDraftShutdown,
  persist: persistTaskDraftStateCheckpoint
};

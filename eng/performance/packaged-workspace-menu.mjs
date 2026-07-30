export async function locateWorkspaceSessionImportAction(window) {
  await window.getByTestId("workspace-menu-trigger").first().click();
  const action = window.getByRole("menuitem", { name: "导入 Pi Session", exact: true });
  await action.waitFor({ state: "visible" });
  return action;
}

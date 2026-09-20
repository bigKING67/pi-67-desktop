import { expect, it } from "vitest";
import { newMoneyErrorMessage } from "./new-money-error-message.js";

it("distinguishes model policy, membership and request admission without assuming a cause", () => {
  expect(newMoneyErrorMessage(new Error("The current model is not authorized to process this team's shared content."), "失败")).toContain("模型政策");
  expect(newMoneyErrorMessage(new Error("The New Money team does not have permission for this operation."), "失败")).toContain("项目访问权限");
  expect(newMoneyErrorMessage(new Error("Team Tool admission requires a currently authorized model request."), "失败")).toContain("不会自动");
  expect(newMoneyErrorMessage(new Error("Team worker lifecycle unavailable."), "失败")).toContain("运行诊断");
  expect(newMoneyErrorMessage(new Error("Unknown failure"), "失败")).toBe("Unknown failure");
  expect(newMoneyErrorMessage(null, "失败")).toBe("失败");
});

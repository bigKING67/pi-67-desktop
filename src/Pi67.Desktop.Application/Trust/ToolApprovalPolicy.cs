using Pi67.Desktop.Domain.Security;

namespace Pi67.Desktop.Application.Trust;

public interface IToolApprovalPolicy
{
    ToolApprovalDecision Evaluate(ToolApprovalRequest request);
}

public sealed class BalancedToolApprovalPolicy : IToolApprovalPolicy
{
    public ToolApprovalDecision Evaluate(ToolApprovalRequest request) =>
        request.RiskCategory switch
        {
            ToolRiskCategory.WorkspaceRead when request.IsWorkspaceContained =>
                ToolApprovalDecision.AllowAutomatically,
            ToolRiskCategory.WorkspaceWrite when request.IsWorkspaceContained =>
                ToolApprovalDecision.AllowAutomatically,
            _ => ToolApprovalDecision.AllowOnce,
        };
}

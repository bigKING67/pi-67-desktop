using Pi67.Desktop.Application.Trust;
using Pi67.Desktop.Domain.Security;

namespace Pi67.Desktop.Application.Tests.Trust;

public sealed class BalancedToolApprovalPolicyTests
{
    private readonly BalancedToolApprovalPolicy policy = new();

    [Theory]
    [InlineData(ToolRiskCategory.WorkspaceRead)]
    [InlineData(ToolRiskCategory.WorkspaceWrite)]
    public void EvaluateAutomaticallyAllowsContainedWorkspaceOperations(ToolRiskCategory category)
    {
        ToolApprovalRequest request = new("call-1", "read", category, "read file", "C:\\repo\\file", true);

        Assert.Equal(ToolApprovalDecision.AllowAutomatically, policy.Evaluate(request));
    }

    [Theory]
    [InlineData(ToolRiskCategory.ExternalPath)]
    [InlineData(ToolRiskCategory.DestructiveShell)]
    [InlineData(ToolRiskCategory.DependencyChange)]
    [InlineData(ToolRiskCategory.GitExternalAction)]
    public void EvaluateRequiresOneShotApprovalForSensitiveOperations(ToolRiskCategory category)
    {
        ToolApprovalRequest request = new("call-1", "bash", category, "sensitive", null, false);

        Assert.Equal(ToolApprovalDecision.AllowOnce, policy.Evaluate(request));
    }
}

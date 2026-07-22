namespace Pi67.Desktop.Application.Diagnostics;

public sealed record DiagnosticItem(
    string Code,
    string Title,
    string Status,
    string Summary,
    string? Remediation);

public sealed record DiagnosticReport(
    string Schema,
    string DesktopVersion,
    DateTimeOffset GeneratedAt,
    IReadOnlyList<DiagnosticItem> Items);

public interface IDiagnosticReportBuilder
{
    Task<DiagnosticReport> BuildAsync(CancellationToken cancellationToken);
}

namespace Pi67.Desktop.Application;

public sealed record OperationError(string Code, string Message, string? Detail = null)
{
    public static OperationError Cancelled(string message = "The operation was cancelled.") =>
        new("operation.cancelled", message);
}

public readonly record struct OperationResult<T>
{
    internal OperationResult(T? value, OperationError? error, bool isSuccess)
    {
        Value = value;
        Error = error;
        IsSuccess = isSuccess;
    }

    public bool IsSuccess { get; }

    public T? Value { get; }

    public OperationError? Error { get; }

}

public static class OperationResult
{
    public static OperationResult<T> Success<T>(T value) => new(value, null, true);

    public static OperationResult<T> Failure<T>(OperationError error) => new(default, error, false);
}

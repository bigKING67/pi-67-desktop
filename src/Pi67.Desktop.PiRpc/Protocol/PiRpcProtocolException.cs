namespace Pi67.Desktop.PiRpc.Protocol;

public sealed class PiRpcProtocolException(string code, string message, Exception? innerException = null)
    : IOException(message, innerException)
{
    public string Code { get; } = code;
}

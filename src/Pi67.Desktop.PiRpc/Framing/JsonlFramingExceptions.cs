namespace Pi67.Desktop.PiRpc.Framing;

public sealed class JsonlFrameTooLargeException(int maximumBytes)
    : IOException($"Pi RPC frame exceeded the {maximumBytes} byte limit.")
{
    public int MaximumBytes { get; } = maximumBytes;
}

public sealed class TruncatedJsonlFrameException(long remainingBytes)
    : IOException($"Pi RPC stdout ended with a truncated {remainingBytes} byte frame.")
{
    public long RemainingBytes { get; } = remainingBytes;
}

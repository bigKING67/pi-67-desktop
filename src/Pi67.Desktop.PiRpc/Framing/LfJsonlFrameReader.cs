using System.Buffers;
using System.IO.Pipelines;
using System.Runtime.CompilerServices;

namespace Pi67.Desktop.PiRpc.Framing;

public static class LfJsonlFrameReader
{
    public const int DefaultMaximumFrameBytes = 16 * 1024 * 1024;

    public static async IAsyncEnumerable<ReadOnlyMemory<byte>> ReadFramesAsync(
        Stream stream,
        int maximumFrameBytes = DefaultMaximumFrameBytes,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(stream);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maximumFrameBytes);

        PipeReader reader = PipeReader.Create(
            stream,
            new StreamPipeReaderOptions(
                bufferSize: 16 * 1024,
                minimumReadSize: 4 * 1024,
                leaveOpen: true));

        try
        {
            while (true)
            {
                ReadResult result = await reader.ReadAsync(cancellationToken).ConfigureAwait(false);
                ReadOnlySequence<byte> buffer = result.Buffer;

                while (TryReadFrame(ref buffer, maximumFrameBytes, out ReadOnlyMemory<byte> frame))
                {
                    yield return frame;
                }

                if (buffer.Length > maximumFrameBytes)
                {
                    throw new JsonlFrameTooLargeException(maximumFrameBytes);
                }

                reader.AdvanceTo(buffer.Start, buffer.End);

                if (result.IsCompleted)
                {
                    if (!buffer.IsEmpty)
                    {
                        throw new TruncatedJsonlFrameException(buffer.Length);
                    }

                    break;
                }
            }
        }
        finally
        {
            await reader.CompleteAsync().ConfigureAwait(false);
        }
    }

    private static bool TryReadFrame(
        ref ReadOnlySequence<byte> buffer,
        int maximumFrameBytes,
        out ReadOnlyMemory<byte> frame)
    {
        SequencePosition? lineFeed = buffer.PositionOf((byte)'\n');
        if (lineFeed is null)
        {
            frame = default;
            return false;
        }

        ReadOnlySequence<byte> line = buffer.Slice(0, lineFeed.Value);
        if (line.Length > maximumFrameBytes)
        {
            throw new JsonlFrameTooLargeException(maximumFrameBytes);
        }

        if (!line.IsEmpty && GetLastByte(line) == (byte)'\r')
        {
            line = line.Slice(0, line.Length - 1);
        }

        frame = line.ToArray();
        buffer = buffer.Slice(buffer.GetPosition(1, lineFeed.Value));
        return true;
    }

    private static byte GetLastByte(ReadOnlySequence<byte> sequence)
    {
        ReadOnlySpan<byte> lastSpan = sequence.Slice(sequence.Length - 1, 1).FirstSpan;
        return lastSpan[0];
    }
}

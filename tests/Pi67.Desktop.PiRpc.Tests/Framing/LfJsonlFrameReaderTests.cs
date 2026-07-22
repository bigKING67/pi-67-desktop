using System.Text;
using Pi67.Desktop.PiRpc.Framing;

namespace Pi67.Desktop.PiRpc.Tests.Framing;

public sealed class LfJsonlFrameReaderTests
{
    [Fact]
    public async Task ReadFramesAsyncSplitsOnlyOnLfAndAcceptsCrLf()
    {
        await using MemoryStream stream = new(Encoding.UTF8.GetBytes("{\"text\":\"a\u2028b\u2029c\"}\r\n{\"ok\":true}\n"));
        List<string> frames = [];

        await foreach (ReadOnlyMemory<byte> frame in LfJsonlFrameReader.ReadFramesAsync(
            stream,
            cancellationToken: TestContext.Current.CancellationToken))
        {
            frames.Add(Encoding.UTF8.GetString(frame.Span));
        }

        Assert.Equal(["{\"text\":\"a\u2028b\u2029c\"}", "{\"ok\":true}"], frames);
    }

    [Fact]
    public async Task ReadFramesAsyncRejectsTruncatedFinalFrame()
    {
        await using MemoryStream stream = new(Encoding.UTF8.GetBytes("{\"ok\":true}"));

        async Task ConsumeAsync()
        {
            await foreach (ReadOnlyMemory<byte> _ in LfJsonlFrameReader.ReadFramesAsync(
                stream,
                cancellationToken: TestContext.Current.CancellationToken))
            {
            }
        }

        TruncatedJsonlFrameException error = await Assert.ThrowsAsync<TruncatedJsonlFrameException>(ConsumeAsync);
        Assert.True(error.RemainingBytes > 0);
    }

    [Fact]
    public async Task ReadFramesAsyncRejectsOversizedFrame()
    {
        await using MemoryStream stream = new(Encoding.UTF8.GetBytes("12345\n"));

        async Task ConsumeAsync()
        {
            await foreach (ReadOnlyMemory<byte> _ in LfJsonlFrameReader.ReadFramesAsync(
                stream,
                maximumFrameBytes: 4,
                cancellationToken: TestContext.Current.CancellationToken))
            {
            }
        }

        JsonlFrameTooLargeException error = await Assert.ThrowsAsync<JsonlFrameTooLargeException>(ConsumeAsync);
        Assert.Equal(4, error.MaximumBytes);
    }
}

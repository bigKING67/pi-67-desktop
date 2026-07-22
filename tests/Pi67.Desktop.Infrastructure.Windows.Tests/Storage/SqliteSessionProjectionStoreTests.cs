using Pi67.Desktop.Domain.Sessions;
using Pi67.Desktop.Infrastructure.Windows.Storage;

namespace Pi67.Desktop.Infrastructure.Windows.Tests.Storage;

public sealed class SqliteSessionProjectionStoreTests
{
    [Fact]
    public async Task StoreRoundTripsDisposableSessionProjection()
    {
        string root = Path.Combine(Path.GetTempPath(), $"pi67-store-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            SqliteSessionProjectionStore store = new(Path.Combine(root, "sessions.db"));
            await store.InitializeAsync(TestContext.Current.CancellationToken);
            PiSessionReference session = new(
                "thread-1",
                Path.Combine(root, "workspace"),
                Path.Combine(root, "session.jsonl"),
                "pi-session-1",
                "First session",
                DateTimeOffset.Parse("2026-07-22T01:02:03Z", System.Globalization.CultureInfo.InvariantCulture));

            await store.UpsertSessionAsync(session, TestContext.Current.CancellationToken);
            IReadOnlyList<PiSessionReference> sessions = await store.ListSessionsAsync(
                workspacePath: null,
                offset: 0,
                limit: 20,
                cancellationToken: TestContext.Current.CancellationToken);

            PiSessionReference stored = Assert.Single(sessions);
            Assert.Equal(session, stored);

            await store.DeleteProjectionAsync(session.DesktopThreadId, TestContext.Current.CancellationToken);
            Assert.Empty(await store.ListSessionsAsync(null, 0, 20, TestContext.Current.CancellationToken));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }
}

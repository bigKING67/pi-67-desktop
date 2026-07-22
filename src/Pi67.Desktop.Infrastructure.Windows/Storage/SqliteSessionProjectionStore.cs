using System.Globalization;
using Microsoft.Data.Sqlite;
using Pi67.Desktop.Application.Sessions;
using Pi67.Desktop.Domain.Sessions;

namespace Pi67.Desktop.Infrastructure.Windows.Storage;

public sealed class SqliteSessionProjectionStore : ISessionProjectionStore
{
    private const int MaximumPageSize = 200;
    private readonly string databasePath;
    private readonly string connectionString;

    public SqliteSessionProjectionStore(string databasePath)
    {
        if (string.IsNullOrWhiteSpace(databasePath))
        {
            throw new ArgumentException("Projection database path cannot be empty.", nameof(databasePath));
        }

        this.databasePath = Path.GetFullPath(databasePath);
        SqliteConnectionStringBuilder builder = new()
        {
            DataSource = this.databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared,
            Pooling = true,
        };
        connectionString = builder.ToString();
    }

    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        string? parent = Path.GetDirectoryName(databasePath);
        if (!string.IsNullOrWhiteSpace(parent))
        {
            Directory.CreateDirectory(parent);
        }

        await using SqliteConnection connection = await OpenConnectionAsync(cancellationToken).ConfigureAwait(false);
        await using SqliteCommand command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS session_projection (
                desktop_thread_id TEXT NOT NULL PRIMARY KEY,
                workspace_path TEXT NOT NULL,
                session_path TEXT NOT NULL,
                pi_session_id TEXT NULL,
                display_name TEXT NULL,
                last_opened_utc TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS ux_session_projection_path
                ON session_projection(session_path);
            CREATE INDEX IF NOT EXISTS ix_session_projection_workspace_opened
                ON session_projection(workspace_path, last_opened_utc DESC);
            PRAGMA user_version = 1;
            """;
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task UpsertSessionAsync(
        PiSessionReference session,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);
        await using SqliteConnection connection = await OpenConnectionAsync(cancellationToken).ConfigureAwait(false);
        await using SqliteCommand command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO session_projection (
                desktop_thread_id,
                workspace_path,
                session_path,
                pi_session_id,
                display_name,
                last_opened_utc)
            VALUES ($thread_id, $workspace, $session_path, $session_id, $display_name, $last_opened)
            ON CONFLICT(desktop_thread_id) DO UPDATE SET
                workspace_path = excluded.workspace_path,
                session_path = excluded.session_path,
                pi_session_id = excluded.pi_session_id,
                display_name = excluded.display_name,
                last_opened_utc = excluded.last_opened_utc;
            """;
        command.Parameters.AddWithValue("$thread_id", session.DesktopThreadId);
        command.Parameters.AddWithValue("$workspace", session.WorkspacePath);
        command.Parameters.AddWithValue("$session_path", session.SessionPath);
        command.Parameters.AddWithValue("$session_id", (object?)session.PiSessionId ?? DBNull.Value);
        command.Parameters.AddWithValue("$display_name", (object?)session.DisplayName ?? DBNull.Value);
        command.Parameters.AddWithValue(
            "$last_opened",
            session.LastOpenedAt.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture));
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<PiSessionReference>> ListSessionsAsync(
        string? workspacePath,
        int offset,
        int limit,
        CancellationToken cancellationToken)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(offset);
        ArgumentOutOfRangeException.ThrowIfLessThan(limit, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(limit, MaximumPageSize);

        await using SqliteConnection connection = await OpenConnectionAsync(cancellationToken).ConfigureAwait(false);
        await using SqliteCommand command = connection.CreateCommand();
        string? normalizedWorkspace = string.IsNullOrWhiteSpace(workspacePath)
            ? null
            : Path.GetFullPath(workspacePath);
        command.CommandText = normalizedWorkspace is null
            ? """
                SELECT desktop_thread_id, workspace_path, session_path, pi_session_id, display_name, last_opened_utc
                FROM session_projection
                ORDER BY last_opened_utc DESC
                LIMIT $limit OFFSET $offset;
                """
            : """
                SELECT desktop_thread_id, workspace_path, session_path, pi_session_id, display_name, last_opened_utc
                FROM session_projection
                WHERE workspace_path = $workspace
                ORDER BY last_opened_utc DESC
                LIMIT $limit OFFSET $offset;
                """;
        if (normalizedWorkspace is not null)
        {
            command.Parameters.AddWithValue("$workspace", normalizedWorkspace);
        }

        command.Parameters.AddWithValue("$limit", limit);
        command.Parameters.AddWithValue("$offset", offset);

        List<PiSessionReference> sessions = [];
        await using SqliteDataReader reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            sessions.Add(new PiSessionReference(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                DateTimeOffset.Parse(reader.GetString(5), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind)));
        }

        return sessions;
    }

    public async Task DeleteProjectionAsync(string desktopThreadId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(desktopThreadId))
        {
            throw new ArgumentException("Desktop thread id cannot be empty.", nameof(desktopThreadId));
        }

        await using SqliteConnection connection = await OpenConnectionAsync(cancellationToken).ConfigureAwait(false);
        await using SqliteCommand command = connection.CreateCommand();
        command.CommandText = "DELETE FROM session_projection WHERE desktop_thread_id = $thread_id;";
        command.Parameters.AddWithValue("$thread_id", desktopThreadId.Trim());
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task<SqliteConnection> OpenConnectionAsync(CancellationToken cancellationToken)
    {
        SqliteConnection connection = new(connectionString);
        try
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
            await using SqliteCommand command = connection.CreateCommand();
            command.CommandText = "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;";
            await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }
}

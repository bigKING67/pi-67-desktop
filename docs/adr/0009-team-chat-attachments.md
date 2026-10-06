# ADR 0009: Team Chat attachments and images

Status: accepted; service deployed 2026-10-06 (server `914ec47`, migration 018) and accepted on macOS with an image and a PDF; Windows validation pending.
Date: 2026-10-06

## Context

Team Chat carried text and Work Cards only; screenshots, spreadsheets and reports
went through other tools. The user confirmed on 2026-10-06: storage on the team's
own S3-compatible object store (Bitiful S4, a private bucket), at most 25 MB per
file, a 10 GB quota per team with usage visible in the admin console, and images,
common office files and archives allowed while executables are refused.

## Decision

1. **Storage.** Bytes live in a private S3-compatible bucket, never in Postgres and
   never through the New Money service. The service signs short-lived (5 minute)
   SigV4 URLs: Desktops PUT uploads and GET downloads directly; the service uses the
   same signing to HEAD-check and delete. Upload URLs sign `Content-Length` and
   `Content-Type`, so they store only the granted size and type. Credentials stay in the server's runtime
   env; URLs, object keys and file contents are never logged. Keys name no file
   (`chat/{team}/{attachment}`).
2. **Lifecycle.** `POST /chat/conversations/{id}/attachments` grants an upload after
   checking membership, posting policy, name, type, size and the team quota under a
   per-team lock (pending uploads count). Sending a message with `attachmentIds`
   HEAD-checks that each object exists with the declared size, then attaches them in
   the message's transaction; a file attaches once, only to its uploader's message
   in the same conversation. A message may be files alone (blank text counts as
   none), at most 10. A retried send with the same client key finds the stored
   message before uploads are checked.
   Grants unused for 60 minutes, and files of messages that no longer exist, are
   swept every 10 minutes and their objects deleted. Recall (ADR 0008) deletes the
   message's files.
3. **Types.** An extension allowlist (images png/jpg/gif/webp/heic; pdf and office
   documents; csv/tsv/txt/md/json/xml/rtf; zip/7z/rar/tar/gz/tgz); the content type
   comes from the server's table, never from the client. Downloads are served as
   `attachment` with the original UTF-8 name.
4. **Reading.** `POST /chat/attachments/{id}/download` returns a signed URL only for
   a ready file in a conversation the reader may read (joined, or a public channel).
   Search also matches file names; a file-only message previews its first file name.
5. **Quota.** `GET /chat/admin/storage` (owners/admins) reports used and quota bytes;
   the admin console shows a meter, never file names or content.
6. **Desktop transport.** The renderer never sees storage URLs. It streams a file to
   Agent Host in ≤1 MiB `ArrayBuffer` chunks (`teamChat.attachment.begin|chunk|
   finish|discard`), one file at a time; Host buffers at most 100 MB (uploads left
   unfinished past the five-minute grant expire), PUTs the bytes to the granted HTTPS
   URL and forgets them. `teamChat.attachment.read` downloads a file once (concurrent
   reads share it, bodies over 25 MB are refused before buffering) into a bounded
   (64 MB) Host cache, labels it with the service's recorded type, and serves ≤1 MiB
   chunks. Host drops
   every buffered byte when the account or team changes. Saving goes through a Main
   bridge (`saveTeamChatAttachment`) that asks where to save with the system dialog
   and writes only there; Main never opens the file.
7. **Desktop UI.** The composer adds files by the paperclip, paste or drop, shows a
   tray with progress, retry and remove, refuses blocked types, sizes and the
   eleventh file with an inline reason, and sends once every file is stored. The
   tray and the image cache empty when the account or team changes. Messages show
   png/jpeg/gif/webp inline (sized from stored pixel dimensions, read through the
   renderer's bounded image cache, opened in a viewer) and other files as cards
   with `保存`. Agents see `[附件：name]` lines only, never file contents.

## Consequences

- Storage cost and availability depend on the team's object store; when it is not
  configured the service answers `chat_attachments_unavailable` and Chat stays text.
- Files are readable by anyone who can read the conversation; a recalled message's
  files are deleted, but a reader may already have saved them.
- An unused upload counts toward the quota for up to 70 minutes.
- An upload URL stays valid for its five minutes even if the message is recalled
  sooner; a re-upload in that window (same size and type) leaves an object the
  sweeper does not revisit. Accepted for now; a later sweep can re-check deleted keys.
- Bytes pass Renderer → Host over IPC once per upload and Host → Renderer per read;
  25 MB files take 25 round trips but never reach disk on the Desktop until saved.

## Rejected alternatives

- Proxying bytes through the service: doubles traffic and needs large request limits.
- Storing files in Postgres: bloats backups and the database.
- Letting the renderer fetch storage URLs: widens CSP `connect-src` to the store and
  exposes signed URLs to page script.
- Trusting the client's content type: lets a renamed executable be served as an image.

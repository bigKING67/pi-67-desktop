# Pi workspace resources

This package is the source authority for the Pi resources shared by Pi TUI and
Pi-67 Desktop. It is not a third runtime or user-facing manager.

The initial source migration copied the live, tracked resource trees from the
former standalone `pi-67` repository at commit
`d5881607af002ea9e7a322564c1b68339d0e7b1a` on 2026-09-01. The imported trees
were verified before Desktop-owned metadata was added:

| Resource | Imported tree SHA-256 |
| --- | --- |
| `extensions/pi-rules-loader` | `92f8bdb0332b8812f1844284d555ec281dcd3d00c3cf49990989b19b78707a84` |
| `rules` | `8b0a2bc533658a18c2b81a1a8ee75168d8bf98c7d9853ccab1f5736f13a5a313` |
| `prompts` | `87bf7c501296ff5e0966ff5ab40946a00fbfb0b2cae506541316d4b52f661c1b` |
| `skills` | `b7ec591e0cf8f2e558e82fe9e1a1f1d0e3c898de79841ca1b175c97fcd4f2414` |

Desktop packages and verifies these resources, projects an app-owned version
into the canonical Pi Agent Profile, and preserves user-owned files. Pi remains
the ResourceLoader and agent-loop authority.

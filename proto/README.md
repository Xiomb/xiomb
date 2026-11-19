# proto

gRPC protocol between a project server and the xiomb cloud.

- `xiomb/v1/project.proto` — `ProjectService.Connect`: one bidirectional stream per project server. The server sends `ProjectMessage` (publish, play, signal, close, streams, recording, snapshots, pull, answers to `authorize`), the cloud sends `ProjectEvent` (ready, results, signals, media and stream events, statistics).
- `xiomb/v1/common.proto` — shared messages and enums: errors, directions, statuses, transports, stream and media info.

The connection is authorized with the metadata `authorization: Bearer <secret>` and `x-project-id: <project ID>`. Requests and their `Result` are matched by `request_id`.

The JS SDK loads it at runtime with `@grpc/proto-loader`; `npm pack` copies it into the package.

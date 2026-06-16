# Ripple Field Logs

Run `npm.cmd run debug:logs` to start the local receiver on
`127.0.0.1:5184`. Browser debug events append to
`ripple-debug-YYYY-MM-DD.jsonl` while the receiver is running.

Useful local views:

- `http://127.0.0.1:5184/health`
- `http://127.0.0.1:5184/tail?limit=80`
- `http://127.0.0.1:5184/events`

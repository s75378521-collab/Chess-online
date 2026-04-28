# Chessplay

This version keeps the same style and flow, but adds:

- Persistent accounts saved on the backend in `data/store.json`
- Separate admin site at `/admin/`
- Admin PIN changes from the admin site
- Better chess rules with check detection, castling, en passant, promotion, and game-end handling
- Bot difficulty behavior for `Easy`, `Medium`, and `Hard`

## Run locally

Use the bundled Node runtime:

```powershell
& 'C:\Users\Spencer Ramsay.SPENCER-RAMSAY\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\server.js
```

Or use the included launcher:

```powershell
.\start-server.cmd
```

For a no-admin public share link, run:

```powershell
.\start-share.cmd
```

It starts the server and tunnel in the background, then prints a `trycloudflare.com` link and saves it in `share-link.txt`.

To show the current saved link again:

```powershell
.\show-share.cmd
```

To stop the public share link later:

```powershell
.\stop-share.cmd
```


Then open:

- `http://localhost:3000/`
- `http://localhost:3000/admin/`

## Default admin login

- Username: `Spencer`
- Password: `qwerty`
- Admin PIN: `0000`

Change the PIN from the admin portal after logging in.

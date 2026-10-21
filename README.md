# Rumi — Pet Shop

A private pet-shop dashboard: orders, calendar, profit allocation, expenses, financial reports,
stock catalog and contacts. It has the same "Liquid Glass" look as Kalori, in light and dark mode.
On a computer it uses a sidebar. On a phone or tablet it uses a floating tab bar with bottom sheets.

- **Works fully offline.** Every device keeps the whole dataset, so all pages, orders and reports work without internet.
- **Syncs when online.** Each change is written to a JSON file in a GitHub repository and merged into your other devices.
- **Password protected.** You need the password every time the app opens, and it locks itself after a few idle minutes.
- **No build step.** It's plain HTML, CSS and JavaScript, so you can host it free on GitHub Pages.

## 1. Publish the app (GitHub Pages)

1. Push this folder to `https://github.com/amirrezaloffl-art/Rumi` (`main` branch).
   `.gitignore` keeps backups (`*backup*.json`) and the local data copy out of git.
   > GitHub Pages on a **private** repository needs a paid plan (GitHub Pro).
   > On the free plan, make `Rumi` public — it then holds only program code. Keep your data in a separate **private** repository, for example `Rumi-data`.
2. In the repository, go to **Settings → Pages → Source** and choose **GitHub Actions**.
   `.github/workflows/deploy.yml` publishes only the app files, never `data/`.
3. Open `https://amirrezaloffl-art.github.io/Rumi/`. On iPhone use Safari → Share → **Add to Home Screen**.
   On Android or desktop use Chrome or Edge → **Install app**.

The site only holds program code. Your shop data is never part of the website.

## 2. First start: create the password

The first screen asks for a new password. It is never stored. A PBKDF2 hash is used to check it, and the
key derived from it encrypts your GitHub token on the device. **The password cannot be recovered.**
If you forget it, "Reset this device" wipes the local copy. Synced data stays safe in GitHub.

If you used Appavet (Rumi's old name) before, your existing data is kept and upgraded automatically.
Download a backup first anyway (Settings → Download backup).

## 3. Turn on sync (once per device)

1. Create a **private** repository for the data, for example `Rumi-data`.
   - A public repository also works. Rumi notices it is public and encrypts the file with your password (AES-256-GCM).
   - In a private repository the file is readable JSON that you can open on github.com.
2. Create a **fine-grained token**: GitHub → Settings → Developer settings → Fine-grained tokens → *Generate*.
   - Repository access: **Only select repositories**, then pick the data repository.
   - Permissions: **Contents → Read and write**. Nothing else is needed.
3. In Rumi go to **Settings → Cloud sync**. Enter owner, repository and token, then press **Connect**.
4. On each **new phone or tablet**, the first screen has *"Already use Rumi on another device? Connect it"*.
   Enter the repository, the token and your usual password, and everything downloads.

### How sync behaves

- Every change (new order, edit, status tap, stock count, expense, settings) is saved on the device **instantly**.
  It is uploaded to `data/rumi-data.json` about 1.5 seconds later. Each upload is a commit, so the repository history is also a full backup.
- When you are offline, changes wait on the device. The header pill shows *"Offline · saved here"*. They upload automatically when you are back online.
- Other devices check for changes every 30 seconds, and whenever the app comes back to the foreground.
- If two devices edit while offline, records are merged one by one and the newest edit wins.
  Deletes are carried across devices. **Stock is never overwritten**: sales and stock counts are stored as + and − changes,
  so two devices selling the same product offline still add up correctly.
  If both devices created "order #42", one of them is renumbered.
- If you change the password on one device, the others ask for the new password once.

### Optional: a copy in a folder on your PC

In desktop Chrome or Edge, use **Settings → Copy to a folder on this computer** and pick a folder, for example this project's `data` folder.
Every change is also written to `rumi-data.local.json` there.
That file is plain JSON and is listed in `.gitignore`, so it is never committed by accident.

## Updates on your phone

Every deploy gives the service worker a new version number. A home-screen app is usually resumed rather than reloaded.
So Rumi checks for a new version each time it comes back to the foreground (and every 30 minutes while it is open).
When it finds one, it reloads as soon as you are not typing. If the network is slow or you are offline, it opens the cached copy instead.

## Backups

**Settings → Download backup** saves one JSON file with everything: orders, contacts, products, stock, expenses, funding and settings.
**Import (Merge)** adds a file's records next to yours and keeps their links correct.
**Import (Replace)** makes the file the new truth, on your synced devices too.

## Security notes (honest version)

- The lock protects the app screen, the stored GitHub token, and the cloud file when it is encrypted.
- The copy kept inside the browser on each device (IndexedDB) is **not** encrypted.
  Anyone who can use your unlocked computer with developer tools could read it. Keep your devices locked.
- Use a password you don't use anywhere else.

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell: sidebar, tab bar, sheets, lock screen |
| `styles.css` | Liquid Glass theme (tokens shared with Kalori), responsive layout |
| `app.js` | Pages, order form, profit math, charts, settings, lock screen |
| `db.js` | IndexedDB, schema upgrades, derived stock, backup import/export |
| `security.js` | Password check (PBKDF2) and AES-GCM encryption |
| `sync.js` | GitHub sync, merging, and the local folder copy |
| `jalali.js` | Jalali ↔ Gregorian dates |
| `sw.js` | Offline cache (network first, cache when offline) |

# Self-hosting on a Linux mini PC

This runs This Is You on an always-on Ubuntu Server machine, reachable only from your own devices through Tailscale. Nothing is published to the LAN or the internet.

**Status:** tested on a real Ubuntu 24.04 ARM64 virtual machine with a stand-in proxy and fictional records. **Real Tailscale, real disks and a real phone have not been tested.** [Section 9](#9-what-must-be-tested-on-the-real-machine) lists what to check before trusting it with your records. Results: [docs/reports/2026-11-03-linux-verification.md](reports/2026-11-03-linux-verification.md).

## 1. How it fits together

```
your phone --tailnet HTTPS--> [proxy: tailscale serve] --127.0.0.1--> [app] --socket + one open file--> [reader]
                               [net: holds the shared network]        /data, backups                    no network, no archive
```

| Service | Runs as | Can reach | Cannot reach |
|---|---|---|---|
| `net` | nobody | Only holds the network the proxy and app share | Everything else |
| `proxy` | `this-is-you-proxy` (10003) | The tailnet, and the app on loopback | The archive |
| `app` | `this-is-you` (10001) | The archive and the backup drive | Nothing else listens with it |
| `reader` | `this-is-you-reader` (10002) | The one open file it is handed | Network, archive, backups, everything else |

All four have a read-only filesystem, no capabilities and `no-new-privileges`. No port is published.

**Why the reader has its own container.** Bubblewrap does not run on stock Ubuntu 24.04, on the host or in Docker, even with Docker's seccomp and AppArmor protection turned off. Making it work would mean weakening other protections, so this uses Docker's own isolation instead. The app checks at every start that the reader really has no network and cannot see the archive. If either stops being true, nothing is read.

## 2. Before you start

- Ubuntu Server 24.04, with full-disk encryption if you can arrange it. Remember it is unlocked whenever the machine is running.
- Docker Engine and the Compose plugin.
- A second physical drive for backups, ideally ext4. On a drive without permissions (exFAT), rely on the encryption.
- A Tailscale account. In the admin console, turn on **MagicDNS** and **HTTPS certificates**.
- A Tailscale **auth key** that is not reusable and not ephemeral, pre-approved if you use device approval, and tagged, for example `tag:archive`.

## 3. Set up an account for yourself to run this

Whoever can use Docker can read the archive, because Docker runs as root. Keep that to one admin account.

```sh
sudo adduser archive-admin
sudo usermod -aG docker archive-admin
```

**Do not add anything else to the `docker` group: no agent, no other app, no shared account.** See [section 8](#8-keeping-agents-and-other-apps-away).

## 4. Install

```sh
sudo git clone <this repository> /opt/this-is-you
cd /opt/this-is-you
sudo chown -R archive-admin: /opt/this-is-you

# Mount the backup drive at /mnt/this-is-you/backup-drive, by UUID, with nofail so a missing drive cannot stop boot:
#   UUID=<uuid>  /mnt/this-is-you/backup-drive  ext4  defaults,nofail,x-systemd.device-timeout=10s  0  2
sudo mkdir -p /mnt/this-is-you/backup-drive
sudo mount /mnt/this-is-you/backup-drive

sudo deploy/setup-host.sh
sudo sh -c 'umask 077; cat > /srv/this-is-you/secrets/ts_authkey'   # Paste the key, Enter, Ctrl-D.
cp deploy/example.env .env && chmod 600 .env                        # Then edit it.
```

In `.env`, set your tailnet's real name in `TIY_PUBLIC_ORIGIN`, for example `https://archive.tail1234.ts.net`, with `TIY_TAILNET_NAME=archive`.

```sh
docker compose build
docker compose up -d --wait
docker compose exec app python -m this_is_you set-passphrase
docker compose exec app python -m this_is_you backup-key set
docker compose exec app python -m this_is_you doctor
```

`doctor` should say the reader is in its own container and passed its test. If it says `STOPPED`, files are stored but not read until that is fixed: see the `app` and `reader` logs.

Then, in the Tailscale admin console:

1. Restrict the machine with an ACL, so only your own devices can reach `tag:archive` on port 443.
2. Disable key expiry for this machine, or plan to re-authenticate it.
3. Delete the auth key file once the machine has joined: `sudo sh -c ': > /srv/this-is-you/secrets/ts_authkey'`. Its state in `/srv/this-is-you/tailscale` is what keeps it signed in.

Open your `https://` address on your phone and sign in.

**Never run `tailscale funnel`.** It publishes to the public internet. `deploy/tailscale-serve.json` keeps it off.

## 5. Backups

`backup-key set` asks for a passphrase, stores only a public key, and forgets the passphrase. **This machine can write backups but cannot open them.** Someone in full control of it cannot read backups it already wrote, as long as the passphrase is not stored here. Write it down and keep it elsewhere. **Lose it and those backups are gone for good.**

- **Back up now** on the Import screen writes an encrypted backup to the drive.
- **Every day:** install the timer:

```sh
sudo cp deploy/this-is-you-backup.service deploy/this-is-you-backup.timer /etc/systemd/system/
sudo systemctl enable --now this-is-you-backup.timer
```

- **With the drive unplugged,** backups are refused and nothing lands on the system disk. Plug it back in, and it works with no restart. A failed timer run shows in `systemctl status this-is-you-backup`, and **nothing alerts you**, so check it.
- **Testing:** the app checks each backup as it writes it, using that file's own key. Do a full test with your passphrase now and then: **Test restore** on the Import screen, or `docker compose exec app python -m this_is_you verify /mnt/backups/backup-drive/NAME.tiyb`. The passphrase goes to the machine for that one test, used in memory and not stored. If you suspect the machine is compromised, do not type it there.
- **Clearing old ones:** `docker compose exec app python -m this_is_you prune --keep 14` lists what would go. Add `--yes` to remove it.
- **Plain backups** need `backup --plain`. Anyone who can read one can read every record, and it warns you. It needs a prepared destination, so it cannot end up somewhere by accident.
- **Keep one copy off-site.** A drive in the same room does not survive a fire or theft. Encrypted files are safe to copy anywhere, even somewhere you do not trust, but they then leave your control and depend entirely on the passphrase.

## 6. Updating

```sh
cd /opt/this-is-you
docker compose exec app python -m this_is_you backup        # 1. A backup first, every time.
git pull                                                    # 2. Read what changed.
docker compose build
docker compose up -d --wait                                 # 3. Rebuilds and restarts. Schema changes run on start.
docker compose exec app python -m this_is_you doctor        # 4. Check.
```

- A schema change first keeps a copy of the database as `archive.sqlite3.before-upgrade-*`. The newest 2 are kept. They are plain copies of your records, inside the private archive folder.
- **Going back:** after a schema change, an older version will not run on the newer database. Stop the stack, restore the `before-upgrade` copy over `archive.sqlite3` with its `-wal` and `-shm` files removed, and go back to the previous commit. Anything added since is lost from the database, so a backup is the safer route.
- **Base images** are pinned by digest in `Dockerfile` and `compose.yaml`, and Python packages by hash in `backend/requirements.prod.lock`, so nothing changes until you change those. **That also means security fixes do not arrive by themselves.** Update them on purpose, about monthly, and after any announced flaw in `pypdf`, Python or Tailscale.
- **Ubuntu:** turn on `unattended-upgrades`. After a kernel update and reboot, the stack returns by itself.

## 7. Disaster recovery

**What you need:** a `.tiyb` file, its backup passphrase, this repository, and a machine with Docker. Keep a note of them somewhere that does not depend on this machine.

**The machine or its disk died:**

1. Follow sections 2 to 4 on the new machine, up to `docker compose build`. Do not run `set-passphrase` yet.
2. Mount the backup drive, or copy the `.tiyb` onto a prepared one.
3. Restore. The app shares its network with `net`, so that has to be up:

```sh
docker compose up -d net
docker compose run --rm --no-deps app python -m this_is_you restore /mnt/backups/backup-drive/NAME.tiyb --to /data/restored
sudo sh -c 'cd /srv/this-is-you/data && mv restored/* restored/.[!.]* . ; rmdir restored'
docker compose up -d --wait
```

4. Sign-in details are never in a backup, so set them again:

```sh
docker compose exec app python -m this_is_you set-passphrase
docker compose exec app python -m this_is_you backup-key set
docker compose exec app python -m this_is_you doctor
```

5. Make a new backup, and test it.

**A corrupted archive, with the machine fine:** stop the stack with `docker compose down`, move `/srv/this-is-you/data` aside rather than deleting it, recreate it with `sudo deploy/setup-host.sh`, then follow step 3.

**You think the machine was compromised:**

1. Treat every record on it as read by someone else.
2. Take it off the tailnet in the admin console.
3. Do not type your backup passphrase on it.
4. Rebuild from a clean install, and restore a backup from before the compromise. Choose a new sign-in passphrase and a new backup passphrase.

Older backups stay private, because the machine never held what opens them.

**Lost a phone:** `docker compose exec app python -m this_is_you sign-out-everywhere`, and remove the device from your tailnet.

**Forgot the sign-in passphrase:** `set-passphrase` replaces it. Your records are not affected.

**A crash or power cut:** the stack returns by itself, and interrupted reads and imports continue. If something looks wrong, `docker compose ps` and `doctor`. If the `net` container itself dies, the others are left without a network while still looking healthy. Run `docker compose up -d --force-recreate`.

## 8. Keeping agents and other apps away

The boundary is **operating-system accounts and Tailscale ACLs**. Instructions and permission settings in a tool are useful, but they are not a boundary.

**Claude Code and other agents:**

1. Give them their own account. **Never** the admin account.
2. Never add that account to `docker`, `sudo`, `adm` or `lxd`. Membership of `docker` equals root.
3. Prove it, as that account: `sudo -u agent deploy/check-isolation.sh`. The check covers file access, Docker, sudo and admin groups.
4. Best of all, run agents on a different machine. If one must run on this one, it can still see how busy the machine is, and a kernel flaw is the same kernel.
5. Keep agents off your tailnet, or use an ACL that denies `tag:archive`. A tailnet device without your passphrase is refused anyway, but there is no reason to let it try.
6. Never paste records, screenshots, filenames or `.env` into an agent conversation, and never give one your backup passphrase or SSH access to the admin account.
7. Develop against fictional archives. `tools/` and `deploy/test/` only ever use fictional data. **`deploy/test/verify-vm.sh` wipes `/srv/this-is-you`, and must never run on the real machine.** It refuses to unless told the machine is disposable.

**Other hosted apps on this machine:**

- Give each its own Compose project. Do not share volumes, and do not attach anything to `this-is-you_default`.
- Do not mount `/srv/this-is-you` or the backup drive into anything else.
- Do not mount `/var/run/docker.sock` into any container: that hands it the whole machine. That rules out many management dashboards.
- `check-isolation.sh` and the `isolation` phase of the test cover another container on another network. Containers still share one kernel, so an app you would not trust with the machine should go on a different machine.

## 9. What must be tested on the real machine

Nothing below could be tested in the virtual machine. Use fictional records for all of it, **before importing anything real**.

| # | Check | How | Why it was not covered |
|---|---|---|---|
| 1 | CPU architecture | `uname -m`. If `x86_64`, the VM results were ARM64, so rerun everything | A mini PC is likely x86_64 |
| 2 | Real `tailscale serve` | Sign in from a phone. `doctor` passes, and imports work | Needs your tailnet. A stand-in proxy took its place |
| 3 | Host header | Sign-in failing with "Unrecognized host" means the proxy changed Host, or `TIY_PUBLIC_ORIGIN` does not match | Stand-in only. Tailscale's exact headers were not seen |
| 4 | Funnel stays off | `tailscale funnel status` in the proxy container, and try the address from a phone off the tailnet | Needs your tailnet |
| 5 | Nothing on the LAN | From another LAN device: `nmap <machine's IP>`. Only what you run for admin, like SSH, should show | The VM had no real LAN |
| 6 | ACLs | From a tailnet device outside the ACL, the address must not connect | Needs your tailnet |
| 7 | A real phone | Sign in, view a PDF, import. Session expiry. Whether PDFs stay in the browser cache | No phone |
| 8 | A real unplugged drive | Pull the USB drive during a backup and while idle. Plug it back in. Boot with it missing | Tested with a loop device, which is not a USB drive failing partway |
| 9 | Power loss | Pull the plug during an import and during a backup. Then `doctor`, and check records | Only process kills and a clean reboot were tested |
| 10 | Your actual disk encryption | Unlock at boot means typing a passphrase, or a TPM. Decide how this works after a power cut when away | No hardware |
| 11 | Full disk | Fill the system drive and the backup drive | Not tested for real |
| 12 | Long running | A week of uptime: memory, logs, timer runs | Hours, not days |
| 13 | The timer | `systemctl list-timers`, and a backup appears the next day | Run once by hand, not left to fire on schedule |
| 14 | Agent account | `sudo -u agent deploy/check-isolation.sh` with your real agent account | A test account was used |
| 15 | Real PDFs | A few first, then more. Keep them out of any AI conversation | Fictional files only |

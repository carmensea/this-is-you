# Linux verification, 3 November 2026

The production deployment on a real Linux machine, with fictional records only. Raw results: [2026-11-03-linux-verification-results.txt](2026-11-03-linux-verification-results.txt).

## The machine

| | |
|---|---|
| Operating system | Ubuntu 24.04.5 LTS, kernel 6.8.0-147, in a virtual machine (Apple Virtualization) |
| CPU architecture | **ARM64. A mini PC is likely x86_64, which this does not cover.** |
| Docker | 29.1.3 with Compose 2.40.3, Ubuntu's packages |
| AppArmor | On, with `kernel.apparmor_restrict_unprivileged_userns=1`, the Ubuntu 24.04 default |
| Shared with the host | Nothing mounted, no ports forwarded. Chrome reached the test proxy through one SSH tunnel made for the test |
| Proxy | **A stand-in (Caddy) in Tailscale's position, not Tailscale** |

The virtual machine used a temporary copy of Lima 2.2.1, checked before it ran against the GitHub API's digest, the release's `SHA256SUMS`, and GitHub's signed build provenance. PGP was not checked, as `gpg` was not installed. Lima and the machine were deleted afterwards.

## Bubblewrap does not work here

This is the finding that changed the design. On macOS, every sandbox test had passed.

| Where it ran | Result |
|---|---|
| Ubuntu 24.04 host, ordinary user | `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` |
| Docker, default security | `bwrap: No permissions to create a new namespace` |
| Docker, seccomp off | `bwrap: Failed to make / slave: Permission denied` |
| Docker, seccomp and AppArmor off | `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` |

So the reader moved to its own container with `network_mode: none`, no archive, another account and no added privileges. These are standard Docker settings. Nothing was weakened to make a test pass.

## Results

| Phase | Passed | What it covers |
|---|---|---|
| setup | 6 of 6 | A clean machine to a healthy stack. A closed archive with no passphrase |
| posture | 37 of 37 | Accounts, capabilities, read-only filesystems, mounts, ports, LAN address, Funnel off |
| attacks | 28 of 28 | Code run inside the reader, as if a PDF had subverted it. Worker limits. The handed file. Socket replaced |
| auth | 34 of 34 | Sessions, cookies, Host, Origin and CSRF through HTTPS, and directly |
| failsafe | 14 of 14 | Reader stopped, reader given a network, reader given the archive |
| backups | 32 of 32 | Encrypted to a second filesystem, wrong passphrase, a changed byte, drive unplugged, full disaster recovery |
| crashes | 21 of 21 | `kill -9` of each container's process, of the app during uploads, a stopped stack, a second service |
| update | 5 of 5 | New image, older schema, migration, pre-upgrade copy, going back |
| isolation | 6 of 6 | An agent's account, and another app's container |
| tailscale-image | 8 of 8 | The real image under this hardening, with a fake key. **Not Tailscale working** |
| timer | 6 of 6 | The daily backup, run by hand, with the drive there and unplugged |
| Chrome through the deployment | 26 of 26 | The large messy folder through the UI: 524 files, 440 documents, every category exact. Cookies, content policy, encrypted backup and test restore |
| after-reboot | 9 of 9 | A real reboot, confirmed by boot time. Everything returned by itself, and the session survived |

**232 checks, all passing on the final code.** Backend tests natively on this Linux machine, with Python 3.12: **510 passed, 6 skipped.** The skipped ones need a working OS sandbox outside containers, which this machine does not have. The suite creates hundreds of app instances, so it needs `ulimit -n 65536`. The running app held 26 open files after the whole import. That is one reading, not a long test.

## What real Linux caught that macOS could not

Each of these was wrong, and passed every test on macOS. Each now has a check above.

1. **Bubblewrap does not run on Ubuntu 24.04,** so production would have read PDFs with weak limits. It now uses a separate container, and stops rather than falls back.
2. **An unplugged drive stayed visible inside the container,** and backups appeared to succeed. Binding a drive directly keeps it mounted in the container after the host unmounts it. It now binds the parent folder, the empty mount point belongs to root, and a marker file has to be there.
3. **A proxy crash permanently cut the app off, while everything reported healthy.** The app was left in the old proxy's dead network. A separate small container now holds the network.
4. **`docker compose run` failed during recovery** when the proxy was down, because of that shared network. The steps were corrected, and tested.
5. **A subverted worker can replace the reader's socket,** as it shares the reader's account. It cannot survive its own reading, but it could have stopped all reading until a restart. The reader now rebuilds it within seconds.

One test result was also thrown out: **the first reboot test was invalid.** The stop command timed out, the machine never rebooted, and most checks passed anyway. The test was redone from inside the machine, with the boot time compared before and after.

## Not verified

Listed fully, with how to check each, in [docs/deployment.md](../deployment.md) section 9.

- **Real Tailscale:** `tailscale serve`, its real headers, its certificates, ACLs, Funnel staying off. Its image started and contacted Tailscale's control server with a fake key, which was refused. No records were involved.
- **x86_64.** All of this was ARM64.
- **Real hardware:** a USB drive failing partway, power loss, a full disk, disk encryption at boot, days of uptime.
- **A real phone.**
- **Real PDFs.**
- **Rootless Docker,** which might narrow what the `docker` group can do.
- **Reader isolation against a real exploit.** Attacks were simulated by running hostile code inside the container, and no real `pypdf` exploit was tried. Kernel or Docker flaws are outside what this tests.

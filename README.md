# C10 Control

[![CI](https://github.com/vampaz/c10-control/actions/workflows/ci.yml/badge.svg)](https://github.com/vampaz/c10-control/actions/workflows/ci.yml)

A self-hosted web remote for the **Audio Pro C10** (Linkplay A28) speaker. It runs on a machine on your local network and replaces the vendor app for everyday playback.

## What it does

- Browse and play internet radio
- Play files from folders on the machine running the app
- Build a queue and playlists
- Save six presets for one-tap playback
- Set a sleep timer that fades out and pauses
- Switch between Wi-Fi, Bluetooth, Aux and Optical inputs
- Show the real title, artist, album and cover art
- Control play, pause, next, previous, seek, volume and mute
- Recover automatically when the speaker drops off the network

## Requirements

- Node.js 24 or newer, or Docker
- The speaker and this machine on the same network
- Optional: one or more folders containing audio files
- Optional: outbound HTTPS for radio search

## Quick start

```sh
npm install
npm run dev
```

Open <http://localhost:5173>, press the gear, and enter the speaker address (for example `192.168.1.100`).

To add music folders, use **Speaker settings → Music folders**. The server must be able to read each folder.

### Production mode

```sh
npm run build
npm start          # http://localhost:8787
```

### Docker

For an always-on machine on your network:

```sh
cp .env.example .env      # set C10_HOST and C10_MUSIC_ROOT
docker compose up -d --build
```

Open `http://<server>:8787`. Saved settings live in the `c10-data` volume.

`C10_MUSIC_ROOT` is mounted read-only at `/host/music`. Set it to the parent folder that contains your music, for example `/Volumes` on macOS or `/media` on Linux. On Docker Desktop, add that parent folder to **Settings → Resources → File sharing** if it is not already shared. Then open **Speaker settings → Music folders**, press **Browse folders**, pick the folder, press **Use this folder**, and save. You can also set `C10_LIBRARY_DIR=/host/music/your-folder` in `.env` to preconfigure it.

The library setting is saved in the `c10-data` volume, so it survives restarts and container recreation. The folder contents are not stored by Docker: the parent folder must stay mounted. A path added inside the container without a mount is lost when the container is recreated, and the saved library will point at a missing folder.

If you use the default bridge network, the speaker cannot fetch local files from the container. Set `C10_MEDIA_URL=http://<host-lan-ip>:8787` in `.env`, or use host networking on Linux. See the [configuration](#configuration) and [troubleshooting](#troubleshooting) sections.

## Configuration

The settings dialog covers the speaker address, music folders and the media URL. Environment variables override the saved settings, which is useful for Docker.

| Variable | Default | Meaning |
| --- | --- | --- |
| `C10_HOST` | `192.168.1.100` | Speaker address |
| `C10_HTTP_PORT` | `80` | `httpapi.asp` port |
| `C10_UPNP_PORT` | `49152` | UPnP control port |
| `C10_LIBRARY_DIR` | empty | One folder scanned for local audio; unset means no library until you add one |
| `C10_LIBRARY_DIRS` | empty | Comma-separated folders, adds several libraries |
| `C10_BROWSE_ROOTS` | empty | Parent folders the settings folder browser may read |
| `C10_MEDIA_URL` | auto | Base URL the speaker uses to fetch local files |
| `PORT` | `5173` dev, `8787` start | Port this app listens on |
| `C10_DATA_DIR` | `.data` | Where saved settings live |

`C10_HOST` and `C10_MEDIA_URL` accept IP addresses or host names. The media URL must resolve on the speaker itself.

If `C10_LIBRARY_DIR` or `C10_LIBRARY_DIRS` is set, it replaces the libraries saved in the settings dialog. `C10_MEDIA_URL` is only needed when the app cannot detect an address the speaker can reach, such as Docker bridge networking.

## Using the app

### Radio

Open **Browse → Radio**, search for a station, and press it to play. The star saves it to favorites.

### Local libraries

Add one or more folders in **Speaker settings → Music folders**. In Docker, use **Browse folders** to pick a subfolder of the mounted parent. In **Browse → Library**, pick a folder or search across all of them. Press a track to play it: the rest of its folder queues behind it, so the transport's next and previous buttons move through that folder. Press **+** to add a single track to the queue.

The speaker fetches the file from this app, so the app needs a LAN address the speaker can reach. If local files do not start, set **Media URL** in settings.

### Queue and playlists

The **Queue** tab shows what plays next. Tracks advance automatically when they finish; live radio does not auto-advance.

The **Playlists** tab creates, renames and deletes lists. Press **Add the current track** to add what is playing, then **Play** to load the list into the queue.

### Presets, sleep and inputs

- **Presets**: press an empty slot to save the current track, a filled slot to play it, and the small × to clear it.
- **Sleep**: choose 15, 30, 45 or 60 minutes. The volume fades out over the last 20 seconds, then playback pauses.
- **Input**: switch between Wi-Fi, Bluetooth, Aux and Optical. Switching inputs stops the current stream.

### Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play or pause |
| `↑` / `↓` | Volume up or down |
| `←` / `→` | Seek back or forward |
| `M` | Mute |

## Troubleshooting

**The speaker is offline.** Check the address in settings, make sure the speaker is powered on, and confirm this machine can reach it on the network.

**No speakers are found.** SSDP discovery needs multicast. Enter the address by hand if your network blocks it. Discovery also does not work in Docker bridge networking; use host networking on Linux or enter the address.

**Local files do not play.** The speaker fetches the file itself, so `localhost` will not work. Set **Media URL** to the LAN address of this machine, for example `http://192.168.1.50:8787`. In Docker bridge networking, set `C10_MEDIA_URL` in `.env`. In Docker, also make sure the music folder is mounted and added in settings.

**New files do not appear.** The library is cached for five minutes. Wait for the cache to expire, or restart the app.

**A Docker library disappears after recreation.** The path is saved in `c10-data`, but the folder contents are not. Mount the host folder as a volume and add that container path; a folder created inside the container without a volume is lost when the container is recreated.

**Radio search fails.** The server needs outbound HTTPS to `de1.api.radio-browser.info`.

**Docker cannot discover the speaker.** Bridge networking does not carry multicast. On a Linux host, use `network_mode: host` and remove the `ports` block. On Docker Desktop, enter the address or set `C10_HOST`.

**Plex does not appear.** Plex is not implemented yet. Its media API requires an `X-Plex-Token` even on the LAN.

## Security

This app has no authentication, and the speaker API it controls is also unauthenticated on the LAN. Do not expose either to the internet. For remote access, use a VPN. See [SECURITY.md](SECURITY.md).

## Documentation

Architecture, protocol details, the HTTP API, data files and the source layout are in [docs/TECHNICAL.md](docs/TECHNICAL.md).

## License

MIT. See [LICENSE](LICENSE).

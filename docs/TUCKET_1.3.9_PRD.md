# PRD — Tucket 1.3.9: Tucket Grab bridge

**Owner:** Tucket (macOS app, repo `~/Desktop/Projects/Repaste`)
**Partner:** Tucket Grab (Chromium extension, repo `~/Desktop/Projects/tucket-grab`)
**Release:** Tucket 1.3.9, shipping alongside Tucket Grab 1.2

## 1. Why

Tucket Grab is the free Chrome, Brave, Edge, Arc and Vivaldi extension that captures screenshots, colours, fonts and SVGs. Today it reaches Tucket only through the clipboard: the user has to click, their clipboard gets overwritten, and Tucket files every clip under "Brave" with no page link.

1.3.9 adds a direct, local, private bridge so that:
- **every screenshot lands in Tucket automatically**, with its page title and URL
- colours, SVGs and font lines go straight to Tucket without touching the clipboard
- Grab's Tucket-only tools unlock: **Copy text** (OCR) and **Remove background**, powered by Tucket's on-device Vision
- Grab knows Tucket is installed, and replaces its "Get Tucket" line with "Connected to Tucket"

This is also the funnel: free Grab users see Tucket-powered features, and Tucket users get a better Grab.

## 2. Goals and non-goals

**Goals**
- Grab sends to Tucket with no clipboard involvement when Tucket is installed.
- Screenshots appear in the Library within 1 second of capture, tagged with the source site.
- OCR and background removal run in Tucket and return their results to Grab.
- Nothing goes over the network. Nothing is reachable except from the one extension ID.
- Graceful fallback: if Tucket is missing, quit or switched off, Grab falls back to the clipboard.

**Non-goals (1.3.9)**
- Share links (CloudKit), planned for a later release. The protocol reserves a `share` op.
- Safari support, and Windows or Linux.
- Syncing Grab settings with Tucket.

## 3. User stories

1. As a designer with Tucket, I press ⌥⇧F on a long page, and the full-page screenshot is in Tucket's Library a second later, titled with the page name and showing the site.
2. I click a brand colour in Grab. It's saved in Tucket as a named Colour clip, and my clipboard still holds what I copied before.
3. On a screenshot in Grab, I click **Copy text**. The text appears in Grab, ready to copy, and the image with its OCR is in Tucket.
4. I click **Remove background**. The cut-out appears in Grab and is saved to Tucket.
5. Grab's footer says "Connected to Tucket 1.3.9". Without Tucket, it says "Get Tucket for Mac", and those two tools show a gentle "happens in Tucket" note.
6. In Tucket Settings, I can see whether the browser extension is connected, and turn it off.

## 4. How it works

```
Grab (service worker)
   └─ chrome.runtime.connectNative("com.arpitchandak.tucket")
        └─ Browser launches  Tucket.app/Contents/MacOS/tucket-bridge   (stdin/stdout)
             └─ Unix socket  ~/Library/Application Support/Tucket/bridge.sock  (0600)
                  └─ Tucket.app  BridgeServer → ClipboardStore / TextRecognizer / BackgroundRemover
```

### 4.1 Bridge helper (new executable target `TucketBridge`)
- A Foundation-only command-line tool, built into `Tucket.app/Contents/MacOS/tucket-bridge`.
- Speaks Chrome native messaging on stdin and stdout: a 4-byte little-endian length, then UTF-8 JSON.
- Relays each message to the app over the Unix socket and writes replies back.
- If the socket is missing, launches Tucket (`open -b com.arpitchandak.tucket`) and retries for up to 5 s. If it still can't connect, it replies `{ "error": "app-not-running" }`.
- Exits when stdin closes, since the browser starts one helper per connection.

### 4.2 Host registration (`NativeHostInstaller.swift`)
- On launch, and whenever the setting is turned on, Tucket writes `com.arpitchandak.tucket.json` into each installed browser's `NativeMessagingHosts` folder, but only where that browser's support folder exists:

| Browser | Folder under `~/Library/Application Support/` |
|---|---|
| Chrome | `Google/Chrome/NativeMessagingHosts` |
| Chrome Beta / Canary | `Google/Chrome Beta/…`, `Google/Chrome Canary/…` |
| Chromium | `Chromium/NativeMessagingHosts` |
| Brave | `BraveSoftware/Brave-Browser/NativeMessagingHosts` |
| Edge | `Microsoft Edge/NativeMessagingHosts` |
| Arc | `Arc/User Data/NativeMessagingHosts` |
| Vivaldi | `Vivaldi/NativeMessagingHosts` |

- File contents:
```json
{
  "name": "com.arpitchandak.tucket",
  "description": "Tucket bridge for Tucket Grab",
  "path": "/Applications/Tucket.app/Contents/MacOS/tucket-bridge",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://<WEB_STORE_ID>/",
    "chrome-extension://ccjmgiaekhnnalcjcoilllnamfpenhlc/"
  ]
}
```
- `path` is the helper inside the running bundle, and is rewritten if the app moves.
- Turning the setting off deletes these files.
- `<WEB_STORE_ID>` comes from uploading Grab to the Web Store as a draft **before** 1.3.9 ships.

### 4.3 App-side server (`BridgeServer.swift`)
- Listens on `~/Library/Application Support/Tucket/bridge.sock`, file mode 0600. It rejects peers from another uid (checked with `getpeereid`).
- Starts at launch when the setting is on; stops and removes the socket when it's off.
- Handles one JSON request per message and replies with the same `id`.
- Limits: a 25 MB decoded payload, 30 s per request, and one OCR or background-removal job at a time (others queue).

## 5. Protocol (contract with Grab — `docs/BRIDGE.md` in the Grab repo)

Every request is `{ "id": string, "op": string, ...fields }`. Every reply is `{ "id", ...result }` or `{ "id", "error": code }`.

| op | Request fields | Reply | What Tucket does |
|---|---|---|---|
| `hello` | — | `{ app: "Tucket", version: "1.3.9", features: ["ingest","ocr","removeBackground"] }` | Nothing else. Used for detection. |
| `ingest` | `kind: "text" \| "svg" \| "image"`, `data` (string, or base64 PNG for images), `pageUrl`, `pageTitle`, `browser` | `{ ok: true, clipId }` | `ClipboardStore.add(text:)`, `add(svg:)` or `add(imageData:)` with `sourceApp` set to the browser name, then `applySourceSite(id:url:siteName:)` using `BrowserSiteNamer.friendlyName`. Sensitive-text detection runs as for any copy. Images are titled with `pageTitle`. |
| `ocr` | `image` (base64 PNG or JPEG), `pageUrl`, `pageTitle` | `{ text }` | `TextRecognizer.recognize`. The image is also saved as an Image clip (dedupe if the same image was just ingested). |
| `removeBackground` | `image`, `pageUrl`, `pageTitle` | `{ image }` (base64 PNG) | `BackgroundRemover.removeBackground`. The cut-out is saved as an Image clip. |
| `share` | *reserved* | `{ error: "unsupported" }` | Not in 1.3.9. |

- **Error codes:** `app-not-running`, `disabled`, `too-large`, `bad-request`, `failed`, `unsupported`.
- **Chunking:** the browser caps host→extension messages at 1 MB. Larger replies (cut-outs) are sent as `{ id, chunk, index, total }`, with the joined chunks being the JSON of the full reply. Grab already reassembles these (`src/lib/tucket.js`).
- **Version rule:** new ops are added only; existing fields are never removed. Grab checks `features` before offering a tool.

## 6. Tucket UI changes

- **Settings → General (or Integrations): "Browser extension".**
  - Status: **Connected** (green, with the last-seen browser and time), **Not connected**, or **Off**.
  - A toggle, on by default. Off removes the host files and closes the socket.
  - A "Get Tucket Grab" link when never connected: `https://trytucket.com/grab`.
- **Library:** clips from Grab show the site favicon and name, like other browser clips. Screenshots are titled with the page title.
- **Onboarding:** one optional line on the features step: "Using Chrome or Brave? Tucket Grab sends screenshots, colours and SVGs straight here."

## 7. Grab changes in the same release (Grab 1.2, for reference)

- **Auto-save screenshots:** when connected, every capture is ingested automatically, with its markup, while the result tab still opens. A panel switch, "Save every screenshot to Tucket", is on by default when connected.
- Colour, font and SVG sends use `ingest`, not the clipboard.
- The result page's **Copy text** and **Remove background** call `ocr` and `removeBackground` and show the results in place.
- The footer shows "Connected to Tucket 1.3.9".
- Status is checked with `hello` when the panel opens (cached for 30 s).

## 8. Security and privacy

- Local only. No port, no network, a 0600 socket, and a same-uid peer check.
- Only the listed extension IDs can launch the helper (enforced by the browser through `allowed_origins`).
- Payloads are validated: known op, size limits, base64 decodes, image decodes.
- Sensitive-text detection applies to ingested text exactly as it does to copies.
- The off switch fully removes the integration.
- The privacy policy gains one line: "Tucket accepts captures from the Tucket Grab extension on this Mac. Nothing leaves your computer."

## 9. Build and release

- `Package.swift`: a new `executableTarget` `TucketBridge` and a pure `TucketCore/BridgeProtocol.swift` (framing, chunking, validation) with unit tests.
- The `Makefile` and `scripts/release.sh` copy `tucket-bridge` into `Contents/MacOS` and sign it (hardened runtime, same Developer ID) **before** signing the app. Notarisation covers the helper.
- `VERSION` → 1.3.9, and the appcast notes follow the grade-3 style, e.g. **"Works with Tucket Grab."** Screenshots from Chrome and Brave land in Tucket by themselves.
- Keep the git-sync rule: pull before starting, and push after each verified step.

## 10. Acceptance criteria

1. With Tucket 1.3.9 running, Grab's footer shows "Connected to Tucket 1.3.9" in Chrome **and** Brave.
2. A full-page capture appears in the Library within 1 s, as an Image clip with the page title, site name and URL, and with OCR text searchable.
3. Clicking a swatch in Grab creates a named Colour clip, and the system clipboard is unchanged (`pbpaste` before equals after).
4. An inline SVG grabbed in Grab lands as an Icon or SVG clip by the 1.3.6 rule.
5. Copy text returns the text to Grab within 3 s for a 2560×1600 capture.
6. Remove background returns a transparent PNG to Grab (chunked over 1 MB) and saves it to the Library.
7. With Tucket quit, the first request relaunches it and succeeds. With the toggle off, Grab falls back to the clipboard and shows the "happens in Tucket" note for the tools.
8. The host files exist only for installed browsers, point at the current app path, and are removed when switched off.
9. A request from any other extension ID is refused by the browser. A 30 MB payload gets `too-large`.
10. `swift test` covers the protocol: framing, chunk split and join, and oversize rejection.

## 11. Test plan

- **Unit:** `BridgeProtocol` framing, chunking and validation.
- **Grab side before Tucket is ready:** Grab's fake host (`tools/fake-host.mjs`) implements this protocol so both halves are built against the same contract.
- **By hand:** Chrome and Brave; Tucket running, quit and switched off; an app moved from `/Applications` to `~/Applications`; a 13,000px full-page capture; a large cut-out.

## 12. Open items

- Grab's permanent Web Store ID. Upload a draft first.
- Where the Settings row lives (General or a new Integrations section).
- Whether auto-save covers every screenshot or only full page. Proposed: every one, with the switch.

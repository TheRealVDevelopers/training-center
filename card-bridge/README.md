# Card bridge (USB NFC reader → web app)

Your USB reader only talks through its **32-bit vendor driver**, which a browser
can't read directly. This tiny bridge reads a card through that driver and
**types the card's ID like a keyboard** into whatever window is focused — and
your web app's built-in card-tap support catches it. No app changes; works with
the live site.

> This is the **Windows-only** helper for the reader you bought. (An Android
> phone with NFC needs none of this — it works through the app directly.)

## One-time setup

1. **Install 32-bit Python** — go to python.org → Downloads → look for
   **"Windows installer (32-bit)"** (not the normal 64-bit one). The driver is
   32-bit, so 64-bit Python can't load it. During install, tick **"Add Python
   to PATH."**

2. **Copy two DLLs into this `card-bridge` folder:**
   - `function.dll`
   - `usb.dll`
   
   Both are in the seller's SDK at:
   `ISO 14443A+15693 SDK+Demo (USB-Reader & Write)/Document Kit/Windows/`

3. Plug in the reader.

## Run it

Open a terminal in this folder and run:

```
python card_bridge.py
```

(If `python` opens the 64-bit one, use the full path to the 32-bit one, e.g.
`C:\Users\<you>\AppData\Local\Programs\Python\Python3x-32\python.exe card_bridge.py`.)

You'll see `Ready. Tap a card...`. **Tap a card** — it prints what the reader
returned, and if the ID looks right it types it.

## First run: send me the output

The first run is a **diagnostic** — it prints a line for each read attempt, like:

```
  UL_Request mode=0x26 ret=0 bytes=F7DB2C9792BB0000...
>>> CARD F7DB2C9792BB — typing it now
```

**Tap 2–3 different cards, copy everything the console printed, and send it back.**
That tells me the exact format your reader returns, and I lock the bridge in so
it's rock-solid.

## Using it at the door (once it's working)

1. Run `python card_bridge.py` and leave it running.
2. Open your app's `/scan` page and **click on it once** so it's the focused
   window.
3. Tap cards — each tap types the ID into the scan page → member checks in.

For issuing cards: open **Admin → Credits**, pick a member, click
**"Assign card (USB reader)"**, then tap the blank card — the bridge types its
ID and it gets linked to that member.

## Troubleshooting
- **"64-bit Python" warning** → install and use 32-bit Python.
- **"function.dll not found"** → copy `function.dll` + `usb.dll` into this folder.
- **Loads but no card reads** → send me the console output; I'll adjust the
  read call for your reader.
- **Types into the wrong place** → click the scan page first so it's focused.

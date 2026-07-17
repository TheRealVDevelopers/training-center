# Evolis Asmi — Station PC Setup (Card Printing)

Everything needed to print member cards from the Card Studio. No NFC readers
required — printing works standalone, and the QR on each printed card already
works with the QR gun / camera scanner.

## 1. Physical setup
1. Place the printer on the desk near the PC (flat, ventilated, away from dust).
2. Open the lid → insert the **YMCKO ribbon cassette** (it clicks in one way only).
3. Fan the blank PVC cards (hold the stack, flex once) and load them in the
   **feeder** — print side up, all facing the same way. Set the feeder's card
   thickness lever to **0.76 mm** if present.
4. Connect **USB to the PC** and power on. Wait for the LED to go steady.

## 2. Driver (one-time)
1. On the PC, go to **evolis.com → Support → Asmi → Drivers & Manuals**
   (or the driver CD/USB that came in the box).
2. Install the **Evolis printer driver / Print Center** for Windows.
3. When Windows shows the printer, do a **driver test print** from
   Print Center (uses one card) to confirm ribbon + cards feed correctly.

## 3. Windows settings (one-time)
1. **Settings → Printers → Evolis Asmi → Set as default printer.**
2. In the printer's *Printing Preferences*: card size **CR80 (85.6 × 54 mm)**,
   orientation **Landscape**, ribbon **YMCKO** (usually auto-detected).

## 4. One-click printing from the app (one-time)
1. Right-click the Chrome shortcut on the desktop → **Properties**.
2. In *Target*, add a space then:  `--kiosk-printing`
   e.g.  `"C:\...\chrome.exe" --kiosk-printing`
3. Use THIS shortcut for the station. Now the Card Studio's
   **Print FRONT / Print BACK** buttons print instantly — no dialog.
   (Because the Evolis is the default printer.)

## 5. First calibration print
1. Open **/admin/print** (Card Studio) → pick any member → **Print FRONT**.
2. Inspect the card:
   - Perfectly centered → done.
   - Shifted / edge cut / white border on one side → note WHICH edge and
     roughly how many mm → tell Claude, the page geometry gets adjusted once,
     then every future card is perfect.
3. Print the BACK on the same card (re-insert it in the feeder, blank side up).

## 6. Daily printing workflow
1. Reception (**/admin/credits**) → select member → **🖨 Print card (Card Studio)**.
2. Check the level dropdown is right (auto-detected; correcting it saves).
3. **Print FRONT** → flip card in feeder → **Print BACK**.
4. When NFC readers arrive: **Assign card** → tap on desk reader → hand over.
   Until then: the card's **QR already works** at the scanner/QR-gun.

## 7. Care rules (keeps prints perfect)
- Hold blank cards by the **edges** — fingerprints ruin prints.
- Keep the card stack in its wrapper until loading; dust = white specks.
- Run the **cleaning kit card** at every ribbon change (~each 100 cards).
- Ribbons: ~100 color cards each. Reorder when the counter warns.
- If a print comes out pale/streaky: clean first, then straight to reprint.

## Consumables shopping reference
- Ribbon: **Evolis Asmi YMCKO** (from the same vendor)
- Cards: **NTAG215 PVC, white, printable, CR80, 0.76 mm**
- Cleaning kit: Evolis-compatible

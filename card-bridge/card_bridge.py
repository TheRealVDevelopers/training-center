#!/usr/bin/env python3
"""
Card bridge for the 32-bit USB NFC reader (function.dll / usb.dll).

What it does:
  Reads a card's UID through the reader's vendor driver, then "types" that UID
  (like a keyboard) + Enter into whatever window is focused. Your web app's
  built-in card-tap support catches it -> member checks in. No app changes, and
  it works with your live HTTPS site because typing isn't a network request.

REQUIREMENTS (read carefully):
  1. **32-bit Python** — the driver is 32-bit, so 64-bit Python CANNOT load it.
     Get it from python.org -> "Windows installer (32-bit)". The script checks
     this and warns you.
  2. Put **function.dll** AND **usb.dll** in THIS folder. Copy them from the
     seller's SDK: "ISO 14443A+15693 SDK+Demo/Document Kit/Windows/".
  3. Run:  python card_bridge.py
  4. Keep the /scan page (or the Assign-card box) as the FOCUSED window while
     tapping — the UID types into whatever window is in front.

FIRST RUN = DIAGNOSTIC:
  It prints exactly what the reader returns for each tap. If the UID looks right
  it also types it. Tap a couple of cards, copy the console output, and send it
  back so the read format can be locked in perfectly.
"""

import ctypes
import ctypes.wintypes as wt
import os
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if hasattr(os, "add_dll_directory"):
    try:
        os.add_dll_directory(HERE)
    except OSError:
        pass


def check_bitness():
    if struct.calcsize("P") * 8 != 32:
        print("=" * 64)
        print(" You are running 64-bit Python. This driver is 32-BIT and will")
        print(" NOT load here. Install 32-bit Python (python.org ->")
        print(" 'Windows installer (32-bit)') and run this with THAT python.")
        print("=" * 64)
        sys.exit(1)


def load_dll():
    path = os.path.join(HERE, "function.dll")
    if not os.path.exists(path):
        print("ERROR: function.dll not found next to this script.")
        print("Copy function.dll AND usb.dll here from the SDK's")
        print("'Document Kit/Windows/' folder, then run again.")
        sys.exit(1)
    if not os.path.exists(os.path.join(HERE, "usb.dll")):
        print("WARNING: usb.dll not found next to this script — function.dll")
        print("usually needs it. Copy usb.dll here too if loading fails.")
    try:
        dll = ctypes.WinDLL(path)  # stdcall (matches the C# demo)
        print("Loaded function.dll (stdcall)")
        return dll
    except OSError as e:
        print("Could not load function.dll:", e)
        print("Most common cause: 64-bit Python, or usb.dll missing.")
        sys.exit(1)


# ---- keyboard typing via Win32 SendInput (Unicode) ------------------------
INPUT_KEYBOARD = 1
KEYEVENTF_UNICODE = 0x0004
KEYEVENTF_KEYUP = 0x0002
VK_RETURN = 0x0D


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wt.WORD), ("wScan", wt.WORD), ("dwFlags", wt.DWORD),
                ("time", wt.DWORD), ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong))]


class _INPUTunion(ctypes.Union):
    _fields_ = [("ki", KEYBDINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wt.DWORD), ("u", _INPUTunion)]


def _send(inp):
    ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))


def _key_unicode(ch):
    for flags in (KEYEVENTF_UNICODE, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP):
        ki = KEYBDINPUT(0, ord(ch), flags, 0, None)
        _send(INPUT(INPUT_KEYBOARD, _INPUTunion(ki)))


def _key_vk(vk):
    for flags in (0, KEYEVENTF_KEYUP):
        ki = KEYBDINPUT(vk, 0, flags, 0, None)
        _send(INPUT(INPUT_KEYBOARD, _INPUTunion(ki)))


def type_string(s):
    for ch in s:
        _key_unicode(ch)
    _key_vk(VK_RETURN)


# ---- card reading ---------------------------------------------------------
def to_hex(buf, n):
    return "".join("%02X" % buf[i] for i in range(n))


def read_uid(dll, verbose=False):
    """Try the reader's UID functions. Returns a hex UID string, or None."""
    UL = getattr(dll, "UL_Request", None)
    GS = getattr(dll, "GET_SNR", None)
    snr = (ctypes.c_ubyte * 64)()
    val = (ctypes.c_ubyte * 64)()

    attempts = []
    if UL is not None:
        UL.restype = ctypes.c_int
        UL.argtypes = [ctypes.c_ubyte, ctypes.POINTER(ctypes.c_ubyte)]
        for mode in (0x26, 0x52):
            attempts.append(("UL_Request", mode, lambda m=mode: UL(m, snr)))
    if GS is not None:
        GS.restype = ctypes.c_int
        GS.argtypes = [ctypes.c_ubyte, ctypes.c_ubyte,
                       ctypes.POINTER(ctypes.c_ubyte), ctypes.POINTER(ctypes.c_ubyte)]
        for mode in (0x26, 0x52):
            attempts.append(("GET_SNR", mode, lambda m=mode: GS(m, 1, snr, val)))

    for name, mode, call in attempts:
        for i in range(64):
            snr[i] = 0
        ret = call()
        nonzero = any(snr[i] for i in range(10))
        if verbose:
            print("  %-10s mode=0x%02X ret=%s bytes=%s"
                  % (name, mode, ret, to_hex(snr, 10)))
        # ret == 0 means a card was found (ret == 1 = no card in field).
        if ret == 0 and nonzero:
            raw = bytes(snr[:10]).rstrip(b"\x00") or bytes(snr[:4])
            return raw.hex().upper()
    return None


def main():
    check_bitness()
    dll = load_dll()
    if not hasattr(dll, "UL_Request") and not hasattr(dll, "GET_SNR"):
        print("Neither UL_Request nor GET_SNR is exported by function.dll —")
        print("send me the console output and I'll adjust the function names.")
        sys.exit(1)

    debug = "--debug" in sys.argv
    print("\n" + "=" * 52)
    print(" Card bridge running.  Tap a card to check someone in.")
    print(" >> Click your /scan page first so it's the FOCUSED window,")
    print("    otherwise the card ID types into this terminal instead.")
    print(" (Ctrl+C to quit.  Run with --debug to see every read.)")
    print("=" * 52 + "\n")

    last, last_t = None, 0.0
    while True:
        uid = read_uid(dll, verbose=debug)
        if uid:
            now = time.time()
            if uid != last or now - last_t > 2.0:
                print("  card %s  ->  sent" % uid)
                type_string(uid)
                last, last_t = uid, now
            time.sleep(0.4)
        time.sleep(0.15)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nbye")

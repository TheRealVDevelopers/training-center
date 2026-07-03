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


def minimize_console():
    """Get this terminal out of the way so it stops stealing keyboard focus."""
    try:
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 6)  # SW_MINIMIZE
    except Exception:
        pass


def find_browser_hwnd():
    """Find the browser window showing the app (prefer the app's tab title)."""
    user32 = ctypes.windll.user32
    result = {"app": None, "browser": None}

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        n = user32.GetWindowTextLengthW(hwnd)
        if n <= 0:
            return True
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        t = buf.value
        if "Saturday Training" in t or "training-center" in t:
            result["app"] = hwnd
        elif "Google Chrome" in t or " Chrome" in t or "Microsoft​ Edge" in t or "Edge" in t or "Brave" in t:
            if result["browser"] is None:
                result["browser"] = hwnd
        return True

    user32.EnumWindows(cb, 0)
    return result["app"] or result["browser"]


def focus_browser(hwnd):
    """Bring the browser to the front AND click into the page area, so the
    typed card id reaches the web page (not the address bar / devtools)."""
    if not hwnd:
        return
    user32 = ctypes.windll.user32
    try:
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        # Alt tap bypasses Windows' foreground-lock so SetForegroundWindow works.
        user32.keybd_event(0x12, 0, 0, 0)
        user32.keybd_event(0x12, 0, 2, 0)
        user32.SetForegroundWindow(hwnd)
        # Click into the left-centre of the window — that's blank page area on
        # the /card screen, so it just gives the web content keyboard focus.
        rect = wt.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        x = int(rect.left + (rect.right - rect.left) * 0.22)
        y = int((rect.top + rect.bottom) / 2)
        user32.SetCursorPos(x, y)
        user32.mouse_event(0x0002, 0, 0, 0, 0)  # left down
        user32.mouse_event(0x0004, 0, 0, 0, 0)  # left up
    except Exception:
        pass


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
    print(" Card bridge running.")
    print(" Just leave the /card page open in your browser — the bridge")
    print(" brings it to the front automatically on each tap, so you")
    print(" don't have to click anything. This window will minimize.")
    print(" (Ctrl+C to quit.  Run with --debug to keep this visible.)")
    print("=" * 52 + "\n")
    if not debug:
        time.sleep(1.5)
        minimize_console()

    last, misses = None, 0
    while True:
        uid = read_uid(dll, verbose=debug)
        if uid:
            misses = 0
            if uid != last:  # only fire once per physical tap
                hwnd = find_browser_hwnd()
                focus_browser(hwnd)
                time.sleep(0.12)
                print("  card %s  ->  %s" % (uid, "sent to browser" if hwnd else "typed (no browser found!)"))
                type_string(uid)
                last = uid
            time.sleep(0.2)
        else:
            misses += 1
            if misses >= 4:
                last = None  # card lifted off the reader; a re-tap counts again
            time.sleep(0.12)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nbye")

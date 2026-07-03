#!/usr/bin/env python3
"""
Card bridge (local-server version) for the 32-bit USB NFC reader.

Reads a card's UID through the reader's vendor driver (function.dll) and
publishes it on a tiny local web server. Your web app's /card and /scan pages
fetch it directly from http://127.0.0.1:47113 — so the tap reaches the page no
matter which window is focused. No typing, no clicking, no focus games.

REQUIREMENTS:
  1. **32-bit Python** (python.org -> "Windows installer (32-bit)").
  2. **function.dll** + **usb.dll** in this folder (already copied for you).
  3. Run:  py card_bridge.py   (or double-click start.bat)
  Then just open the /card page in a browser — it connects on its own.
"""

import ctypes
import json
import os
import struct
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 47113
HERE = os.path.dirname(os.path.abspath(__file__))
if hasattr(os, "add_dll_directory"):
    try:
        os.add_dll_directory(HERE)
    except OSError:
        pass

STATE = {"uid": "", "seq": 0}  # latest card + a counter the page watches


def check_bitness():
    if struct.calcsize("P") * 8 != 32:
        print("=" * 60)
        print(" You are running 64-bit Python. This driver is 32-BIT and will")
        print(" NOT load. Install 32-bit Python (python.org -> 32-bit) and use it.")
        print("=" * 60)
        sys.exit(1)


def load_dll():
    path = os.path.join(HERE, "function.dll")
    if not os.path.exists(path):
        print("ERROR: function.dll not found next to this script (copy it +")
        print("usb.dll from the SDK's 'Document Kit/Windows/' folder).")
        sys.exit(1)
    try:
        dll = ctypes.WinDLL(path)
        print("Loaded function.dll (stdcall)")
        return dll
    except OSError as e:
        print("Could not load function.dll:", e, "\n(64-bit Python or missing usb.dll?)")
        sys.exit(1)


def to_hex(buf, n):
    return "".join("%02X" % buf[i] for i in range(n))


def read_uid(dll, verbose=False):
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
            print("  %-10s mode=0x%02X ret=%s bytes=%s" % (name, mode, ret, to_hex(snr, 10)))
        if ret == 0 and nonzero:
            raw = bytes(snr[:10]).rstrip(b"\x00") or bytes(snr[:4])
            return raw.hex().upper()
    return None


class Handler(BaseHTTPRequestHandler):
    def _headers(self, code=200, body=b""):
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        if body:
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()

    def do_OPTIONS(self):
        self._headers(204)

    def do_GET(self):
        body = json.dumps(STATE).encode()
        self._headers(200, body)
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def log_message(self, *a):
        pass  # keep the console quiet


def serve():
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


def main():
    check_bitness()
    dll = load_dll()
    if not hasattr(dll, "UL_Request") and not hasattr(dll, "GET_SNR"):
        print("Neither UL_Request nor GET_SNR exported — send me the output.")
        sys.exit(1)

    threading.Thread(target=serve, daemon=True).start()
    debug = "--debug" in sys.argv
    print("\n" + "=" * 60)
    print(" Card bridge running on  http://127.0.0.1:%d" % PORT)
    print(" Just open the /card page in your browser — it connects by")
    print(" itself. No clicking, no focus needed. Tap a card.")
    print(" (Ctrl+C to quit.  --debug shows every read.)")
    print("=" * 60 + "\n")

    last, misses = None, 0
    while True:
        uid = read_uid(dll, verbose=debug)
        if uid:
            misses = 0
            if uid != last:
                STATE["uid"] = uid
                STATE["seq"] += 1
                print("  card %s   (published #%d)" % (uid, STATE["seq"]))
                last = uid
            time.sleep(0.2)
        else:
            misses += 1
            if misses >= 4:
                last = None  # card lifted; a re-tap counts again
            time.sleep(0.12)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nbye")

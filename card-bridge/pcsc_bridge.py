"""
Card-reader bridge for ACS ACR122U (and any PC/SC reader) — ZERO dependencies.

Talks to the reader through Windows' built-in winscard.dll via ctypes, so it
needs NOTHING installed except Python itself (no pyscard, no C++ compiler).

Reads up to three readers on one PC and tags every tap with its role:
    desk   - registration table (assign cards / recharge / board check-in)
    gate1  - door 1
    gate2  - door 2

Serves the local HTTP API the web app polls:
    GET  /tap       -> {"seq": N, "uid": "04A1B2...", "reader": "desk"}
    GET  /readers   -> detected readers and their role mapping
    POST /feedback  -> {"reader": "gate1", "ok": true}   flashes LED / beeps

Role = readers sorted by name: 1st=desk, 2nd=gate1, 3rd=gate2. Override with
readers.json next to this file, e.g. {"desk":2,"gate1":0,"gate2":1}
(values index into the sorted reader list from GET /readers).
"""

import ctypes
import json
import os
import threading
import time
from ctypes import wintypes, byref, POINTER, c_void_p, c_char_p, c_ubyte, c_long
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 47113
ROLES = ["desk", "gate1", "gate2"]

# ---- winscard.dll bindings --------------------------------------------------
SCARD_SCOPE_USER = 0
SCARD_SHARE_SHARED = 2
SCARD_PROTOCOL_T0 = 1
SCARD_PROTOCOL_T1 = 2
SCARD_LEAVE_CARD = 0
SCARD_S_SUCCESS = 0

winscard = ctypes.WinDLL("winscard.dll")


class SCARD_IO_REQUEST(ctypes.Structure):
    _fields_ = [("dwProtocol", ctypes.c_ulong), ("cbPciLength", ctypes.c_ulong)]


winscard.SCardEstablishContext.argtypes = [wintypes.DWORD, c_void_p, c_void_p, POINTER(c_void_p)]
winscard.SCardEstablishContext.restype = c_long
winscard.SCardListReadersA.argtypes = [c_void_p, c_char_p, c_char_p, POINTER(wintypes.DWORD)]
winscard.SCardListReadersA.restype = c_long
winscard.SCardConnectA.argtypes = [c_void_p, c_char_p, wintypes.DWORD, wintypes.DWORD, POINTER(c_void_p), POINTER(wintypes.DWORD)]
winscard.SCardConnectA.restype = c_long
winscard.SCardTransmit.argtypes = [c_void_p, POINTER(SCARD_IO_REQUEST), POINTER(c_ubyte), wintypes.DWORD, c_void_p, POINTER(c_ubyte), POINTER(wintypes.DWORD)]
winscard.SCardTransmit.restype = c_long
winscard.SCardDisconnect.argtypes = [c_void_p, wintypes.DWORD]
winscard.SCardDisconnect.restype = c_long


def establish():
    ctx = c_void_p()
    if winscard.SCardEstablishContext(SCARD_SCOPE_USER, None, None, byref(ctx)) != SCARD_S_SUCCESS:
        return None
    return ctx


def list_readers(ctx):
    pcch = wintypes.DWORD(0)
    winscard.SCardListReadersA(ctx, None, None, byref(pcch))
    if pcch.value == 0:
        return []
    buf = ctypes.create_string_buffer(pcch.value)
    if winscard.SCardListReadersA(ctx, None, buf, byref(pcch)) != SCARD_S_SUCCESS:
        return []
    return [s.decode("ascii", "ignore") for s in buf.raw[: pcch.value].split(b"\x00") if s]


def connect(ctx, reader):
    hcard = c_void_p()
    proto = wintypes.DWORD(0)
    rv = winscard.SCardConnectA(
        ctx, reader.encode("ascii"), SCARD_SHARE_SHARED,
        SCARD_PROTOCOL_T0 | SCARD_PROTOCOL_T1, byref(hcard), byref(proto),
    )
    if rv != SCARD_S_SUCCESS:
        return None, 0
    return hcard, proto.value


def transmit(hcard, proto, apdu):
    send = (c_ubyte * len(apdu))(*apdu)
    recv = (c_ubyte * 258)()
    rlen = wintypes.DWORD(258)
    pci = SCARD_IO_REQUEST(proto if proto in (1, 2) else 1, 8)
    if winscard.SCardTransmit(hcard, byref(pci), send, len(apdu), None, recv, byref(rlen)) != SCARD_S_SUCCESS:
        return None
    return bytes(recv[: rlen.value])


GET_UID = [0xFF, 0xCA, 0x00, 0x00, 0x00]
BUZZ_OFF = [0xFF, 0x00, 0x52, 0x00, 0x00]           # mute default detect beep
LED_OK = [0xFF, 0x00, 0x40, 0x28, 0x04, 0x02, 0x00, 0x01, 0x01]   # green + 1 beep
LED_ERR = [0xFF, 0x00, 0x40, 0x50, 0x04, 0x01, 0x01, 0x02, 0x03]  # red + 2 beeps

# ---- shared state -----------------------------------------------------------
state_lock = threading.Lock()
latest = {"seq": 0, "uid": "", "reader": ""}
reader_map = {}       # role -> reader name
feedback_q = {}       # role -> "ok" | "err"


def publish(uid, role):
    with state_lock:
        latest["seq"] += 1
        latest["uid"] = uid
        latest["reader"] = role
    print(f"[tap] {role}: {uid}")


def poll_reader(ctx, role, reader):
    print(f"[bridge] {role} <- {reader}")
    last_uid = None
    while True:
        try:
            fb = feedback_q.pop(role, None)
            hcard, proto = connect(ctx, reader)
            if hcard:
                resp = transmit(hcard, proto, GET_UID)
                if resp and len(resp) >= 2 and resp[-2] == 0x90:
                    uid = "".join(f"{b:02X}" for b in resp[:-2])
                    if uid and uid != last_uid:
                        last_uid = uid
                        publish(uid, role)
                if fb:
                    transmit(hcard, proto, LED_OK if fb == "ok" else LED_ERR)
                winscard.SCardDisconnect(hcard, SCARD_LEAVE_CARD)
            else:
                last_uid = None
        except Exception:
            last_uid = None
            time.sleep(0.5)
        time.sleep(0.12)


# ---- HTTP API ---------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    def _headers(self, code=200):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_OPTIONS(self):
        self._headers(204)

    def do_GET(self):
        if self.path.startswith("/tap"):
            with state_lock:
                body = json.dumps(latest)
            self._headers(); self.wfile.write(body.encode())
        elif self.path.startswith("/readers"):
            self._headers(); self.wfile.write(json.dumps(reader_map).encode())
        else:
            self._headers(404); self.wfile.write(b'{"error":"not found"}')

    def do_POST(self):
        if self.path.startswith("/feedback"):
            try:
                n = int(self.headers.get("Content-Length", 0))
                data = json.loads(self.rfile.read(n) or b"{}")
                role = data.get("reader", "")
                if role in reader_map:
                    feedback_q[role] = "ok" if data.get("ok") else "err"
                self._headers(); self.wfile.write(b'{"ok":true}')
            except Exception:
                self._headers(400); self.wfile.write(b'{"error":"bad request"}')
        else:
            self._headers(404); self.wfile.write(b'{"error":"not found"}')

    def log_message(self, *args):
        pass


def main():
    ctx = establish()
    if ctx is None:
        print("Could not open the smart-card service. Is it running? Re-run after plugging in the reader.")
        return
    rs = sorted(list_readers(ctx))
    if not rs:
        print("No PC/SC readers found. Plug in the ACR122U and re-run.")
        return

    overrides = {}
    cfg = os.path.join(os.path.dirname(os.path.abspath(__file__)), "readers.json")
    if os.path.exists(cfg):
        with open(cfg) as f:
            overrides = json.load(f)

    for i, role in enumerate(ROLES):
        idx = overrides.get(role, i)
        if isinstance(idx, int) and 0 <= idx < len(rs):
            reader_map[role] = rs[idx]

    print(f"[bridge] {len(rs)} reader(s):")
    for role, r in reader_map.items():
        threading.Thread(target=poll_reader, args=(ctx, role, r), daemon=True).start()

    print(f"[bridge] serving http://127.0.0.1:{PORT}  (Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()

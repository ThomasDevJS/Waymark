#!/usr/bin/env python3
# Sends key presses to the focused X window through XTest (used to accept Chrome's native
# permission dialog in headed e2e runs under Xvfb). Usage: x11-keys.py Tab,Return or Alt_L+r
import ctypes, sys, time
x11 = ctypes.CDLL('libX11.so.6'); xtst = ctypes.CDLL('libXtst.so.6')
x11.XOpenDisplay.restype = ctypes.c_void_p
d = x11.XOpenDisplay(None)
if not d: sys.exit('no display')
x11.XStringToKeysym.restype = ctypes.c_ulong
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
x11.XFlush.argtypes=[ctypes.c_void_p]
# A chord such as Alt_L+r holds the keys down in order, then releases them in reverse (D105).
for name in sys.argv[1].split(','):
    kcs = [x11.XKeysymToKeycode(d, x11.XStringToKeysym(k.encode())) for k in name.split('+')]
    for kc in kcs: xtst.XTestFakeKeyEvent(d, kc, 1, 0)
    for kc in reversed(kcs): xtst.XTestFakeKeyEvent(d, kc, 0, 0)
    x11.XFlush(d); time.sleep(0.2)
print('sent', sys.argv[1])

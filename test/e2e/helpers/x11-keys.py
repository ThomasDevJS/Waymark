#!/usr/bin/env python3
# Sends key presses to the focused X window through XTest (used to accept Chrome's native
# permission dialog in headed e2e runs under Xvfb). Usage: x11-keys.py Tab,Return
import ctypes, sys, time
x11 = ctypes.CDLL('libX11.so.6'); xtst = ctypes.CDLL('libXtst.so.6')
x11.XOpenDisplay.restype = ctypes.c_void_p
d = x11.XOpenDisplay(None)
if not d: sys.exit('no display')
x11.XStringToKeysym.restype = ctypes.c_ulong
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
x11.XFlush.argtypes=[ctypes.c_void_p]
for name in sys.argv[1].split(','):
    kc = x11.XKeysymToKeycode(d, x11.XStringToKeysym(name.encode()))
    xtst.XTestFakeKeyEvent(d, kc, 1, 0); xtst.XTestFakeKeyEvent(d, kc, 0, 0); x11.XFlush(d); time.sleep(0.2)
print('sent', sys.argv[1])

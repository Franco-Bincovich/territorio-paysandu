#!/usr/bin/python3
"""Install an inherited seccomp network filter before executing LibreOffice.

No shell, no credentials; fail closed when libseccomp is unavailable.
AF_UNIX remains available for LibreOffice's local IPC. Internet socket creation
is denied in this process and every descendant, independently of document XML.
"""
import ctypes
import errno
import os
import sys

class Compare(ctypes.Structure):
    _fields_ = [('arg', ctypes.c_uint), ('op', ctypes.c_uint),
                ('datum_a', ctypes.c_uint64), ('datum_b', ctypes.c_uint64)]

lib = ctypes.CDLL('libseccomp.so.2', use_errno=True)
lib.seccomp_init.argtypes = [ctypes.c_uint32]
lib.seccomp_init.restype = ctypes.c_void_p
lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
lib.seccomp_rule_add_array.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint, ctypes.POINTER(Compare)]
lib.seccomp_load.argtypes = [ctypes.c_void_p]
lib.seccomp_release.argtypes = [ctypes.c_void_p]
ctx = lib.seccomp_init(0x7fff0000)
if not ctx:
    sys.exit(70)
try:
    socket_call = lib.seccomp_syscall_resolve_name(b'socket')
    if socket_call < 0:
        sys.exit(70)
    # Only local UNIX sockets (AF_UNIX == 1) can be created.
    rule = Compare(0, 1, 1, 0)  # SCMP_CMP_NE
    if lib.seccomp_rule_add_array(ctx, 0x00050000 | errno.EACCES, socket_call, 1, ctypes.byref(rule)) != 0:
        sys.exit(70)
    if lib.seccomp_load(ctx) != 0:
        sys.exit(70)
finally:
    lib.seccomp_release(ctx)
os.execv(sys.argv[1], sys.argv[1:])

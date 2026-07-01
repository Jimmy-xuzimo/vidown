"""PyInstaller hook: m3u8 模块加密支持（用于 SAMPLE-AES 流）。"""

hiddenimports = [
    "m3u8",
    "m3u8.parser",
    "cryptography",
    "cryptography.hazmat",
    "cryptography.hazmat.primitives",
    "cryptography.hazmat.primitives.ciphers",
    "cryptography.hazmat.primitives.ciphers.aead",
    "cryptography.hazmat.primitives.ciphers.algorithms",
    "cryptography.hazmat.primitives.ciphers.modes",
    "cryptography.hazmat.backends.openssl",
]

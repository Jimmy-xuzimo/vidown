"""PyInstaller hook: browser_cookie3 隐式导入。"""

hiddenimports = [
    "browser_cookie3",
    "Crypto",                # pycryptodome
    "Cryptodome",
    "Cryptodome.Cipher",
    "Cryptodome.Cipher.DES",
    "Cryptodome.Cipher.AES",
    "Cryptodome.Util.Padding",
    "keyring",
    "keyring.backends",
    "keyring.backends.macOS",
    "keyring.backends.Windows",
    "keyring.backends.kwallet",
    "keyring.backends.SecretService",
    "keyring.backends.fail",
    "keyring.backends.null",
]

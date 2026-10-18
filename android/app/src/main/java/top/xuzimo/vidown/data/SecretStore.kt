package top.xuzimo.vidown.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Small credentials/checkpoints only. Browser profiles remain private and are excluded from backup.
 */
class SecretStore(context: Context) {
    private val root = File(context.noBackupFilesDir, "secrets").apply { mkdirs() }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("vidown.v1", null) as? SecretKey)?.let {
            return it
        }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply {
                init(
                    KeyGenParameterSpec.Builder(
                            "vidown.v1",
                            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                        )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .build()
                )
            }
            .generateKey()
    }

    @Synchronized
    fun put(id: String, text: String) {
        require(id.matches(Regex("[a-zA-Z0-9.-]{1,100}")))
        val cipher =
            Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val file = File(root, id)
        val temp = File(root, "$id.tmp")
        temp.writeBytes(
            byteArrayOf(cipher.iv.size.toByte()) + cipher.iv + cipher.doFinal(text.toByteArray())
        )
        check(temp.renameTo(file))
    }

    @Synchronized
    fun get(id: String): String? {
        require(id.matches(Regex("[a-zA-Z0-9.-]{1,100}")))
        val file = File(root, id)
        if (!file.exists()) return null
        val bytes = file.readBytes()
        require(bytes.size > 28 && bytes[0].toInt() == 12)
        return Cipher.getInstance("AES/GCM/NoPadding")
            .apply {
                init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
            }
            .doFinal(bytes.copyOfRange(13, bytes.size))
            .toString(Charsets.UTF_8)
    }

    @Synchronized
    fun remove(id: String) {
        File(root, id).delete()
    }

    @Synchronized
    fun clear() {
        root.listFiles()?.forEach { it.delete() }
    }
}

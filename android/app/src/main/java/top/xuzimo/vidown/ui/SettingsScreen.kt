package top.xuzimo.vidown.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import top.xuzimo.vidown.BuildConfig
import top.xuzimo.vidown.MainViewModel

@Composable
fun SettingsScreen(vm: MainViewModel) {
    val s by vm.settings.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val localNetworkPermission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            vm.message.value = if (granted) "已允许局域网访问，可以重试本地媒体链接" else "未授予局域网权限，互联网下载仍可使用"
        }
    var clear by remember { mutableStateOf(false) }
    var clearBrowser by remember { mutableStateOf(true) }
    var clearHistory by remember { mutableStateOf(false) }
    var proxy by rememberSaveable(s.proxy) { mutableStateOf(s.proxy) }
    var limit by rememberSaveable(s.speedLimitKib) { mutableStateOf(s.speedLimitKib.toString()) }
    var licenses by remember { mutableStateOf<String?>(null) }
    val directory =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
            if (uri != null)
                vm.run {
                    context.contentResolver.takePersistableUriPermission(
                        uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or
                            Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
                    )
                    vm.graph.settingsStore.update { it.copy(directoryUri = uri.toString()) }
                }
        }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 880.dp)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            SettingsGroup("外观", Icons.Rounded.Palette) {
                ChoiceRow(
                    listOf("system" to "跟随系统", "light" to "浅色", "dark" to "深色"),
                    s.colorMode,
                ) { mode ->
                    vm.update { it.copy(colorMode = mode) }
                }
                ChoiceRow(
                    listOf("iris" to "鸢尾", "ocean" to "海湾", "jade" to "青玉", "rose" to "蔷薇"),
                    s.theme,
                ) { theme ->
                    vm.update { it.copy(theme = theme) }
                }
                Toggle("界面动效", s.animations) { value -> vm.update { it.copy(animations = value) } }
            }
            SettingsGroup("下载与网络", Icons.Rounded.Tune) {
                if (android.os.Build.VERSION.SDK_INT >= 37) {
                    TextButton(
                        onClick = {
                            localNetworkPermission.launch("android.permission.ACCESS_LOCAL_NETWORK")
                        }
                    ) {
                        Text("允许访问局域网媒体")
                    }
                    Text("仅在下载局域网或本机媒体时需要系统授权。", style = MaterialTheme.typography.bodySmall)
                }
                ChoiceRow((1..4).map { it.toString() to "$it 个并发" }, s.concurrency.toString()) {
                    value ->
                    vm.update { it.copy(concurrency = value.toInt()) }
                }
                OutlinedTextField(
                    limit,
                    { limit = it.filter(Char::isDigit).take(7) },
                    label = { Text("限速 KB/s，0 为不限速") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    proxy,
                    { proxy = it },
                    label = { Text("代理：system、direct 或 http://host:port") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = {
                        vm.run {
                            require(
                                proxy in setOf("system", "direct") ||
                                    runCatching {
                                            val u = java.net.URI(proxy)
                                            u.scheme in setOf("http", "https", "socks5") &&
                                                u.host != null &&
                                                u.port in 1..65535 &&
                                                u.rawUserInfo == null
                                        }
                                        .getOrDefault(false)
                            ) {
                                "请输入不含账号密码的有效代理地址"
                            }
                            vm.graph.settingsStore.update {
                                it.copy(proxy = proxy, speedLimitKib = limit.toIntOrNull() ?: 0)
                            }
                        }
                    }
                ) {
                    Text("应用网络设置")
                }
                Toggle("仅在非计费网络下载", s.unmeteredOnly) { value ->
                    vm.update { it.copy(unmeteredOnly = value) }
                }
                Text(if (s.directoryUri == null) "保存至系统视频／音乐目录" else "保存至已授权的自定义文件夹")
                Row {
                    TextButton(onClick = { directory.launch(null) }) { Text("选择保存目录") }
                    if (s.directoryUri != null)
                        TextButton(onClick = { vm.update { it.copy(directoryUri = null) } }) {
                            Text("恢复系统目录")
                        }
                }
            }
            SettingsGroup("隐私与数据", Icons.Rounded.Shield) {
                Toggle("应用获得焦点时读取剪贴板链接", s.clipboard) { value ->
                    vm.update { it.copy(clipboard = value) }
                }
                Text(
                    "仅填入空白输入框，不自动解析或开始下载。登录信息保存在应用私有浏览器资料中。",
                    style = MaterialTheme.typography.bodySmall,
                )
                OutlinedButton(onClick = { clear = true }) { Text("清除浏览器数据与下载记录") }
                TextButton(
                    onClick = {
                        vm.run {
                            val file =
                                withContext(Dispatchers.IO) {
                                    val rows = vm.graph.database.tasks().all()
                                    val report =
                                        JSONObject()
                                            .put("version", BuildConfig.VERSION_NAME)
                                            .put("android", android.os.Build.VERSION.SDK_INT)
                                            .put(
                                                "abi",
                                                android.os.Build.SUPPORTED_ABIS.joinToString(),
                                            )
                                            .put(
                                                "tasks",
                                                JSONArray(
                                                    rows.map {
                                                        JSONObject()
                                                            .put("state", it.state)
                                                            .put("bytes", it.bytes)
                                                            .put("sequence", it.sequence)
                                                    }
                                                ),
                                            )
                                    File(context.cacheDir, "diagnostics")
                                        .apply { mkdirs() }
                                        .let {
                                            File(it, "vidown-diagnostics.json").apply {
                                                writeText(report.toString(2))
                                            }
                                        }
                                }
                            val uri =
                                FileProvider.getUriForFile(
                                    context,
                                    "${context.packageName}.files",
                                    file,
                                )
                            context.startActivity(
                                Intent.createChooser(
                                    Intent(Intent.ACTION_SEND)
                                        .setType("application/json")
                                        .putExtra(Intent.EXTRA_STREAM, uri)
                                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
                                    "导出脱敏诊断",
                                )
                            )
                        }
                    }
                ) {
                    Text("导出诊断（不含链接、标题及登录信息）")
                }
            }
            SettingsGroup("关于 Vidown", Icons.Rounded.Info) {
                BrandMark(56.dp)
                Text(
                    "Vidown ${BuildConfig.VERSION_NAME}",
                    style = MaterialTheme.typography.titleMedium,
                )
                Text("把精彩，留在身边。\n原生 Android 媒体下载工具。浏览器与提取引擎随应用提供；仅保存有权下载的内容。")
                TextButton(
                    onClick = {
                        vm.run {
                            context.startActivity(
                                Intent(
                                    Intent.ACTION_VIEW,
                                    Uri.parse("https://github.com/Jimmy-xuzimo/vidown"),
                                )
                            )
                        }
                    }
                ) {
                    Icon(Icons.Rounded.Code, null)
                    Spacer(Modifier.width(8.dp))
                    Text("GitHub 仓库")
                }
                TextButton(
                    onClick = {
                        vm.run {
                            context.startActivity(
                                Intent(
                                    Intent.ACTION_VIEW,
                                    Uri.parse("https://jimmy-xuzimo.github.io/vidown/"),
                                )
                            )
                        }
                    }
                ) {
                    Icon(Icons.Rounded.OpenInNew, null)
                    Spacer(Modifier.width(8.dp))
                    Text("项目介绍网页")
                }
                TextButton(
                    onClick = {
                        vm.run {
                            licenses =
                                withContext(Dispatchers.IO) {
                                    listOf("licenses.txt", "component-notices.txt").joinToString(
                                        "\n\n"
                                    ) { name ->
                                        context.assets.open(name).bufferedReader().use {
                                            it.readText()
                                        }
                                    }
                                }
                        }
                    }
                ) {
                    Text("开源组件与许可证")
                }
            }
        }
    }
    if (clear)
        AlertDialog(
            onDismissRequest = { clear = false },
            title = { Text("清除本机数据") },
            text = {
                Column {
                    Toggle("Cookie、登录状态、缓存及浏览历史", clearBrowser) { clearBrowser = it }
                    Toggle("已结束的下载记录", clearHistory) { clearHistory = it }
                    Text("不会删除已保存文件或主题设置。清除浏览器前需结束所有下载。旧资源与授权会失效。")
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        clear = false
                        vm.run {
                            val count = vm.graph.clearData(clearBrowser, clearHistory)
                            if (clearBrowser) vm.assets.value = emptyList()
                            vm.message.value = "清理完成，移除 $count 条记录"
                        }
                    }
                ) {
                    Text("清除")
                }
            },
            dismissButton = { TextButton(onClick = { clear = false }) { Text("取消") } },
        )
    licenses?.let { text ->
        AlertDialog(
            onDismissRequest = { licenses = null },
            title = { Text("开源组件") },
            text = { Text(text, Modifier.verticalScroll(rememberScrollState())) },
            confirmButton = { TextButton(onClick = { licenses = null }) { Text("关闭") } },
        )
    }
}

@Composable
private fun Toggle(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth()
            .heightIn(min = 56.dp)
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, Modifier.weight(1f))
        Switch(checked, null)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChoiceRow(
    options: List<Pair<String, String>>,
    selected: String,
    onChange: (String) -> Unit,
) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (id, label) ->
            FilterChip(selected == id, { onChange(id) }, label = { Text(label) })
        }
    }
}

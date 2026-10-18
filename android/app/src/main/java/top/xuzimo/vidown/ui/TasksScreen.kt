package top.xuzimo.vidown.ui

import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import top.xuzimo.vidown.MainViewModel
import top.xuzimo.vidown.core.*
import top.xuzimo.vidown.data.TaskEntity

@Composable
fun TasksScreen(vm: MainViewModel, history: Boolean) {
    val all by vm.tasks.collectAsStateWithLifecycle()
    var search by rememberSaveable { mutableStateOf("") }
    val rows =
        all.filter { TaskTransitions.active(TaskState.valueOf(it.state)) != history }
            .filter { it.title.contains(search, true) }
    var removing by remember { mutableStateOf<List<TaskEntity>>(emptyList()) }
    var deleteFiles by remember { mutableStateOf(false) }
    var pendingTrash by remember { mutableStateOf<List<TaskEntity>>(emptyList()) }
    val context = LocalContext.current
    val trash =
        rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) {
            result ->
            if (result.resultCode == android.app.Activity.RESULT_OK)
                vm.run { pendingTrash.forEach { vm.graph.queue.remove(it.id) } }
            pendingTrash = emptyList()
        }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 960.dp).fillMaxSize().padding(horizontal = 20.dp)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    search,
                    { search = it },
                    label = { Text("搜索记录") },
                    leadingIcon = { Icon(Icons.Rounded.Search, null) },
                    shape = RoundedCornerShape(28.dp),
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                if (history)
                    TextButton(onClick = { removing = rows }, enabled = rows.isNotEmpty()) {
                        Text("清空")
                    }
            }
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (rows.isEmpty())
                    item {
                        EmptyState(
                            if (history) Icons.Rounded.History else Icons.Rounded.Download,
                            if (history) "还没有下载记录" else "准备好保存精彩",
                            if (history) "完成的下载会保存在这里，可随时查找和管理。" else "队列为空，解析链接后选择轨道即可下载",
                        )
                    }
                items(rows, key = { it.id }) { t ->
                    Card(
                        Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(24.dp),
                        colors =
                            CardDefaults.cardColors(
                                containerColor = MaterialTheme.colorScheme.surfaceContainerLowest
                            ),
                    ) {
                        Column(
                            Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Surface(
                                    shape = RoundedCornerShape(16.dp),
                                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                                ) {
                                    Icon(
                                        Icons.Rounded.PlayArrow,
                                        null,
                                        Modifier.padding(12.dp),
                                        tint = MaterialTheme.colorScheme.primary,
                                    )
                                }
                                Text(
                                    t.title,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Medium,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f),
                                )
                            }
                            val state = TaskState.valueOf(t.state)
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color =
                                    if (state == TaskState.FAILED)
                                        MaterialTheme.colorScheme.errorContainer
                                    else MaterialTheme.colorScheme.primaryContainer,
                            ) {
                                Text(
                                    stateLabel(state),
                                    Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                                    style = MaterialTheme.typography.labelMedium,
                                    color =
                                        if (state == TaskState.FAILED)
                                            MaterialTheme.colorScheme.onErrorContainer
                                        else MaterialTheme.colorScheme.onPrimaryContainer,
                                )
                            }
                            if (state == TaskState.DOWNLOADING) {
                                t.total
                                    ?.takeIf { it > 0 }
                                    ?.let {
                                        val progress by
                                            animateFloatAsState(
                                                (t.bytes.toFloat() / it).coerceIn(0f, 1f),
                                                effectsMotion(),
                                                label = "下载进度",
                                            )
                                        LinearProgressIndicator(
                                            progress = { progress },
                                            modifier = Modifier.fillMaxWidth(),
                                        )
                                    } ?: LinearProgressIndicator(Modifier.fillMaxWidth())
                                Text(
                                    "${bytes(t.bytes)}${t.total?.let{" / ${bytes(it)}"}.orEmpty()} · ${bytes(t.speed)}/s"
                                )
                            }
                            t.message?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (state == TaskState.DOWNLOADING && t.canPause)
                                    TextButton(
                                        onClick = { vm.run { vm.graph.queue.pause(t.id) } }
                                    ) {
                                        Text("暂停")
                                    }
                                if (state == TaskState.PAUSED)
                                    TextButton(
                                        onClick = { vm.run { vm.graph.queue.resume(t.id) } }
                                    ) {
                                        Text("继续")
                                    }
                                if (TaskTransitions.active(state))
                                    TextButton(
                                        onClick = { vm.run { vm.graph.queue.cancel(t.id) } }
                                    ) {
                                        Text("取消")
                                    }
                                else TextButton(onClick = { removing = listOf(t) }) { Text("删除记录") }
                                if (!TaskTransitions.active(state))
                                    TextButton(
                                        onClick = {
                                            vm.run {
                                                vm.input.value = vm.graph.queue.source(t.id)
                                                vm.page.value = 0
                                                vm.probe()
                                            }
                                        }
                                    ) {
                                        Text("重新解析")
                                    }
                                if (t.outputUri != null)
                                    TextButton(
                                        onClick = {
                                            vm.run {
                                                context.startActivity(
                                                    Intent(Intent.ACTION_VIEW)
                                                        .setDataAndType(
                                                            Uri.parse(t.outputUri),
                                                            context.contentResolver.getType(
                                                                Uri.parse(t.outputUri)
                                                            ) ?: "video/*",
                                                        )
                                                        .addFlags(
                                                            Intent.FLAG_GRANT_READ_URI_PERMISSION
                                                        )
                                                )
                                            }
                                        }
                                    ) {
                                        Text("打开文件")
                                    }
                            }
                        }
                    }
                }
            }
        }
    }
    if (removing.isNotEmpty())
        AlertDialog(
            onDismissRequest = { removing = emptyList() },
            title = { Text("删除 ${removing.size} 条记录？") },
            text = {
                Column {
                    Text("删除记录不会影响仍在下载的任务。")
                    Row {
                        Checkbox(deleteFiles, { deleteFiles = it })
                        Text("同时删除已保存文件", Modifier.padding(top = 12.dp))
                    }
                    if (deleteFiles) Text("系统媒体文件将移入回收站；自定义目录的文件将永久删除，无法撤销。")
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val selected = removing
                        removing = emptyList()
                        vm.run {
                            if (!deleteFiles) selected.forEach { vm.graph.queue.remove(it.id) }
                            else {
                                val system = selected.filter {
                                    it.outputUri?.let { u ->
                                        Uri.parse(u).authority == MediaStore.AUTHORITY
                                    } == true
                                }
                                for (t in selected - system.toSet()) {
                                    t.outputUri?.let { value ->
                                        withContext(Dispatchers.IO) {
                                            check(
                                                DocumentsContract.deleteDocument(
                                                    context.contentResolver,
                                                    Uri.parse(value),
                                                )
                                            ) {
                                                "文件删除失败，记录已保留"
                                            }
                                        }
                                    }
                                    vm.graph.queue.remove(t.id)
                                }
                                if (system.isNotEmpty()) {
                                    pendingTrash = system
                                    val request =
                                        MediaStore.createTrashRequest(
                                            context.contentResolver,
                                            system.map { Uri.parse(it.outputUri) },
                                            true,
                                        )
                                    trash.launch(
                                        IntentSenderRequest.Builder(request.intentSender).build()
                                    )
                                }
                            }
                        }
                    }
                ) {
                    Text("确认删除")
                }
            },
            dismissButton = { TextButton(onClick = { removing = emptyList() }) { Text("取消") } },
        )
}

private fun bytes(value: Long): String =
    when {
        value >= 1024L * 1024 * 1024 -> "%.2f GB".format(value.toDouble() / (1024 * 1024 * 1024))
        value >= 1024 * 1024 -> "%.1f MB".format(value.toDouble() / (1024 * 1024))
        value >= 1024 -> "%.1f KB".format(value.toDouble() / 1024)
        else -> "$value B"
    }

private fun stateLabel(state: TaskState) =
    when (state) {
        TaskState.QUEUED -> "等待下载"
        TaskState.DOWNLOADING -> "下载中"
        TaskState.PAUSED -> "已暂停"
        TaskState.MERGING -> "合并中"
        TaskState.VERIFYING -> "验证与保存"
        TaskState.COMPLETED -> "完成"
        TaskState.CANCELLED -> "已取消"
        TaskState.FAILED -> "失败"
        TaskState.INTERRUPTED -> "已中断，请重新解析"
    }

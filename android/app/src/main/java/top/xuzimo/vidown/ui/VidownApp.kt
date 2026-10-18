package top.xuzimo.vidown.ui

import androidx.compose.animation.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import top.xuzimo.vidown.MainViewModel
import top.xuzimo.vidown.core.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VidownApp(vm: MainViewModel, permission: () -> Unit) {
    val settings by vm.settings.collectAsStateWithLifecycle()
    VidownTheme(settings) {
        val page by vm.page.collectAsStateWithLifecycle()
        val fullscreen by vm.graph.browser.fullScreen.collectAsStateWithLifecycle()
        val tasks by vm.tasks.collectAsStateWithLifecycle()
        val hideChrome = page == 1 && fullscreen
        val landscape =
            LocalConfiguration.current.orientation ==
                android.content.res.Configuration.ORIENTATION_LANDSCAPE
        val message by vm.message.collectAsStateWithLifecycle()
        val snack = remember { SnackbarHostState() }
        LaunchedEffect(message) {
            message?.let {
                snack.showSnackbar(it)
                vm.message.value = null
            }
        }
        val titles = listOf("工作台", "浏览器", "任务", "历史", "设置")
        val subtitles =
            listOf("链接、画质与每一份珍藏", "访问、登录与发现媒体", "正在保存的精彩", "保存在本机的下载记录", "让 Vidown 更合你的习惯")
        val activeCount = tasks.count { TaskTransitions.active(TaskState.valueOf(it.state)) }
        Row(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            if (landscape && !hideChrome)
                FloatingNavigation(page, activeCount, { vm.page.value = it }, vertical = true)
            Scaffold(
                modifier = Modifier.weight(1f),
                containerColor = MaterialTheme.colorScheme.background,
                contentWindowInsets = if (hideChrome) WindowInsets(0) else WindowInsets.safeDrawing,
                snackbarHost = { SnackbarHost(snack) },
                topBar = {
                    if (page != 1)
                        TopAppBar(
                            title = {
                                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text(
                                        titles[page],
                                        style = MaterialTheme.typography.titleLarge,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                    Text(
                                        subtitles[page],
                                        style = MaterialTheme.typography.labelMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            },
                            navigationIcon = {
                                Box(Modifier.padding(start = 16.dp, end = 12.dp)) {
                                    BrandMark(40.dp)
                                }
                            },
                            actions = {
                                Text(
                                    "Vidown",
                                    style = MaterialTheme.typography.labelLarge,
                                    color = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.padding(end = 20.dp),
                                )
                            },
                            colors =
                                TopAppBarDefaults.topAppBarColors(
                                    containerColor = MaterialTheme.colorScheme.background
                                ),
                        )
                },
                bottomBar = {
                    if (!landscape && !hideChrome)
                        FloatingNavigation(page, activeCount, { vm.page.value = it })
                },
            ) { padding ->
                val effects = effectsMotion<Float>()
                val spatial = spatialMotion<androidx.compose.ui.unit.IntOffset>()
                AnimatedContent(
                    targetState = page,
                    modifier = Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding),
                    transitionSpec = {
                        ((fadeIn(effects) + slideInVertically(spatial) { it / 24 }) togetherWith
                                fadeOut(effects))
                            .using(null)
                    },
                    label = "导航页面",
                ) { current ->
                    when (current) {
                        0 -> Workbench(vm, permission)
                        1 -> BrowserScreen(vm)
                        2 -> TasksScreen(vm, false)
                        3 -> TasksScreen(vm, true)
                        else -> SettingsScreen(vm)
                    }
                }
            }
        }
    }
}

@Composable
fun Workbench(vm: MainViewModel, permission: () -> Unit) {
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = LocalFocusManager.current
    val input by vm.input.collectAsStateWithLifecycle()
    val assets by vm.assets.collectAsStateWithLifecycle()
    val reveal by vm.revealAsset.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val failure by vm.probeError.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val listState = rememberLazyListState()
    val animations = LocalAnimationsEnabled.current
    LaunchedEffect(failure) {
        if (failure != null) {
            if (animations) listState.animateScrollToItem(0) else listState.scrollToItem(0)
        }
    }
    LaunchedEffect(reveal) {
        val index = assets.indexOfFirst { it.id == reveal }
        if (reveal != null && index >= 0) {
            if (animations) listState.animateScrollToItem(index + 2)
            else listState.scrollToItem(index + 2)
            vm.revealAsset.compareAndSet(reveal, null)
        }
    }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        LazyColumn(
            Modifier.widthIn(max = 1040.dp).fillMaxSize().testTag("workbench-list"),
            state = listState,
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            item {
                Surface(
                    shape = RoundedCornerShape(28.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerLowest,
                ) {
                    Column(
                        Modifier.padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        SectionHeading("添加媒体链接", "粘贴网址或分享文字，自动识别链接", Icons.Rounded.AddLink)
                        OutlinedTextField(
                            input,
                            { vm.input.value = it },
                            label = { Text("媒体链接，每行一个") },
                            placeholder = { Text("https://…") },
                            minLines = 2,
                            maxLines = 5,
                            modifier = Modifier.fillMaxWidth().testTag("media-input"),
                            shape = RoundedCornerShape(20.dp),
                            trailingIcon = {
                                IconButton(
                                    onClick = {
                                        val clipboard =
                                            context.getSystemService(
                                                android.content.ClipboardManager::class.java
                                            )
                                        clipboard.primaryClip
                                            ?.getItemAt(0)
                                            ?.coerceToText(context)
                                            ?.let {
                                                vm.input.value = it.toString().take(16384)
                                            }
                                    }
                                ) {
                                    Icon(Icons.Rounded.ContentPaste, "粘贴链接")
                                }
                            },
                        )
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Button(
                                onClick = {
                                    focus.clearFocus()
                                    keyboard?.hide()
                                    vm.probe()
                                },
                                enabled = !busy && input.isNotBlank(),
                                contentPadding =
                                    PaddingValues(horizontal = 24.dp, vertical = 14.dp),
                            ) {
                                if (busy)
                                    CircularProgressIndicator(
                                        Modifier.size(20.dp),
                                        strokeWidth = 2.dp,
                                    )
                                else Icon(Icons.Rounded.Search, null)
                                Spacer(Modifier.width(8.dp))
                                Text(if (busy) "正在解析" else "解析链接")
                            }
                            FilledTonalButton(
                                onClick = {
                                    focus.clearFocus()
                                    keyboard?.hide()
                                    vm.browse(
                                        runCatching { mediaLinks(input).firstOrNull() }.getOrNull()
                                    )
                                },
                                contentPadding =
                                    PaddingValues(horizontal = 20.dp, vertical = 14.dp),
                            ) {
                                Icon(Icons.Rounded.Language, null)
                                Spacer(Modifier.width(8.dp))
                                Text("在浏览器中打开")
                            }
                        }
                        Text(
                            "需要登录时，先在内置浏览器登录并播放，再回到这里解析。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        failure?.let { error ->
                            Surface(
                                color = MaterialTheme.colorScheme.errorContainer,
                                shape = RoundedCornerShape(16.dp),
                                modifier = Modifier.testTag("probe-error"),
                            ) {
                                Row(
                                    Modifier.padding(16.dp),
                                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                                ) {
                                    Icon(
                                        Icons.Rounded.ErrorOutline,
                                        null,
                                        tint = MaterialTheme.colorScheme.onErrorContainer,
                                    )
                                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Text(
                                            "暂时无法解析",
                                            style = MaterialTheme.typography.titleSmall,
                                            color = MaterialTheme.colorScheme.onErrorContainer,
                                        )
                                        Text(
                                            error,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onErrorContainer,
                                        )
                                        Text(
                                            "可重试，或使用上方浏览器入口登录并播放后重新解析。",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onErrorContainer,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (assets.isNotEmpty())
                item { SectionHeading("可保存的媒体", "画质与音质以网页实际提供的规格为准", Icons.Rounded.VideoLibrary) }
            items(assets, key = { it.id }) { asset ->
                AssetCard(asset) { ids, compatible, audio ->
                    permission()
                    vm.enqueue(asset, ids, compatible, audio)
                }
            }
            if (assets.isEmpty())
                item {
                    Text(
                        "把精彩，留在身边。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 4.dp, bottom = 12.dp),
                    )
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Rounded.VerifiedUser,
                            null,
                            tint = MaterialTheme.colorScheme.primary,
                        )
                        Text(
                            "本机处理 · 保留源规格 · 保存前验证",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
        }
    }
}

@Composable
internal fun AssetCard(asset: MediaAsset, onDownload: (Set<String>, Boolean, Boolean) -> Unit) {
    var video by
        rememberSaveable(asset.id) {
            mutableStateOf(
                asset.tracks
                    .filter { it.kind != TrackKind.AUDIO }
                    .maxByOrNull { it.height ?: 0 }
                    ?.id
            )
        }
    var audio by
        rememberSaveable(asset.id) {
            mutableStateOf(
                asset.tracks
                    .filter { it.kind == TrackKind.AUDIO }
                    .maxByOrNull { it.bitrate ?: 0 }
                    ?.id
            )
        }
    var compatible by rememberSaveable { mutableStateOf(false) }
    var audioOnly by rememberSaveable { mutableStateOf(false) }
    val videos =
        remember(asset) {
            asset.tracks
                .filter { it.kind != TrackKind.AUDIO }
                .sortedWith(
                    compareByDescending<Track> { it.height ?: 0 }
                        .thenByDescending { it.fps ?: 0.0 }
                        .thenByDescending { it.bitrate ?: 0L }
                )
        }
    val audios =
        remember(asset) {
            asset.tracks
                .filter { it.kind == TrackKind.AUDIO }
                .sortedByDescending { it.bitrate ?: 0L }
        }
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(28.dp),
        colors =
            CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceContainerLowest
            ),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                asset.title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            asset.warnings.forEach { Text(it, color = MaterialTheme.colorScheme.error) }
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Rounded.HighQuality,
                    null,
                    Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
                Text(
                    "${videos.size} 种视频 · ${audios.size} 种独立音频" +
                        (asset.duration?.let {
                            " · ${it.toInt() / 60}:${(it.toInt() % 60).toString().padStart(2, '0')}"
                        } ?: ""),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            val muxed = videos.find { it.id == video }?.kind == TrackKind.MUXED
            Text(
                "选择视频与音频规格",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary,
            )
            if (videos.isNotEmpty())
                TrackPicker("视频格式 · ${videos.size} 种", videos, video, "video-format") {
                    video = it
                }
            if (audios.isNotEmpty())
                TrackPicker(
                    "音频格式 · ${audios.size} 种",
                    audios,
                    audio,
                    "audio-format",
                    !muxed || audioOnly,
                ) {
                    audio = it
                }
            if (muxed && !audioOnly)
                Text("所选源已包含音频，将直接保存原始音视频。", style = MaterialTheme.typography.bodySmall)
            else if (audios.isEmpty())
                Text("源未提供独立音频格式；不会虚构音轨或音质。", style = MaterialTheme.typography.bodySmall)
            if (videos.isEmpty()) Text("此资源仅提供音频格式。", style = MaterialTheme.typography.bodySmall)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .45f))
            Row(
                Modifier.fillMaxWidth().toggleable(
                    audioOnly,
                    role = androidx.compose.ui.semantics.Role.Checkbox,
                ) {
                    audioOnly = it
                },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(audioOnly, null)
                Text("仅保存音频", style = MaterialTheme.typography.bodyMedium)
            }
            Row(
                Modifier.fillMaxWidth().toggleable(
                    compatible,
                    role = androidx.compose.ui.semantics.Role.Checkbox,
                ) {
                    compatible = it
                },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(compatible, null)
                Text("兼容 MP4 导出（可能降低画质／音质）", style = MaterialTheme.typography.bodyMedium)
            }
            if (compatible)
                Text(
                    "将视频转换为 AVC、音频转换为 AAC。HDR 与杜比视界不执行兼容转换。",
                    style = MaterialTheme.typography.bodySmall,
                )
            Button(
                onClick = {
                    onDownload(
                        setOfNotNull(
                            video.takeUnless { audioOnly && audio != null },
                            audio.takeIf { !muxed || audioOnly },
                        ),
                        compatible,
                        audioOnly,
                    )
                },
                enabled =
                    (video != null || audio != null) &&
                        (audioOnly ||
                            asset.tracks.none { it.id == video && it.kind == TrackKind.VIDEO } ||
                            asset.tracks.none { it.kind == TrackKind.AUDIO } ||
                            audio != null),
            ) {
                Icon(Icons.Rounded.Download, null)
                Spacer(Modifier.width(8.dp))
                Text("加入队列")
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TrackPicker(
    label: String,
    tracks: List<Track>,
    selected: String?,
    tag: String,
    enabled: Boolean = true,
    onSelect: (String?) -> Unit,
) {
    if (tracks.isEmpty()) return
    var expanded by remember { mutableStateOf(false) }
    val text = tracks.find { it.id == selected }?.let(::trackText) ?: "不保存此轨道"
    ExposedDropdownMenuBox(expanded, { if (enabled) expanded = it }) {
        OutlinedTextField(
            text,
            {},
            readOnly = true,
            enabled = enabled,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier =
                Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable, enabled)
                    .fillMaxWidth()
                    .testTag(tag),
        )
        ExposedDropdownMenu(expanded, { expanded = false }) {
            DropdownMenuItem(
                text = { Text("不保存此轨道") },
                onClick = {
                    onSelect(null)
                    expanded = false
                },
            )
            tracks.forEach { track ->
                DropdownMenuItem(
                    text = { Text(trackText(track)) },
                    onClick = {
                        onSelect(track.id)
                        expanded = false
                    },
                )
            }
        }
    }
}

private fun trackText(t: Track) =
    (t.label.split('·').map(String::trim).filter(String::isNotBlank) +
            listOfNotNull(
                t.height?.let { "${it}p" },
                t.fps?.let { "${it}fps" },
                t.codec,
                t.dynamicRange,
                t.bitrate?.let { "${it/1000} kbps" },
                t.sampleRate?.let { "$it Hz" },
                t.bitDepth?.let { "$it bit" },
                t.channels?.let { "$it 声道" },
                t.language,
            ))
        .distinctBy { it.lowercase().replace(" ", "").replace(".0fps", "fps") }
        .joinToString(" · ")
        .ifBlank { "规格未知" }

package top.xuzimo.vidown.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.*
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.mozilla.geckoview.GeckoView
import top.xuzimo.vidown.MainViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrowserScreen(vm: MainViewModel) {
    val browser = vm.graph.browser
    val context = LocalContext.current
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = remember { FocusRequester() }
    val tabs by browser.tabs.collectAsStateWithLifecycle()
    val active by browser.activeTab.collectAsStateWithLifecycle()
    val candidates by browser.candidates.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    val fullScreen by browser.fullScreen.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val tab = tabs.find { it.id == active }
    var address by rememberSaveable { mutableStateOf("") }
    var resources by rememberSaveable { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    val count = candidates.count { it.tabId == active }
    val tabScroll = rememberScrollState()
    LaunchedEffect(tabs.size) {
        if (settings.animations) tabScroll.animateScrollTo(tabScroll.maxValue)
        else tabScroll.scrollTo(tabScroll.maxValue)
    }
    LaunchedEffect(tab?.id, tab?.url) {
        address = tab?.url?.takeUnless { it == "about:blank" }.orEmpty()
    }
    BackHandler(enabled = fullScreen || resources || tab?.canGoBack == true) {
        if (fullScreen) browser.leaveFullScreen()
        else if (resources) resources = false else browser.session(active)?.goBack()
    }
    fun navigate() {
        keyboard?.hide()
        vm.run {
            if (active == null) browser.newTab(address) else browser.navigate(active!!, address)
        }
    }
    Column(Modifier.fillMaxSize()) {
        if (!fullScreen) {
            Surface(color = MaterialTheme.colorScheme.surfaceContainerLow) {
                Column {
                    Row(
                        Modifier.fillMaxWidth()
                            .height(52.dp)
                            .testTag("browser-tabs")
                            .horizontalScroll(tabScroll)
                            .padding(horizontal = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        tabs.forEach { item ->
                            Surface(
                                color =
                                    if (item.id == active)
                                        MaterialTheme.colorScheme.surfaceContainerLowest
                                    else MaterialTheme.colorScheme.surfaceContainerLow,
                                shape = RoundedCornerShape(16.dp),
                                modifier =
                                    Modifier.width(180.dp)
                                        .height(48.dp)
                                        .testTag("browser-tab-${item.id}"),
                                onClick = { browser.select(item.id) },
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        Icons.Rounded.Language,
                                        null,
                                        Modifier.padding(start = 12.dp).size(18.dp),
                                        tint = MaterialTheme.colorScheme.primary,
                                    )
                                    Text(
                                        item.title,
                                        Modifier.weight(1f).padding(start = 8.dp),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        style = MaterialTheme.typography.labelLarge,
                                    )
                                    IconButton(onClick = { browser.close(item.id) }) {
                                        Icon(
                                            Icons.Rounded.Close,
                                            "关闭标签页 ${item.title}",
                                            Modifier.size(18.dp),
                                        )
                                    }
                                }
                            }
                        }
                        IconButton(onClick = { vm.browse() }) { Icon(Icons.Rounded.Add, "新标签页") }
                    }
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconButton(
                            onClick = { browser.session(active)?.goBack() },
                            enabled = tab?.canGoBack == true,
                        ) {
                            Icon(Icons.AutoMirrored.Rounded.ArrowBack, "后退")
                        }
                        OutlinedTextField(
                            address,
                            { address = it },
                            singleLine = true,
                            placeholder = { Text("输入网址", maxLines = 1) },
                            shape = RoundedCornerShape(28.dp),
                            modifier =
                                Modifier.weight(1f)
                                    .focusRequester(focus)
                                    .testTag("browser-address"),
                            keyboardOptions =
                                KeyboardOptions(
                                    imeAction = ImeAction.Go,
                                    keyboardType = KeyboardType.Uri,
                                ),
                            keyboardActions = KeyboardActions(onGo = { navigate() }),
                            trailingIcon = {
                                IconButton(
                                    onClick = { navigate() },
                                    enabled = address.isNotBlank(),
                                ) {
                                    Icon(Icons.AutoMirrored.Rounded.ArrowForward, "访问")
                                }
                            },
                        )
                        Box {
                            IconButton(onClick = { menu = true }) {
                                Icon(Icons.Rounded.MoreVert, "浏览器菜单")
                            }
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                DropdownMenuItem(
                                    text = { Text("刷新网页") },
                                    leadingIcon = { Icon(Icons.Rounded.Refresh, null) },
                                    enabled = active != null,
                                    onClick = {
                                        menu = false
                                        browser.session(active)?.reload()
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("前进") },
                                    leadingIcon = {
                                        Icon(Icons.AutoMirrored.Rounded.ArrowForward, null)
                                    },
                                    enabled = tab?.canGoForward == true,
                                    onClick = {
                                        menu = false
                                        browser.session(active)?.goForward()
                                    },
                                )
                                HorizontalDivider()
                                DropdownMenuItem(
                                    text = { Text("使用系统浏览器打开") },
                                    leadingIcon = { Icon(Icons.Rounded.OpenInNew, null) },
                                    enabled = address.isNotBlank(),
                                    onClick = {
                                        menu = false
                                        vm.run {
                                            androidx.browser.customtabs.CustomTabsIntent.Builder()
                                                .build()
                                                .launchUrl(
                                                    context,
                                                    android.net.Uri.parse(
                                                        top.xuzimo.vidown.core.normalizeUrl(address)
                                                    ),
                                                )
                                        }
                                    },
                                )
                            }
                        }
                    }
                    FlowRow(
                        Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        itemVerticalAlignment = Alignment.CenterVertically,
                    ) {
                        FilledTonalButton(
                            onClick = {
                                tab?.url
                                    ?.takeIf { it.startsWith("http") }
                                    ?.let {
                                        vm.input.value = it
                                        vm.probe()
                                    }
                            },
                            enabled = !busy && tab?.url?.startsWith("http") == true,
                        ) {
                            Icon(Icons.Rounded.Search, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("解析当前页")
                        }
                        FilterChip(
                            selected = tab?.desktop ?: true,
                            enabled = active != null,
                            onClick = { active?.let(browser::desktop) },
                            label = { Text("桌面站点") },
                            leadingIcon = {
                                Icon(Icons.Rounded.DesktopWindows, null, Modifier.size(18.dp))
                            },
                            modifier = Modifier.testTag("desktop-mode"),
                        )
                        IconButton(
                            onClick = { resources = !resources },
                            modifier = Modifier.testTag("browser-resources"),
                        ) {
                            BadgedBox(badge = { if (count > 0) Badge { Text(count.toString()) } }) {
                                Icon(Icons.Rounded.VideoLibrary, "探测到的资源")
                            }
                        }
                    }
                    Box(Modifier.fillMaxWidth().height(4.dp)) {
                        if (tab?.loading == true) LinearProgressIndicator(Modifier.fillMaxWidth())
                    }
                }
            }
        }
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val wide = maxWidth >= 840.dp
            val compactWelcome = maxHeight < 240.dp
            val sheetMaxHeight = maxHeight * .75f
            Row(Modifier.fillMaxSize()) {
                Box(
                    Modifier.weight(1f)
                        .fillMaxHeight()
                        .background(MaterialTheme.colorScheme.surfaceContainerLow)
                ) {
                    if (tab == null || tab.url == "about:blank") {
                        if (compactWelcome) {
                            Row(
                                Modifier.align(Alignment.Center)
                                    .widthIn(max = 620.dp)
                                    .fillMaxWidth()
                                    .verticalScroll(rememberScrollState())
                                    .padding(16.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(16.dp),
                            ) {
                                BrandMark(40.dp)
                                Column(
                                    Modifier.weight(1f),
                                    verticalArrangement = Arrangement.spacedBy(4.dp),
                                ) {
                                    Text("把精彩，留在身边。", style = MaterialTheme.typography.titleMedium)
                                    Text(
                                        "默认桌面站点 · 登录并播放后查看媒体资源",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                FilledTonalIconButton(
                                    onClick = {
                                        if (tab == null) vm.browse()
                                        else {
                                            focus.requestFocus()
                                            keyboard?.show()
                                        }
                                    }
                                ) {
                                    Icon(Icons.Rounded.Add, "开始浏览")
                                }
                            }
                        } else
                            Column(
                                Modifier.align(Alignment.Center)
                                    .widthIn(max = 520.dp)
                                    .verticalScroll(rememberScrollState())
                                    .padding(28.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(16.dp),
                            ) {
                                BrandMark(72.dp)
                                Text(
                                    "把精彩，留在身边。",
                                    style = MaterialTheme.typography.headlineSmall,
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text(
                                    "用熟悉的桌面网页浏览。登录并播放后，查看可保存的媒体资源。",
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                )
                                FilledTonalButton(
                                    onClick = {
                                        if (tab == null) vm.browse()
                                        else {
                                            focus.requestFocus()
                                            keyboard?.show()
                                        }
                                    }
                                ) {
                                    Text("开始浏览")
                                }
                                Text(
                                    "默认桌面站点 · 支持双指缩放",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                    } else
                        key(tab.id) {
                            AndroidView(
                                factory = { viewContext ->
                                    GeckoView(viewContext).apply {
                                        browser.session(tab.id)?.let { setSession(it) }
                                    }
                                },
                                modifier = Modifier.fillMaxSize().testTag("browser-web"),
                                onRelease = { it.releaseSession() },
                            )
                        }
                }
                if (wide && resources && !fullScreen) {
                    Surface(
                        Modifier.width(320.dp).fillMaxHeight(),
                        color = MaterialTheme.colorScheme.surfaceContainerLowest,
                    ) {
                        Column {
                            Row(
                                Modifier.fillMaxWidth().padding(start = 20.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    "媒体资源",
                                    Modifier.weight(1f),
                                    style = MaterialTheme.typography.titleMedium,
                                )
                                IconButton(onClick = { resources = false }) {
                                    Icon(Icons.Rounded.Close, "收起资源面板")
                                }
                            }
                            ResourceList(vm, Modifier.weight(1f))
                        }
                    }
                }
            }
            if (!wide && resources && !fullScreen)
                ModalBottomSheet(
                    onDismissRequest = { resources = false },
                    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
                ) {
                    Text(
                        "媒体资源",
                        style = MaterialTheme.typography.titleLarge,
                        modifier = Modifier.padding(start = 24.dp, bottom = 12.dp),
                    )
                    ResourceList(
                        vm,
                        Modifier.fillMaxWidth()
                            .heightIn(min = minOf(180.dp, sheetMaxHeight), max = sheetMaxHeight),
                    )
                }
        }
    }
}

@Composable
private fun ResourceList(vm: MainViewModel, modifier: Modifier) {
    val list by vm.graph.browser.candidates.collectAsStateWithLifecycle()
    val active by vm.graph.browser.activeTab.collectAsStateWithLifecycle()
    val candidates = list.filter { it.tabId == active }
    LazyColumn(
        modifier,
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (candidates.isEmpty())
            item {
                Row(
                    Modifier.fillMaxWidth().padding(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(Icons.Rounded.VideoLibrary, null, tint = MaterialTheme.colorScheme.primary)
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("等待发现媒体", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "播放网页中的视频后，资源会出现在这里。部分网页需使用其自带的保存操作。",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        items(candidates, key = { it.id }) { c ->
            OutlinedCard(
                onClick = { vm.probe(c.id) },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(20.dp),
            ) {
                Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(
                        Icons.Rounded.PlayCircleOutline,
                        null,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            "${c.protocol} · ${c.host}",
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.titleSmall,
                        )
                        Text(
                            c.contentType.ifBlank { "类型未知" },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            "查看可用规格",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }
        }
    }
}

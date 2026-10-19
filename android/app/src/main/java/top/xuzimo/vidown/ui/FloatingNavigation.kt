package top.xuzimo.vidown.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Bounded glass styling; no backdrop capture, live blur or idle animation. */
@Composable
fun FloatingNavigation(
    selected: Int,
    activeCount: Int,
    onSelect: (Int) -> Unit,
    vertical: Boolean = false,
) {
    // The parent already consumes IME insets. Raw safeDrawing padding includes
    // the keyboard again and can collapse a landscape rail to zero height.
    val safe = WindowInsets.systemBars.union(WindowInsets.displayCutout).asPaddingValues()
    val direction = LocalLayoutDirection.current
    if (vertical) {
        val left = safe.calculateLeftPadding(direction)
        val edge = maxOf(safe.calculateTopPadding(), safe.calculateBottomPadding())
        BoxWithConstraints(
            Modifier.width(88.dp + left)
                .fillMaxHeight()
                .padding(start = left + 8.dp, end = 8.dp, top = edge + 8.dp, bottom = edge + 8.dp),
            contentAlignment = Alignment.Center,
        ) {
            val cell = minOf(60.dp, (maxHeight - 12.dp) / 5).coerceAtLeast(48.dp)
            GlassNavigation(
                selected,
                activeCount,
                onSelect,
                true,
                cell,
                Modifier.width(72.dp)
                    .heightIn(max = maxHeight)
                    .verticalScroll(rememberScrollState()),
            )
        }
    } else {
        val side =
            maxOf(safe.calculateLeftPadding(direction), safe.calculateRightPadding(direction))
        Box(
            Modifier.fillMaxWidth()
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom))
                .padding(start = 16.dp + side, end = 16.dp + side, top = 8.dp, bottom = 12.dp),
            contentAlignment = Alignment.Center,
        ) {
            GlassNavigation(
                selected,
                activeCount,
                onSelect,
                false,
                60.dp,
                Modifier.widthIn(max = 480.dp).fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun GlassNavigation(
    selected: Int,
    activeCount: Int,
    onSelect: (Int) -> Unit,
    vertical: Boolean,
    cellHeight: androidx.compose.ui.unit.Dp,
    modifier: Modifier,
) {
    val colors = MaterialTheme.colorScheme
    val labels = listOf("工作台", "浏览器", "任务", "历史", "设置")
    val icons =
        listOf(
            Icons.Rounded.SpaceDashboard,
            Icons.Rounded.Language,
            Icons.Rounded.Download,
            Icons.Rounded.History,
            Icons.Rounded.Settings,
        )
    val shape = RoundedCornerShape(36.dp)
    BoxWithConstraints(
        modifier
            .shadow(
                16.dp,
                shape,
                ambientColor = colors.primary.copy(alpha = .14f),
                spotColor = colors.onSurface.copy(alpha = .12f),
            )
            .clip(shape)
            .background(
                Brush.verticalGradient(
                    listOf(
                        colors.surfaceContainerLowest.copy(alpha = .96f),
                        colors.surfaceContainerHigh.copy(alpha = .86f),
                    )
                )
            )
            .border(
                1.dp,
                Brush.linearGradient(
                    listOf(
                        Color.White.copy(alpha = .62f),
                        colors.outlineVariant.copy(alpha = .38f),
                        colors.primary.copy(alpha = .15f),
                    )
                ),
                shape,
            )
            .padding(6.dp)
            .testTag("floating-navigation")
    ) {
        val width = if (vertical) maxWidth else maxWidth / labels.size
        val offset by
            animateDpAsState(
                (if (vertical) cellHeight else width) * selected,
                spatialMotion(),
                label = "导航玻璃滑块",
            )
        Box(
            Modifier.offset {
                    IntOffset(
                        if (vertical) 0 else offset.roundToPx(),
                        if (vertical) offset.roundToPx() else 0,
                    )
                }
                .width(width)
                .height(cellHeight)
                .clip(RoundedCornerShape(30.dp))
                .background(
                    Brush.verticalGradient(
                        listOf(
                            colors.primaryContainer.copy(alpha = .86f),
                            colors.primaryContainer.copy(alpha = .48f),
                        )
                    )
                )
                .border(.75.dp, colors.primary.copy(alpha = .15f), RoundedCornerShape(30.dp))
        )
        val item: @Composable (Int, Modifier) -> Unit = { index, itemModifier ->
            val tint by
                animateColorAsState(
                    if (selected == index) colors.onPrimaryContainer else colors.onSurfaceVariant,
                    effectsMotion(),
                    label = "导航颜色",
                )
            Column(
                itemModifier
                    .height(cellHeight)
                    .clip(RoundedCornerShape(30.dp))
                    .selectable(selected == index, role = Role.Tab, onClick = { onSelect(index) })
                    .testTag("nav-$index"),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                BadgedBox(
                    badge = {
                        if (index == 2 && activeCount > 0)
                            Badge { Text(if (activeCount > 99) "99+" else "$activeCount") }
                    }
                ) {
                    Icon(icons[index], null, Modifier.size(23.dp), tint = tint)
                }
                Text(
                    labels[index],
                    Modifier.padding(top = 3.dp),
                    color = tint,
                    fontSize = 11.sp,
                    lineHeight = 14.sp,
                    fontWeight = if (selected == index) FontWeight.SemiBold else FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (vertical)
            Column(Modifier.fillMaxWidth().selectableGroup()) {
                labels.indices.forEach { item(it, Modifier.fillMaxWidth()) }
            }
        else
            Row(Modifier.fillMaxWidth().selectableGroup()) {
                labels.indices.forEach { item(it, Modifier.weight(1f)) }
            }
    }
}

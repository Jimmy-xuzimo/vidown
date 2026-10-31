package top.xuzimo.vidown.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag

/** Official Material 3 navigation. Portrait bar / landscape centred rail. */
@Composable
fun FloatingNavigation(
    selected: Int,
    activeCount: Int,
    onSelect: (Int) -> Unit,
    vertical: Boolean = false,
) {
    val labels = listOf("工作台", "浏览器", "任务", "历史", "设置")
    val icons =
        listOf(
            Icons.Rounded.SpaceDashboard,
            Icons.Rounded.Language,
            Icons.Rounded.Download,
            Icons.Rounded.History,
            Icons.Rounded.Settings,
        )
    val icon: @Composable (Int) -> Unit = { index ->
        BadgedBox(
            badge = {
                if (index == 2 && activeCount > 0)
                    Badge { Text(if (activeCount > 99) "99+" else activeCount.toString()) }
            }
        ) {
            Icon(icons[index], contentDescription = null)
        }
    }
    if (vertical) {
        NavigationRail(
            modifier = Modifier.fillMaxHeight().testTag("floating-navigation"),
            windowInsets =
                WindowInsets.systemBars
                    .union(WindowInsets.displayCutout)
                    .only(WindowInsetsSides.Start + WindowInsetsSides.Vertical),
        ) {
            Column(
                Modifier.weight(1f).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                labels.indices.forEach { index ->
                    NavigationRailItem(
                        selected == index,
                        { onSelect(index) },
                        icon = { icon(index) },
                        label = { Text(labels[index]) },
                        modifier = Modifier.testTag("nav-" + index),
                    )
                }
            }
        }
    } else {
        NavigationBar(modifier = Modifier.testTag("floating-navigation")) {
            labels.indices.forEach { index ->
                NavigationBarItem(
                    selected == index,
                    { onSelect(index) },
                    icon = { icon(index) },
                    label = { Text(labels[index]) },
                    modifier = Modifier.testTag("nav-" + index),
                )
            }
        }
    }
}

package top.xuzimo.vidown.ui

import androidx.activity.compose.LocalActivity
import androidx.compose.animation.core.*
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.foundation.Image
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.graphics.drawable.toBitmap
import androidx.core.view.WindowCompat
import top.xuzimo.vidown.core.AppSettings

private data class Palette(val primary: Color, val bright: Color, val light: Color, val deep: Color)

@Composable
fun VidownTheme(settings: AppSettings, content: @Composable () -> Unit) {
    val dark =
        settings.colorMode == "dark" || settings.colorMode == "system" && isSystemInDarkTheme()
    val activity = LocalActivity.current
    SideEffect {
        activity?.window?.let { window ->
            WindowCompat.getInsetsController(window, window.decorView).apply {
                isAppearanceLightStatusBars = !dark
                isAppearanceLightNavigationBars = !dark
            }
        }
    }
    val palette =
        when (settings.theme) {
            "ocean" ->
                Palette(Color(0xff24648c), Color(0xff9bcbef), Color(0xffcce7ff), Color(0xff084b72))
            "jade" ->
                Palette(Color(0xff38694f), Color(0xff9fd4b4), Color(0xffbbf0cf), Color(0xff205139))
            "rose" ->
                Palette(Color(0xff984569), Color(0xffffb0cd), Color(0xffffd9e6), Color(0xff783051))
            else ->
                Palette(Color(0xff65558f), Color(0xffcfbcff), Color(0xffe9ddff), Color(0xff4d3d75))
        }
    val colors =
        if (dark)
            darkColorScheme(
                primary = palette.bright,
                onPrimary = Color(0xff24202d),
                primaryContainer = palette.deep,
                onPrimaryContainer = palette.light,
                secondary = Color(0xffcdc4da),
                onSecondary = Color(0xff302b39),
                secondaryContainer = Color(0xff494352),
                onSecondaryContainer = Color(0xffeae0f1),
                background = Color(0xff141316),
                onBackground = Color(0xffe8e1e6),
                surface = Color(0xff141316),
                onSurface = Color(0xffe8e1e6),
                surfaceVariant = Color(0xff49454d),
                onSurfaceVariant = Color(0xffccc4ce),
                surfaceContainerLowest = Color(0xff100f12),
                surfaceContainerLow = Color(0xff1d1b20),
                surfaceContainer = Color(0xff211f24),
                surfaceContainerHigh = Color(0xff2b292e),
                surfaceContainerHighest = Color(0xff363339),
                outline = Color(0xff958e99),
                outlineVariant = Color(0xff49454f),
                surfaceTint = palette.bright,
            )
        else
            lightColorScheme(
                primary = palette.primary,
                onPrimary = Color.White,
                primaryContainer = palette.light,
                onPrimaryContainer = Color(0xff292132),
                secondary = Color(0xff625a70),
                onSecondary = Color.White,
                secondaryContainer = Color(0xffe9e0f2),
                onSecondaryContainer = Color(0xff302b39),
                background = Color(0xfffcf9fd),
                onBackground = Color(0xff1d1b20),
                surface = Color(0xfffcf9fd),
                onSurface = Color(0xff1d1b20),
                surfaceVariant = Color(0xffe7e1eb),
                onSurfaceVariant = Color(0xff49454f),
                surfaceContainerLowest = Color.White,
                surfaceContainerLow = Color(0xfff6f2f8),
                surfaceContainer = Color(0xfff0ecf2),
                surfaceContainerHigh = Color(0xffeae6ed),
                surfaceContainerHighest = Color(0xffe4e0e7),
                outline = Color(0xff7b7480),
                outlineVariant = Color(0xffcec7d2),
                surfaceTint = palette.primary,
            )
    MaterialTheme(colorScheme = colors) {
        CompositionLocalProvider(
            LocalAnimationsEnabled provides settings.animations,
            content = content,
        )
    }
}

val LocalAnimationsEnabled = staticCompositionLocalOf { true }

/** Stable AndroidX Compose motion; honors both the app preference and system animation scale. */
@Composable
fun <T> spatialMotion(): FiniteAnimationSpec<T> =
    if (LocalAnimationsEnabled.current)
        spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMediumLow)
    else snap()

@Composable
fun <T> effectsMotion(): FiniteAnimationSpec<T> =
    if (LocalAnimationsEnabled.current) tween(durationMillis = 200, easing = FastOutSlowInEasing)
    else snap()

@Composable
fun BrandMark(size: Dp = 48.dp) {
    val context = LocalContext.current
    // Use the actual adaptive launcher drawable, including its city gradient and mask.
    val icon =
        remember(context) {
            context.packageManager
                .getApplicationIcon(context.packageName)
                .toBitmap(192, 192)
                .asImageBitmap()
        }
    Image(icon, "Vidown", Modifier.size(size).testTag("brand-mark"))
}

@Composable
fun SectionHeading(title: String, subtitle: String? = null, icon: ImageVector? = null) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (icon != null) Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            if (subtitle != null)
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
        }
    }
}

@Composable
fun SettingsGroup(title: String, icon: ImageVector, content: @Composable ColumnScope.() -> Unit) {
    Surface(
        shape = RoundedCornerShape(28.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
    ) {
        Column(
            Modifier.fillMaxWidth().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            SectionHeading(title, icon = icon)
            content()
        }
    }
}

@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    description: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Surface(
            shape = RoundedCornerShape(24.dp),
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
        ) {
            Icon(
                icon,
                null,
                Modifier.padding(20.dp).size(32.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
        }
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Medium)
        Text(
            description,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

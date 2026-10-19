plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.devtools.ksp")
    id("com.chaquo.python")
}

extensions.configure<com.android.build.gradle.internal.dsl.BaseAppModuleExtension> {
    namespace = "top.xuzimo.vidown"
    // GeckoView 158 requires the stable API 37.2 SDK; the runtime floor remains 34.
    compileSdkVersion("android-37.2")
    ndkVersion = "28.2.13676358"
    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.31.6"
        }
    }
    defaultConfig {
        applicationId = "top.xuzimo.vidown"
        minSdk = 34
        targetSdk = 37
        versionCode = 6
        versionName = "0.1.0-preview.6"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
    }
    val keyPath = providers.environmentVariable("VIDOWN_KEYSTORE").orNull
    if (keyPath != null)
        signingConfigs.create("androidRelease") {
            storeFile = file(keyPath)
            storePassword = providers.environmentVariable("VIDOWN_STORE_PASSWORD").get()
            keyAlias = providers.environmentVariable("VIDOWN_KEY_ALIAS").get()
            keyPassword = providers.environmentVariable("VIDOWN_KEY_PASSWORD").get()
        }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (keyPath != null) signingConfig = signingConfigs.getByName("androidRelease")
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
        aidl = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    packaging {
        resources.excludes +=
            setOf(
                "META-INF/AL2.0",
                "META-INF/LGPL2.1",
                "META-INF/DEPENDENCIES",
                "META-INF/INDEX.LIST",
            )
    }
    testOptions { unitTests.isReturnDefaultValues = true }
}

chaquopy {
    defaultConfig {
        version = "3.12"
        pip {
            options("--require-hashes", "--only-binary=:all:")
            install("-r", file("requirements.lock.txt").absolutePath)
        }
    }
}

ksp { arg("room.schemaLocation", "$projectDir/schemas") }

dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.material3.adaptive:adaptive:1.3.0")
    implementation("androidx.compose.material3.adaptive:adaptive-layout:1.3.0")
    implementation("androidx.compose.material3.adaptive:adaptive-navigation:1.3.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.navigation:navigation-compose:2.9.8")
    implementation("androidx.room:room-runtime:2.8.4")
    implementation("androidx.room:room-ktx:2.8.4")
    ksp("androidx.room:room-compiler:2.8.4")
    implementation("androidx.datastore:datastore-preferences:1.2.1")
    implementation("androidx.work:work-runtime-ktx:2.12.0")
    implementation("androidx.media3:media3-exoplayer:1.11.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.11.1")
    implementation("androidx.media3:media3-exoplayer-dash:1.11.1")
    implementation("androidx.media3:media3-datasource:1.11.1")
    implementation("androidx.media3:media3-transformer:1.11.1")
    implementation("androidx.browser:browser:1.10.0")
    implementation("org.mozilla.geckoview:geckoview:158.0.20261007201254")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation(platform("androidx.compose:compose-bom:2026.09.00"))
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

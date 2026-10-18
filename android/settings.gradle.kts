pluginManagement {
    repositories {
        maven("https://dl.google.com/android/maven2/")
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://dl.google.com/android/maven2/")
        mavenCentral()
        maven("https://maven.mozilla.org/maven2/")
    }
}

rootProject.name = "VidownAndroid"

include(":app")

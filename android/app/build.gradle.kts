plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.georgewightman.dashwidgets"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.georgewightman.dashwidgets"
        minSdk = 26
        targetSdk = 34
        // CI numbers each build, so a newer one installs over the last.
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.${System.getenv("GITHUB_RUN_NUMBER") ?: "0"}"
    }

    buildTypes {
        release {
            // Signed on George's laptop with a key that never leaves it (android/README.md).
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isIncludeAndroidResources = true }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.12.2")
}

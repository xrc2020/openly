# Openly Rotation for Android

This is the Android project, not a compiled APK. It packages your latest Secret Feature with compact player labels and swap icons. Its HTML, styles and logo are bundled, so the rotation dashboard works offline. No account or server is required.

Players, scores and history exist only in memory. Rotating the device preserves the current session. Closing the app, restarting it, or Android terminating it clears the session. Match history credits the players on court when each round ends. Timers retain the existing webpage behavior; this package does not change the scoring rules.

## Build in your browser using GitHub

1. Extract this ZIP. Copy the `android-rotation` folder into your Openly repository's root in vscode.dev.
2. Copy `.github/workflows/openly-rotation-apk.yml` into the same path in that repository. Preserve any existing workflows.
3. Commit and push. If GitHub asks for authorization to edit workflow files, complete its normal authorization flow.
4. On GitHub, open **Actions → Build Openly Rotation APK → Run workflow**. You may need to enable Actions for your repository.
5. Once the build succeeds, download **Openly-Rotation-APK** from its Artifacts section. Extract it to get `app-debug.apk`.
6. Send the APK to your Android phone. Open it and allow installation from your browser or file manager when Android requests it.

The workflow runs only when you start it. It does not deploy or change your Vercel website. GitHub Actions availability and usage limits depend on your account and repository.

## Build on a Windows computer

Install Android Studio, open the `android-rotation` folder and install Android SDK Platform 35 and Build Tools 34.0.0. Set `JAVA_HOME` to a compatible JDK 17 (or Android Studio's compatible bundled JDK) and configure the SDK in `local.properties` or `ANDROID_HOME`. Run `powershell -ExecutionPolicy Bypass -File .\build-apk.ps1` from this folder. The first build needs internet to download Gradle and dependencies.

Output: `app/build/outputs/apk/debug/app-debug.apk`.

## Version and distribution notes

App name: Openly Rotation. Application ID: `com.playopenly.rotation`. Minimum Android: 8.0. Keep Android System WebView updated for modern layout support. There are no app network, camera, location or storage permissions. The Openly website link opens in your regular browser.

The provided workflow builds a debug-signed APK for testing and personal installation. It has not been built or tested on an Android device in this environment. For public distribution, build a release APK with your own permanent signing key. Keep that key secure; it is needed to update existing installations. Separate GitHub build runs may use different debug keys, which can require uninstalling an earlier test APK before installing another one.

The bundled dashboard does not automatically receive website edits. To update it, replace `android-rotation/app/src/main/assets/index.html` with an offline-compatible version, increment versionCode/versionName in app/build.gradle, and build again. Preserve the bundled stylesheet and relative `logo.png` reference if updating the HTML.

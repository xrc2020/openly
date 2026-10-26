$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not $env:JAVA_HOME) { throw 'Install Android Studio and set JAVA_HOME to its jbr directory (or a JDK 17 installation).' }
if (-not $env:ANDROID_HOME -and -not (Test-Path 'local.properties')) { throw 'Open this folder in Android Studio first to configure the Android SDK, or set ANDROID_HOME.' }
$toolsPath = Join-Path $PSScriptRoot '.build-tools'
New-Item -ItemType Directory -Force -Path $toolsPath | Out-Null
$gradleCmd = Join-Path $toolsPath 'gradle-8.9/bin/gradle.bat'
if (-not (Test-Path $gradleCmd)) {
    $downloadPath = Join-Path $toolsPath 'gradle-8.9-bin.zip'
    Invoke-WebRequest 'https://services.gradle.org/distributions/gradle-8.9-bin.zip' -OutFile $downloadPath
    Expand-Archive $downloadPath -DestinationPath $toolsPath -Force
}
& $gradleCmd --no-daemon assembleDebug
if ($LASTEXITCODE -ne 0) { throw 'APK build failed. See the errors above.' }
Write-Host 'APK ready: app/build/outputs/apk/debug/app-debug.apk'

# React Native
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }

# First-party native modules are resolved by name from JS.
-keep class com.generalstore.nativebridge.** { *; }
-keepclassmembers class * extends com.facebook.react.bridge.ReactContextBaseJavaModule {
    @com.facebook.react.bridge.ReactMethod <methods>;
}

# SQLite / Android framework bindings
-keep class android.database.** { *; }
-dontwarn org.jetbrains.annotations.**

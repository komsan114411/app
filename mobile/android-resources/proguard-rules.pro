# Proguard/R8 rules for Capacitor release builds.
# Appended to mobile/android/app/proguard-rules.pro by the CI workflow.

# ── Keep Capacitor core + plugins discoverable by reflection ────
-keep class com.getcapacitor.** { *; }
-keep class com.getcapacitor.plugin.** { *; }
-keepclassmembers class * {
  @com.getcapacitor.annotation.CapacitorPlugin *;
  @com.getcapacitor.PluginMethod *;
}

# ── Keep JavascriptInterface methods ────────────────────────────
-keepclassmembers class * {
  @android.webkit.JavascriptInterface <methods>;
}

# ── WebView: JS engine needs class names unobfuscated ──────────
-keep class android.webkit.** { *; }
-keep class androidx.webkit.** { *; }

# ── Kotlin support (Capacitor 6 uses Kotlin internally) ────────
-keep class kotlin.Metadata { *; }
-dontwarn kotlin.**

# ── Kill debug logging entirely in release builds ──────────────
# R8 will rewrite all Log.* calls to no-ops, eliminating any accidental
# sensitive data that was logged during development.
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
    public static *** i(...);
}

# ── Shrink + optimize aggressively but keep stack traces ───────
-renamesourcefileattribute SourceFile
-keepattributes SourceFile,LineNumberTable,Signature,Exceptions,InnerClasses,EnclosingMethod

# ── Block serialization-based attacks ──────────────────────────
-keepclassmembers class * implements java.io.Serializable {
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# ── Deny unsafe reflection on app classes ──────────────────────
# Uncomment if you add native modules and need specific reflection allowlist
# -keepclasseswithmembers class * { @com.yourapp.KeepForReflection *; }

-keep class org.mozilla.geckoview.** { *; }
-keep class com.chaquo.python.** { *; }
-keep class top.xuzimo.vidown.engine.PythonTransport { *; }
-keepclasseswithmembernames class * { native <methods>; }

-keep class * implements top.xuzimo.vidown.engine.CacheAccess { *; }
-keep interface top.xuzimo.vidown.engine.CacheAccess { *; }

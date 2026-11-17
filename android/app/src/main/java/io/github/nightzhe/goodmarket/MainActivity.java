package io.github.nightzhe.goodmarket;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Logger;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    /** WebView 渲染程序「當掉」（didCrash）的連續次數與時間（static：Activity 重建後仍在，同一個 App 程序內） */
    private static long lastRendererCrashAt = 0L;
    private static int rendererCrashBurst = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Android 15+ 對 targetSdk 35+ 強制 edge-to-edge；Android 10～14 要自己開，否則底部導覽列不透明、
        // 網頁拿到的 env(safe-area-inset-bottom) 是 0，跟 iOS 不一致。Capacitor 8 的 SystemBars 文件建議在這裡呼叫，Capacitor 9 會預設做。
        // 安全區的值由 Capacitor 內建 SystemBars（capacitor.config.ts plugins.SystemBars）餵給 WebView 的 env(safe-area-inset-*)。
        EdgeToEdge.enable(this);
        // WebView 渲染程序掛掉（低記憶體被系統回收、或 Chromium 當掉）：Capacitor Android 預設回 false，整個 App 會跟著被殺掉消失；
        // iOS 的 Capacitor 則是 reload。這裡改成重建 Activity——死掉的 WebView 不能再 loadUrl，只有 Activity 重建會把舊 Bridge／WebView 拆掉重做。
        // 要在 super.onCreate 之前用 bridgeBuilder 登記（Builder.create() 會把 Bridge 的監聽清單換成 Builder 的）。
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // 這個回呼本來就只在 API 26+ 發生；判一次版本只是讓 lint 安靜（minSdk 24）
                boolean crashed = Build.VERSION.SDK_INT >= 26 && detail.didCrash();
                // 只有真的當掉才算進連掛計數：30 秒內連當四次＝某台裝置／某版 WebView 每次載入都當，不要無限重建閃爍，直接結束。
                // 系統低記憶體回收（didCrash=false，多半發生在背景）不算：低記憶體裝置在背景被連續回收幾次是正常的，
                // 算進去會把 App 從最近工作清單移掉、看起來像當掉。
                if (crashed) {
                    long now = SystemClock.elapsedRealtime();
                    rendererCrashBurst = (now - lastRendererCrashAt < 30_000L) ? rendererCrashBurst + 1 : 1;
                    lastRendererCrashAt = now;
                    if (rendererCrashBurst > 3) {
                        Logger.error("WebView renderer crashed " + rendererCrashBurst + "x within 30s; finishing task");
                        finishAndRemoveTask();
                        return true;
                    }
                }
                Logger.error("WebView renderer gone (didCrash=" + crashed + "); recreating activity");
                // 重建後的 Bridge 把 getIntent().getData() 當 launch URL（App.getLaunchUrl），src/lib/native/deeplink.ts 會切回同一頁（對齊 iOS reload 保留路由）。
                // 這個 Intent 是整個工作的根 intent、Activity 一輩子不換，所以每次重建都要自己決定它的資料：有可回的 hash 路由就塞進去，
                // 否則清掉——不然上一次重建塞的路由、或冷啟動帶進來的 ://auth（code 只能用一次）／://review-login 會在這次重建時被重播。
                // action 一併改成 MAIN：由 VIEW intent 冷啟動的 Activity 重建時，Capacitor 會對根 intent 再發一次 appUrlOpen。
                Intent intent = getIntent();
                String cur = view.getUrl();
                int h = cur == null ? -1 : cur.indexOf('#');
                String route = h >= 0 ? cur.substring(h + 1) : "";
                if (route.startsWith("/") && route.length() > 1) {
                    intent.setData(Uri.parse("io.github.nightzhe.goodmarket://" + route.substring(1)));
                } else {
                    intent.setData(null);
                }
                intent.setAction(Intent.ACTION_MAIN);
                recreate();
                return true;
            }
        });
        super.onCreate(savedInstanceState);
    }
}

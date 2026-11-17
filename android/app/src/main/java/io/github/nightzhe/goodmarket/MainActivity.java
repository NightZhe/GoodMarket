package io.github.nightzhe.goodmarket;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Android 15+ 對 targetSdk 35+ 強制 edge-to-edge；Android 10～14 要自己開，否則底部導覽列不透明、
        // 網頁拿到的 env(safe-area-inset-bottom) 是 0，跟 iOS 不一致。Capacitor 8 的 SystemBars 文件建議在這裡呼叫，Capacitor 9 會預設做。
        // 安全區的值由 Capacitor 內建 SystemBars（capacitor.config.ts plugins.SystemBars）餵給 WebView 的 env(safe-area-inset-*)。
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}

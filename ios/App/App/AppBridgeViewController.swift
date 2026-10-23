import UIKit
import WebKit
import Capacitor

/// Capacitor 的 WebView 控制器，只多做一件事：開啟 WKWebView 的右滑返回手勢。
/// 本站是 hash 路由，每次換頁都是一筆 WebView 歷史，所以手勢回上一頁會直接對應站內的上一頁。
class AppBridgeViewController: CAPBridgeViewController {
    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        let webView = super.webView(with: frame, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
        return webView
    }
}
